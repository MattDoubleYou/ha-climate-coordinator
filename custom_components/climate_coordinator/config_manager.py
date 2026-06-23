"""Config Manager — reads and writes climate_coordinator_config.json."""
import json
import logging
import os
import uuid
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)
CONFIG_FILE = "climate_coordinator_config.json"

DEFAULT_CONFIG = {
    "areas": [],
    "time_periods": []
}


class ConfigManager:
    """Manages persistent JSON config for HA Climate Coordinator."""

    def __init__(self, hass: HomeAssistant):
        self._hass = hass
        self._config = dict(DEFAULT_CONFIG)
        self._path = hass.config.path(CONFIG_FILE)

    # ------------------------------------------------------------------
    # Load / Save
    # ------------------------------------------------------------------

    async def async_load(self):
        """Load config from disk, creating defaults if missing."""
        if os.path.exists(self._path):
            try:
                def _read():
                    with open(self._path, "r") as f:
                        return json.load(f)
                self._config = await self._hass.async_add_executor_job(_read)
                _LOGGER.info(
                    "Climate Coordinator config loaded from %s", self._path
                )
            except Exception as e:
                _LOGGER.error("Failed to load config: %s", e)
                self._config = dict(DEFAULT_CONFIG)
        else:
            await self.async_save()
            _LOGGER.info(
                "Climate Coordinator created default config at %s", self._path
            )

    async def async_save(self):
        """Persist config to disk."""
        try:
            def _write():
                with open(self._path, "w") as f:
                    json.dump(self._config, f, indent=2)
            await self._hass.async_add_executor_job(_write)
        except Exception as e:
            _LOGGER.error("Failed to save config: %s", e)

    # ------------------------------------------------------------------
    # Config Access
    # ------------------------------------------------------------------

    @property
    def config(self):
        return self._config

    @property
    def areas(self):
        return self._config.get("areas", [])

    @property
    def time_periods(self):
        return self._config.get("time_periods", [])

    def get_area(self, area_id):
        return next(
            (a for a in self.areas if a["id"] == area_id), None
        )

    def get_period(self, period_id):
        return next(
            (p for p in self.time_periods if p["id"] == period_id), None
        )

    # ------------------------------------------------------------------
    # Area CRUD
    # ------------------------------------------------------------------

    async def async_add_area(self, area_data: dict) -> dict:
        """Add a new area and return it with generated ID."""
        area = {
            "id": f"area_{uuid.uuid4().hex[:8]}",
            "name": area_data["name"],
            "climate_entity": area_data["climate_entity"],
            "temperature_sensor": area_data.get("temperature_sensor"),
            "passive": area_data.get("passive", False),
            "min_temp": area_data.get("min_temp"),
            "max_temp": area_data.get("max_temp"),
            "override_duration": area_data.get("override_duration", 13),
            "rules": []
        }
        self._config["areas"].append(area)
        await self.async_save()
        return area

    async def async_update_area(self, area_id: str, updates: dict) -> dict:
        """Update area fields (not rules) and return updated area."""
        area = self.get_area(area_id)
        if not area:
            raise ValueError(f"Area {area_id} not found")
        allowed = {
            "name", "climate_entity", "temperature_sensor",
            "passive", "min_temp", "max_temp", "override_duration"
        }
        for key, value in updates.items():
            if key in allowed:
                area[key] = value
        await self.async_save()
        return area

    async def async_delete_area(self, area_id: str):
        """Delete an area and clean up follow references in other areas."""
        self._config["areas"] = [
            a for a in self.areas if a["id"] != area_id
        ]
        for area in self._config["areas"]:
            for rule in area.get("rules", []):
                if rule.get("source_area_id") == area_id:
                    rule["source_area_id"] = None
                    rule["temperature_mode"] = "fixed"
                    rule["temperature"] = 16
        await self.async_save()

    # ------------------------------------------------------------------
    # Rule CRUD
    # ------------------------------------------------------------------

    async def async_add_rule(self, area_id: str, rule_data: dict) -> dict:
        """Add a rule to an area, validating for cycles."""
        area = self.get_area(area_id)
        if not area:
            raise ValueError(f"Area {area_id} not found")

        rule = {
            "id": f"rule_{uuid.uuid4().hex[:8]}",
            "period_id": rule_data["period_id"],
            "enabled": rule_data.get("enabled", True),
            "temperature_mode": rule_data["temperature_mode"],
            "temperature": rule_data.get("temperature"),
            "source_area_id": rule_data.get("source_area_id"),
            "temperature_reference": rule_data.get(
                "temperature_reference", "lowest_of_both"
            ),
            "offset": rule_data.get("offset", 0),
            "presence_sensors": rule_data.get("presence_sensors", []),
            "presence_window": rule_data.get("presence_window", {
                "type": "past_n_minutes",
                "value": 60
            }),
            "absent_behaviour": rule_data.get("absent_behaviour", "min_temp"),
            "absent_fixed_temp": rule_data.get("absent_fixed_temp"),
        }

        if rule["temperature_mode"] == "follow":
            self._validate_no_cycle(area_id, rule["source_area_id"])

        area["rules"].append(rule)
        area["rules"].sort(key=lambda r: self._rule_sort_key(r))
        await self.async_save()
        return rule

    async def async_update_rule(
        self, area_id: str, rule_id: str, updates: dict
    ) -> dict:
        """Update a rule."""
        area = self.get_area(area_id)
        if not area:
            raise ValueError(f"Area {area_id} not found")
        rule = next(
            (r for r in area["rules"] if r["id"] == rule_id), None
        )
        if not rule:
            raise ValueError(f"Rule {rule_id} not found")

        if (updates.get("temperature_mode") == "follow"
                or (rule["temperature_mode"] == "follow"
                    and "source_area_id" in updates)):
            source = updates.get("source_area_id", rule["source_area_id"])
            self._validate_no_cycle(area_id, source)

        rule.update(updates)
        area["rules"].sort(key=lambda r: self._rule_sort_key(r))
        await self.async_save()
        return rule

    async def async_delete_rule(self, area_id: str, rule_id: str):
        """Delete a rule from an area."""
        area = self.get_area(area_id)
        if not area:
            raise ValueError(f"Area {area_id} not found")
        area["rules"] = [r for r in area["rules"] if r["id"] != rule_id]
        await self.async_save()

    # ------------------------------------------------------------------
    # Time Period CRUD
    # ------------------------------------------------------------------

    async def async_add_period(self, period_data: dict) -> dict:
        """Add a time period, validating for conflicts."""
        self._validate_period_conflict(period_data, exclude_id=None)
        period = {
            "id": f"period_{uuid.uuid4().hex[:8]}",
            "name": period_data["name"],
            "start_time": period_data["start_time"],
            "days": period_data.get(
                "days",
                ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
            )
        }
        self._config["time_periods"].append(period)
        self._config["time_periods"].sort(key=lambda p: p["start_time"])
        await self.async_save()
        return period

    async def async_update_period(
        self, period_id: str, updates: dict
    ) -> dict:
        """Update a time period."""
        period = self.get_period(period_id)
        if not period:
            raise ValueError(f"Period {period_id} not found")
        merged = {**period, **updates}
        self._validate_period_conflict(merged, exclude_id=period_id)
        period.update(updates)
        self._config["time_periods"].sort(key=lambda p: p["start_time"])
        await self.async_save()
        return period

    async def async_delete_period(self, period_id: str):
        """Delete a period and remove rules that reference it."""
        self._config["time_periods"] = [
            p for p in self.time_periods if p["id"] != period_id
        ]
        for area in self._config["areas"]:
            area["rules"] = [
                r for r in area.get("rules", [])
                if r["period_id"] != period_id
            ]
        await self.async_save()

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate_no_cycle(self, start_area_id: str, source_area_id: str):
        """Raise if following source_area_id would create a cycle."""
        if source_area_id is None:
            return
        visited = {start_area_id}
        current = source_area_id
        while current:
            if current in visited:
                raise ValueError(
                    "Circular dependency detected: this follow relationship "
                    "would create a cycle."
                )
            visited.add(current)
            source_area = self.get_area(current)
            if not source_area:
                break
            next_source = None
            for rule in source_area.get("rules", []):
                if (rule.get("temperature_mode") == "follow"
                        and rule.get("source_area_id")):
                    next_source = rule["source_area_id"]
                    break
            current = next_source

    def _validate_period_conflict(self, period_data: dict, exclude_id: str):
        """Raise if a period shares start_time+day with an existing one."""
        new_days = set(period_data.get(
            "days",
            ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        ))
        new_time = period_data["start_time"]
        for p in self.time_periods:
            if p["id"] == exclude_id:
                continue
            if p["start_time"] == new_time:
                existing_days = set(p.get(
                    "days",
                    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
                ))
                overlap = new_days & existing_days
                if overlap:
                    raise ValueError(
                        f"Period '{p['name']}' already starts at "
                        f"{new_time} on overlapping days: "
                        f"{', '.join(sorted(overlap))}."
                    )

    def _rule_sort_key(self, rule):
        """Sort rules by their period's start time."""
        period = self.get_period(rule.get("period_id", ""))
        if period:
            return period.get("start_time", "00:00")
        return "00:00"
