"""HA Climate Coordinator Integration."""
import logging
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from .config_manager import ConfigManager
from .coordinator_logic import CoordinatorLogic
from .websocket_api import async_register_websocket_commands

DOMAIN = "climate_coordinator"
_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    config_manager = ConfigManager(hass)
    await config_manager.async_load()

    logic = CoordinatorLogic(hass, config_manager)
    await logic.async_start()

    hass.data[DOMAIN] = {
        "config_manager": config_manager,
        "logic": logic,
    }

    async_register_websocket_commands(hass)
    _LOGGER.info("HA Climate Coordinator started")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    logic = hass.data[DOMAIN].get("logic")
    if logic:
        await logic.async_stop()
    hass.data.pop(DOMAIN, None)
    return True