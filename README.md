# homebridge-xiaomi-s12-vacuum

A Matter-native [Homebridge](https://homebridge.io) 2.0+ plugin for the **Xiaomi Robot Vacuum S12** (`xiaomi.vacuum.b106eu`), controlled entirely over the **local network** via the MIoT protocol — no cloud account required at runtime.

> This is a fork of [johnwatso/homebridge-xiaomi-1c-vacuum](https://github.com/johnwatso/homebridge-xiaomi-1c-vacuum), adapted and extended for the S12. All credit for the original plugin and architecture goes to **johnwatso**.

## Features

- **Matter-native** — exposes the vacuum as a Matter Robotic Vacuum Cleaner, controllable from Apple Home and other Matter controllers.
- **9 clean modes** surfaced as Matter clean modes:
  - Vacuum: Quiet, Standard, Medium, Turbo
  - Vacuum & Mop: Quiet, Standard, Medium, Turbo
  - Mop Only
- **Correct pause / resume** — resuming continues the current job instead of restarting it.
- **Smart mode changes while paused** — changing the *cleaning type* (e.g. Vacuum → Vacuum & Mop) restarts the job; changing only the *suction level* resumes with the new suction.
- **Room cleaning (experimental)** — expose your mapped rooms as Matter service areas and start per-room cleaning from the Home app.
- **Accurate status reporting** — Standby, Vacuuming, Vacuum & Mop, Mopping, Returning, Charging, Docked, and the transient "repositioning" phase.
- **Battery, charge state and consumables** (main brush, side brush, filter).

## Requirements

- Homebridge **2.0 or newer** with **Matter enabled**.
- Node.js 22 or 24.
- Your vacuum's **local IP address**, **MIoT token**, and **device ID (DID)**.

### Getting the token and DID

Use a tool such as the [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor) to obtain the 32-character local token and the numeric device ID for your vacuum.

## Installation

Install through the Homebridge UI (search for `homebridge-xiaomi-s12-vacuum`) or manually:

```bash
npm install -g homebridge-xiaomi-s12-vacuum
```

## Configuration

Configure through the Homebridge UI, or add a platform block to your `config.json`:

```json
{
  "platforms": [
    {
      "platform": "OneCMatter",
      "name": "Xiaomi S12 Vacuum",
      "ip": "10.0.10.180",
      "token": "your-32-character-hex-token",
      "deviceId": "1064693991",
      "pollInterval": 30,
      "enableRoomCleaning": true,
      "rooms": [
        { "id": 12, "name": "Bedroom" },
        { "id": 13, "name": "Kids Room" },
        { "id": 14, "name": "Hall" },
        { "id": 15, "name": "Living Room" },
        { "id": 16, "name": "Master Bedroom" },
        { "id": 17, "name": "Kitchen" },
        { "id": 18, "name": "Bathroom" },
        { "id": 19, "name": "Corridor" }
      ]
    }
  ]
}
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | `Xiaomi S12 Vacuum` | Name shown in Homebridge and the Home app. |
| `ip` | string | — | Local IP address of the vacuum (use a reserved DHCP lease). |
| `token` | string | — | 32-character local MIoT token. |
| `deviceId` | string | — | Numeric device ID (DID). |
| `pollInterval` | number | `30` | Status poll interval in seconds (5–300). |
| `enableRoomCleaning` | boolean | `false` | Expose mapped rooms as Matter service areas. |
| `rooms` | array | `[]` | List of `{ id, name }` room entries. |

## Finding your room IDs

The S12 does not expose custom room names over the local API — it only reports a single generic room. Room IDs are, however, sequential and stable once your map has been split into named rooms in the Mi Home app.

To discover which ID maps to which room, start a single-room clean for each ID and observe where the vacuum goes. In testing, IDs started at **10** and incremented per room (e.g. `10, 11, 12, …`). Map out all your rooms once, then add them to the configuration.

## Notes and limitations

- **Battery percentage in Apple Home** may not refresh in real time on the tile due to how Homebridge's Matter layer emits the `PowerSource` battery attribute. The value is reported correctly and can be read on demand.
- Room cleaning is marked experimental; behaviour depends on your firmware and map state.
- The vacuum must be reachable on the local network; the plugin does not use the Xiaomi cloud at runtime.

## Credits

- Original plugin: [johnwatso/homebridge-xiaomi-1c-vacuum](https://github.com/johnwatso/homebridge-xiaomi-1c-vacuum)
- S12 adaptation: [garlik82](https://github.com/garlik82)

## License

MIT
