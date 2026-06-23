"""WebSocket API for HA Climate Coordinator."""
import logging
import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.components import websocket_api

_LOGGER = logging.getLogger(__name__)
DOMAIN = "climate_coordinator"


def async_register_websocket_commands(hass: HomeAssistant):
    websocket_api.async_register_command(hass, ws_get_config)
    websocket_api.async_register_command(hass, ws_get_status)
    websocket_api.async_register_command(hass, ws_get_entities)
    websocket_api.async_register_command(hass, ws_add_area)
    websocket_api.async_register_command(hass, ws_update_area)
    websocket_api.async_register_command(hass, ws_delete_area)
    websocket_api.async_register_command(hass, ws_add_rule)
    websocket_api.async_register_command(hass, ws_update_rule)
    websocket_api.async_register_command(hass, ws_delete_rule)
    websocket_api.async_register_command(hass, ws_add_period)
    websocket_api.async_register_command(hass, ws_update_period)
    websocket_api.async_register_command(hass, ws_delete_period)
    websocket_api.async_register_command(hass, ws_cancel_override)


def _get_logic(hass):
    return hass.data[DOMAIN]["logic"]


def _get_cm(hass):
    return hass.data[DOMAIN]["config_manager"]


# ------------------------------------------------------------------
# Read
# ------------------------------------------------------------------

@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/get_config",
})
@websocket_api.async_response
async def ws_get_config(hass, connection, msg):
    connection.send_result(msg["id"], _get_cm(hass).config)


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/get_status",
})
@websocket_api.async_response
async def ws_get_status(hass, connection, msg):
    connection.send_result(msg["id"], _get_logic(hass).get_status())


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/get_entities",
    vol.Optional("domain"): str,
})
@websocket_api.async_response
async def ws_get_entities(hass, connection, msg):
    domain = msg.get("domain")
    entities = []
    for state in hass.states.async_all():
        if domain is None or state.entity_id.startswith(f"{domain}."):
            entities.append({
                "entity_id": state.entity_id,
                "name": state.attributes.get(
                    "friendly_name", state.entity_id
                ),
                "state": state.state,
            })
    entities.sort(key=lambda e: e["name"].lower())
    connection.send_result(msg["id"], entities)


# ------------------------------------------------------------------
# Areas
# ------------------------------------------------------------------

@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/add_area",
    vol.Required("area"): dict,
})
@websocket_api.async_response
async def ws_add_area(hass, connection, msg):
    try:
        area = await _get_cm(hass).async_add_area(msg["area"])
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], area)
    except Exception as e:
        connection.send_error(msg["id"], "add_area_failed", str(e))


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/update_area",
    vol.Required("area_id"): str,
    vol.Required("updates"): dict,
})
@websocket_api.async_response
async def ws_update_area(hass, connection, msg):
    try:
        area = await _get_cm(hass).async_update_area(
            msg["area_id"], msg["updates"]
        )
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], area)
    except Exception as e:
        connection.send_error(msg["id"], "update_area_failed", str(e))


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/delete_area",
    vol.Required("area_id"): str,
})
@websocket_api.async_response
async def ws_delete_area(hass, connection, msg):
    try:
        await _get_cm(hass).async_delete_area(msg["area_id"])
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], {"success": True})
    except Exception as e:
        connection.send_error(msg["id"], "delete_area_failed", str(e))


# ------------------------------------------------------------------
# Rules
# ------------------------------------------------------------------

@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/add_rule",
    vol.Required("area_id"): str,
    vol.Required("rule"): dict,
})
@websocket_api.async_response
async def ws_add_rule(hass, connection, msg):
    try:
        rule = await _get_cm(hass).async_add_rule(
            msg["area_id"], msg["rule"]
        )
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], rule)
    except Exception as e:
        connection.send_error(msg["id"], "add_rule_failed", str(e))


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/update_rule",
    vol.Required("area_id"): str,
    vol.Required("rule_id"): str,
    vol.Required("updates"): dict,
})
@websocket_api.async_response
async def ws_update_rule(hass, connection, msg):
    try:
        rule = await _get_cm(hass).async_update_rule(
            msg["area_id"], msg["rule_id"], msg["updates"]
        )
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], rule)
    except Exception as e:
        connection.send_error(msg["id"], "update_rule_failed", str(e))


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/delete_rule",
    vol.Required("area_id"): str,
    vol.Required("rule_id"): str,
})
@websocket_api.async_response
async def ws_delete_rule(hass, connection, msg):
    try:
        await _get_cm(hass).async_delete_rule(
            msg["area_id"], msg["rule_id"]
        )
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], {"success": True})
    except Exception as e:
        connection.send_error(msg["id"], "delete_rule_failed", str(e))


# ------------------------------------------------------------------
# Time Periods
# ------------------------------------------------------------------

@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/add_period",
    vol.Required("period"): dict,
})
@websocket_api.async_response
async def ws_add_period(hass, connection, msg):
    try:
        period = await _get_cm(hass).async_add_period(msg["period"])
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], period)
    except Exception as e:
        connection.send_error(msg["id"], "add_period_failed", str(e))


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/update_period",
    vol.Required("period_id"): str,
    vol.Required("updates"): dict,
})
@websocket_api.async_response
async def ws_update_period(hass, connection, msg):
    try:
        period = await _get_cm(hass).async_update_period(
            msg["period_id"], msg["updates"]
        )
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], period)
    except Exception as e:
        connection.send_error(msg["id"], "update_period_failed", str(e))


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/delete_period",
    vol.Required("period_id"): str,
})
@websocket_api.async_response
async def ws_delete_period(hass, connection, msg):
    try:
        await _get_cm(hass).async_delete_period(msg["period_id"])
        await _get_logic(hass).async_reload()
        connection.send_result(msg["id"], {"success": True})
    except Exception as e:
        connection.send_error(msg["id"], "delete_period_failed", str(e))


# ------------------------------------------------------------------
# Override
# ------------------------------------------------------------------

@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/cancel_override",
    vol.Required("area_id"): str,
})
@websocket_api.async_response
async def ws_cancel_override(hass, connection, msg):
    try:
        await _get_logic(hass).async_cancel_override(msg["area_id"])
        connection.send_result(msg["id"], {"success": True})
    except Exception as e:
        connection.send_error(msg["id"], "cancel_override_failed", str(e))
