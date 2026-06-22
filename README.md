# HA Climate Coordinator

A Home Assistant custom integration and dashboard card for centrally managing
climate devices based on schedules, presence detection, and relationships
between devices.

## Features

- **Areas** — add climate devices with individual configuration
- **Time periods** — define named periods with start times and days of week
- **Rules per area per period** — set fixed temperatures or follow another
  area's temperature with an offset
- **Presence-based control** — assign PIR/motion sensors per rule with configurable presence windows (past N minutes, past N hours, or since
  period started)
- **Absent behaviour** — per area: hold minimum temp, turn off, or fixed temp
- **Manual override detection** — detects when a device is changed manually and holds off for a configurable duration
- **Circular dependency detection** — prevents follow relationships that would create infinite loops
- **Enabled/disabled rules** — toggle rules on or off without deleting them

## Requirements

- Home Assistant 2023.6 or later

## Installation

### Via HACS (recommended)

1. In HACS, go to **Integrations** and click the three-dot menu →
   **Custom repositories**
2. Add `https://github.com/MattDoubleYoi/ha-climate-coordinator`
   with category **Integration**
3. Install **HA Climate Coordinator** from HACS
4. Restart Home Assistant
5. Go to **Settings → Devices & Services → Add Integration** and search for
   **HA Climate Coordinator**
6. In HACS, go to **Frontend** and install **HA Climate Coordinator Card**
7. Add the card to any dashboard:
   ```yaml
   type: custom:climate-coordinator-card
   ```

### Manual

1. Copy `custom_components/climate_coordinator/` to your HA
   `/config/custom_components/` directory
2. Copy `www/climate-coordinator-card/` to your HA `/config/www/` directory
3. Add the following to your `configuration.yaml`:
   ```yaml
   lovelace:
     resources:
       - url: /local/climate-coordinator-card/climate-coordinator-card.js
         type: module
   ```
4. Restart Home Assistant
5. Add the integration via Settings → Devices & Services

## Configuration

All configuration is done through the dashboard card. No YAML editing required after installation.

### Setup flow

1. **Schedule tab** — define your time periods (e.g. Morning, Evening, Night)
2. **Areas tab** — add each climate device as an area, configure absent
   behaviour and minimum temperature
3. **Areas tab → Add Rule** — for each area, add rules per time period
   defining temperature source and presence sensors
4. **Status tab** — monitor live state, presence, and override status

## Data Storage

Configuration is stored in `climate_coordinator_config.json` in your HA
config directory. This file is human-readable JSON and can be backed up alongside your other HA config files.

## Troubleshooting

Enable debug logging by adding to `configuration.yaml`:

```yaml
logger:
  logs:
    custom_components.climate_coordinator: debug
```

## Contributing

Issues and pull requests welcome at
`https://github.com/MattDoubleYou/ha-climate-coordinator`

## License

MIT
