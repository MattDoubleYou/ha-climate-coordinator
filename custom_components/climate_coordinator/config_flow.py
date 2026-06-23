"""Config flow for HA Climate Coordinator."""
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

DOMAIN = "climate_coordinator"


class ClimateCoordinatorConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for HA Climate Coordinator."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(
                title="HA Climate Coordinator",
                data={}
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
            description_placeholders={
                "description": (
                    "HA Climate Coordinator will be set up. "
                    "All configuration is done via the dashboard card."
                )
            }
        )
