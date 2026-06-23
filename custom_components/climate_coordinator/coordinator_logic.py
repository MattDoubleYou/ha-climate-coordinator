"""Core coordination logic for HA Climate Coordinator."""
import logging
from datetime import datetime, timedelta

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_call_later,
)

_LOGGER = logging.getLogger(__name__)

DAY_MAP = {
    0: "mon", 1: "tue", 2: "wed", 3: "thu",
    4: "fri", 5: "sat", 6: "sun"
}


class CoordinatorLogic:
    """Manages climate device behaviour based on config rules."""

    def __init__(self, hass: HomeAssistant, config_manager):
        self._hass = hass
        self._cm = config_manager
        self._unsub_listeners = []
        self._override_timers = {}
        self._override_start_times = {}
        self._last_set_temps = {}
        self._presence_last_seen = {}

    # ------------------------------------------------------------------
    # Start / Stop / Reload
    # ------------------------------------------------------------------

    async def async_start(self):
        self._register_listeners()
        await self._update_all_areas()

    async def async_stop(self):
        for unsub in self._unsub_listeners:
            unsub()
        self._unsub_listeners.clear()
        for cancel in self._override_timers.values():
            try:
                cancel()
            except Exception:
                pass
        self._override_timers.clear()
        self._override_start_times.clear()

    async def async_reload(self):
        await self.async_stop()
        await self.async_start()

    # ------------------------------------------------------------------
    # Listener Registration
    # ------------------------------------------------------------------

    def _register_listeners(self):
        climate_entities = []
        presence_entities = []

        for area in self._cm.areas:
            entity = area.get("climate_entity")
            if entity:
                climate_entities.append(entity)
            sensor = area.get("temperature_sensor")
            if sensor:
                climate_entities.append(sensor)
            for rule in area.get("rules", []):
                for ps in rule.get("presence_sensors", []):
                    if ps not in presence_entities:
                        presence_entities.append(ps)

        if climate_entities:
            self._unsub_listeners.append(
                async_track_state_change_event(
                    self._hass,
                    list(set(climate_entities)),
                    self._on_climate_change
                )
            )

        if presence_entities:
            self._unsub_listeners.append(
                async_track_state_change_event(
                    self._hass,
                    list(set(presence_entities)),
                    self._on_presence_change
                )
            )

    # ------------------------------------------------------------------
    # Event Handlers
    # ------------------------------------------------------------------

    @callback
    def _on_climate_change(self, event):
        """Handle any climate or temperature sensor state change."""
        entity_id = event.data.get("entity_id")
        new_state = event.data.get("new_state")
        if new_state is None:
            return

        for area in self._cm.areas:
            if area.get("climate_entity") == entity_id:
                if area.get("passive", False):
                    # Passive area changed — update followers
                    self._hass.async_create_task(self._update_all_areas())
                else:
                    self._hass.async_create_task(
                        self._check_manual_override(area, new_state)
                    )
                return

        # Temperature sensor or unrecognised entity — update all
        self._hass.async_create_task(self._update_all_areas())

    @callback
    def _on_presence_change(self, event):
        """Handle presence sensor state change."""
        entity_id = event.data.get("entity_id")
        new_state = event.data.get("new_state")
        if new_state and new_state.state == "on":
            self._presence_last_seen[entity_id] = datetime.now()
            self._hass.async_create_task(self._update_all_areas())

    # ------------------------------------------------------------------
    # Manual Override Detection
    # ------------------------------------------------------------------

    async def _check_manual_override(self, area, new_state):
        """Detect if a heater temperature was changed manually."""
        area_id = area["id"]
        try:
            new_temp = float(
                new_state.attributes.get("temperature", -999)
            )
        except (TypeError, ValueError):
            return

        last_set = self._last_set_temps.get(area_id)
        if last_set is not None and abs(new_temp - last_set) < 0.1:
            return  # We set this — not a manual change

        _LOGGER.info(
            "%s: manual override detected (%.1f°C)", area["name"], new_temp
        )
        await self._start_override(area)

    # ------------------------------------------------------------------
    # Override Management
    # ------------------------------------------------------------------

    async def _start_override(self, area):
        """Start or restart the override timer for an area."""
        area_id = area["id"]
        self._cancel_override(area_id)
        self._override_start_times[area_id] = datetime.now()

        duration_hours = float(area.get("override_duration", 13))
        duration_secs = duration_hours * 3600

        @callback
        def _expire(now=None):
            self._override_timers.pop(area_id, None)
            self._override_start_times.pop(area_id, None)
            self._hass.async_create_task(self._update_area(area))
            _LOGGER.info("%s: override expired", area["name"])

        self._override_timers[area_id] = async_call_later(
            self._hass, duration_secs, _expire
        )
        _LOGGER.info(
            "%s: override started for %.1fh", area["name"], duration_hours
        )

    def _cancel_override(self, area_id: str):
        """Cancel an override timer without triggering expiry logic."""
        cancel = self._override_timers.pop(area_id, None)
        self._override_start_times.pop(area_id, None)
        if cancel:
            try:
                cancel()
            except Exception:
                pass

    async def async_cancel_override(self, area_id: str):
        """Cancel override from the UI and immediately re-evaluate."""
        area = self._cm.get_area(area_id)
        if not area:
            return
        self._cancel_override(area_id)
        self._last_set_temps.pop(area_id, None)
        await self._update_area(area)
        _LOGGER.info("%s: override cancelled via UI", area["name"])

    # ------------------------------------------------------------------
    # Core Update Logic
    # ------------------------------------------------------------------

    async def _update_all_areas(self):
        """Recalculate and apply temperatures for every area."""
        for area in self._cm.areas:
            await self._update_area(area)

    async def _update_area(self, area):
        """Recalculate and apply temperature for a single area."""
        area_id = area["id"]

        # Passive areas are never commanded by the coordinator
        if area.get("passive", False):
            return

        # Override in progress — leave alone
        if area_id in self._override_timers:
            return

        rule = self._resolve_current_rule(area)
        if rule is None:
            return  # No matching rule — hold last state

        period = self._cm.get_period(rule["period_id"])

        if self._is_present(rule, period):
            target = self._calculate_target_temp(area, rule)
        else:
            target = self._get_absent_temp(area, rule)

        if target is None:
            return  # Source unavailable — hold last state

        if target == "off":
            await self._set_hvac_off(area)
            return

        # Clamp to area min/max bounds
        min_temp = area.get("min_temp")
        max_temp = area.get("max_temp")
        if min_temp is not None:
            target = max(target, float(min_temp))
        if max_temp is not None:
            target = min(target, float(max_temp))

        _LOGGER.info("%s: setting to %.1f°C", area["name"], target)
        self._last_set_temps[area_id] = target
        await self._hass.services.async_call(
            "climate", "set_temperature",
            {"entity_id": area["climate_entity"], "temperature": target}
        )

    # ------------------------------------------------------------------
    # Rule Resolution
    # ------------------------------------------------------------------

    def _resolve_current_rule(self, area):
        """
        Walk backwards through time to find the most recent
        enabled rule for this area. Returns None if none found.
        """
        now = datetime.now()
        for _period_start_dt, period in self._get_periods_sorted_desc(now):
            rule = self._find_enabled_rule_for_period(area, period["id"])
            if rule is not None:
                return rule
        return None

    def _get_periods_sorted_desc(self, now: datetime):
        """
        Return (period_start_datetime, period) tuples sorted most-recent
        first, looking back up to 7 days to handle overnight periods.
        """
        candidates = []
        for days_back in range(8):
            check_date = now.date() - timedelta(days=days_back)
            day_name = DAY_MAP[check_date.weekday()]
            for period in self._cm.time_periods:
                if day_name not in period.get(
                    "days",
                    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
                ):
                    continue
                try:
                    h, m = map(int, period["start_time"].split(":"))
                    period_dt = datetime.combine(
                        check_date,
                        datetime.min.time().replace(hour=h, minute=m)
                    )
                    if period_dt <= now:
                        candidates.append((period_dt, period))
                except Exception:
                    continue
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates

    def _find_enabled_rule_for_period(self, area, period_id):
        """Return the first enabled rule matching period_id, or None."""
        for rule in area.get("rules", []):
            if (rule.get("period_id") == period_id
                    and rule.get("enabled", True)):
                return rule
        return None

    # ------------------------------------------------------------------
    # Presence Check
    # ------------------------------------------------------------------

    def _is_present(self, rule, period):
        """
        Return True if presence is detected per rule config.
        If no sensors are configured, always returns True.
        """
        sensors = rule.get("presence_sensors", [])
        if not sensors:
            return True

        window = rule.get("presence_window", {})
        window_type = window.get("type", "past_n_minutes")
        now = datetime.now()

        if window_type == "since_period_start":
            cutoff = self._get_period_start_dt(period, now)
        elif window_type == "past_n_hours":
            cutoff = now - timedelta(hours=float(window.get("value", 1)))
        else:  # past_n_minutes
            cutoff = now - timedelta(minutes=float(window.get("value", 60)))

        for sensor in sensors:
            # Check stored last-seen timestamp
            last_seen = self._presence_last_seen.get(sensor)
            if last_seen and last_seen >= cutoff:
                return True
            # Also check live state (handles HA restart)
            state = self._hass.states.get(sensor)
            if state and state.state == "on":
                self._presence_last_seen[sensor] = now
                return True

        return False

    def _get_period_start_dt(self, period, now: datetime) -> datetime:
        """
        Return the datetime when the current period most recently started.
        Walks back up to 7 days to handle overnight periods correctly.
        """
        for days_back in range(8):
            check_date = now.date() - timedelta(days=days_back)
            day_name = DAY_MAP[check_date.weekday()]
            if day_name not in period.get(
                "days",
                ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
            ):
                continue
            try:
                h, m = map(int, period["start_time"].split(":"))
                period_dt = datetime.combine(
                    check_date,
                    datetime.min.time().replace(hour=h, minute=m)
                )
                if period_dt <= now:
                    return period_dt
            except Exception:
                continue
        return now - timedelta(hours=24)

    # ------------------------------------------------------------------
    # Temperature Calculation
    # ------------------------------------------------------------------

    def _calculate_target_temp(self, area, rule):
        """Calculate target temperature based on rule config."""
        mode = rule.get("temperature_mode", "fixed")
        if mode == "fixed":
            temp = rule.get("temperature")
            return float(temp) if temp is not None else None
        if mode == "follow":
            return self._calculate_follow_temp(rule)
        return None

    def _calculate_follow_temp(self, rule):
        """
        Calculate temperature by following another area's temperature.
        Returns None if source is unavailable (caller holds last state).
        """
        source_area = self._cm.get_area(rule.get("source_area_id"))
        if not source_area:
            return None

        source_climate = self._hass.states.get(source_area["climate_entity"])
        if source_climate is None:
            return None

        if source_climate.state in ("off", "unavailable", "unknown"):
            return None  # Source off — hold last state

        # Current temperature: use dedicated sensor if configured
        current = None
        source_sensor_id = source_area.get("temperature_sensor")
        if source_sensor_id:
            source_sensor = self._hass.states.get(source_sensor_id)
            if source_sensor:
                try:
                    current = float(source_sensor.state)
                except (TypeError, ValueError):
                    pass

        if current is None:
            try:
                current = float(
                    source_climate.attributes.get("current_temperature")
                )
            except (TypeError, ValueError):
                pass

        # Target temperature always from climate entity
        target = None
        try:
            target = float(source_climate.attributes.get("temperature"))
        except (TypeError, ValueError):
            pass

        ref = rule.get("temperature_reference", "lowest_of_both")
        offset = float(rule.get("offset", 0))

        both = [v for v in [current, target] if v is not None]
        if not both:
            return None

        if ref == "current":
            base = current
        elif ref == "target":
            base = target
        elif ref == "lowest_of_both":
            base = min(both)
        elif ref == "highest_of_both":
            base = max(both)
        else:
            base = current

        return (base + offset) if base is not None else None

    # ------------------------------------------------------------------
    # Absent Behaviour (read from rule)
    # ------------------------------------------------------------------

    def _get_absent_temp(self, area, rule):
        """
        Return target for absent state: a float temp, 'off', or None.
        Reads absent_behaviour from the rule.
        Area min_temp is used as the fallback for 'min_temp' behaviour.
        """
        behaviour = rule.get("absent_behaviour", "min_temp")
        min_temp = area.get("min_temp")

        if behaviour == "off":
            return "off"
        if behaviour == "fixed":
            val = rule.get("absent_fixed_temp")
            if val is not None:
                return float(val)
            return float(min_temp) if min_temp is not None else 16.0
        # min_temp behaviour
        return float(min_temp) if min_temp is not None else 16.0

    async def _set_hvac_off(self, area):
        """Turn off a climate entity."""
        self._last_set_temps[area["id"]] = None
        await self._hass.services.async_call(
            "climate", "turn_off",
            {"entity_id": area["climate_entity"]}
        )

    # ------------------------------------------------------------------
    # Status (for WebSocket API)
    # ------------------------------------------------------------------

    def get_status(self):
        """Return full status for all areas for the card to display."""
        areas_status = []
        now = datetime.now()

        for area in self._cm.areas:
            area_id = area["id"]
            climate = self._hass.states.get(area["climate_entity"])
            rule = self._resolve_current_rule(area)
            period = self._cm.get_period(rule["period_id"]) if rule else None

            # Override remaining time
            override_active = area_id in self._override_timers
            override_remaining = None
            if override_active:
                start = self._override_start_times.get(area_id)
                if start:
                    duration_secs = float(
                        area.get("override_duration", 13)
                    ) * 3600
                    elapsed = (now - start).total_seconds()
                    remaining = max(0, duration_secs - elapsed)
                    h = int(remaining // 3600)
                    m = int((remaining % 3600) // 60)
                    override_remaining = f"{h}h {m}m"

            # Presence sensor details
            presence_info = []
            if rule:
                for sensor_id in rule.get("presence_sensors", []):
                    last = self._presence_last_seen.get(sensor_id)
                    state = self._hass.states.get(sensor_id)
                    presence_info.append({
                        "entity_id": sensor_id,
                        "state": state.state if state else "unavailable",
                        "last_seen": last.isoformat() if last else None
                    })

            is_present = None
            if rule and period and not area.get("passive", False):
                is_present = self._is_present(rule, period)

            areas_status.append({
                "id": area_id,
                "name": area["name"],
                "passive": area.get("passive", False),
                "climate_entity": area["climate_entity"],
                "climate_state": (
                    climate.state if climate else "unavailable"
                ),
                "current_temp": (
                    climate.attributes.get("current_temperature")
                    if climate else None
                ),
                "target_temp": (
                    climate.attributes.get("temperature")
                    if climate else None
                ),
                "min_temp": area.get("min_temp"),
                "max_temp": area.get("max_temp"),
                "active_rule_id": rule["id"] if rule else None,
                "active_period": period["name"] if period else None,
                "override_active": override_active,
                "override_remaining": override_remaining,
                "present": is_present,
                "presence_sensors": presence_info,
            })

        return {
            "areas": areas_status,
            "timestamp": now.isoformat()
        }
