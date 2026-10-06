# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.7] - 2026-08-27

### Added
- **Structured Support:** Added GitHub issue forms for bug reports and feature requests so real-world model, network, and controller feedback can guide future updates.
- **Remote-Control Troubleshooting:** Documented the Mi Home remote-control and Siri return-to-dock behaviour, including the quick state refresh introduced in 1.1.6.

### Changed
- **Discoverability:** Refined the repository description and added topics for Homebridge, Matter, Xiaomi, Mi Home, local LAN control, and robotic vacuums.

## [1.1.6] - 2026-08-27

### Fixed
- **Siri Return-to-Dock After Remote Control:** Mi Home's manual remote control can leave the vacuum reporting `Idle` with a stale local "charging / docked" property after it has been moved away from its dock. The plugin now trusts the explicit operational status for charging and docked state, so it reports that remote-moved idle vacuum as off-dock and Siri can send the return-to-dock command.
- **Conservative Battery Charge State:** Battery charging is no longer inferred from the stale local charging property while the vacuum is idle, preventing Apple Home from incorrectly treating an off-dock vacuum as fully charged or docked.

## [1.1.5] - 2026-08-21

### Fixed
- **External Control State:** Poll the local operational state every 5 seconds, so state changes made in Mi Home are promptly reflected in Apple Home and Siri without increasing the full status/consumables polling frequency.
- **Dock State Reporting:** Expose Matter's distinct `Charging` and `Docked` operational states instead of reporting both as generic stopped, preventing Siri from using an inaccurate dock status.

## [1.1.4] - 2026-08-17

### Fixed
- **Property Error Recovery:** MIoT per-property error responses now fail the status read and enter the existing retry/backoff path instead of being interpreted as device values. Exhausted property retries now surface a clear error rather than silently returning an empty result.
- **Diagnostic Accuracy:** The local diagnostic helper now reports invalid or failed `get_properties` responses instead of displaying a misleading partial summary.
- **Secret-Safe Validation:** Invalid local tokens are no longer included in Homebridge log messages, and IP validation now rejects out-of-range IPv4 addresses.
- **Dependency Audit:** Pinned patched transitive dependency versions through npm overrides, removing the known production audit findings without downgrading `miio`.

### Added
- **Automated Tests and CI:** Added Node's built-in test suite and a GitHub Actions matrix for Node 22 and 24, including the production dependency audit.
- **License:** Added the MIT license text to the repository and npm package.

### Changed
- **Tooling:** Updated the Homebridge development dependency to 2.4 and aligned Node type definitions with the supported Node 22+ runtime.
- **Package Size:** Reduced the bundled logo size while retaining a high-resolution image for the README.

## [1.1.3] - 2026-06-22

### Added
- **Matter State Update Timeout:** Added a configurable `matterUpdateTimeout` setting, defaulting to `10000` milliseconds, so Homebridge/Matter state writes cannot leave polling permanently marked as in progress if a controller update stalls.
- **Status Update Watchdog:** Added a configurable `statusUpdateWatchdog` setting, defaulting to `90000` milliseconds, so a later status poll can recover if a previous refresh runs longer than expected.

### Changed
- **Identify Recovery:** The Identify/Play Sound command now schedules a fast status refresh after the locate command succeeds, making the recovery path explicit instead of waiting for the next normal polling interval.

### Fixed
- **Matter Update Hangs:** Reduced another way the accessory could appear stuck updating by timing out Homebridge/Matter state writes and allowing the watchdog to clear stale in-progress status refreshes.

## [1.1.2] - 2026-06-20

### Added
- **Configurable Local Request Timeout:** Added a `requestTimeout` setting, defaulting to `15000` milliseconds, so local Xiaomi/MiIO requests cannot wait indefinitely on a stale UDP connection.

### Changed
- **Local Request Guarding:** Wrapped local property reads, actions, property writes, and startup device-info reads in a shared timeout guard. When a request times out, the plugin now resets the stale local connection and allows the normal retry/recovery path to continue.
- **Diagnostic Helper Reliability:** Added the same timeout behavior to `npm run check:local` so local checks, locate commands, and consumable reset commands fail with a clear timeout instead of hanging.

### Fixed
- **Stuck Updating State:** Fixed an issue where status polling could remain stuck in an in-progress update if the underlying local Xiaomi request never resolved. This could make the vacuum appear frozen in Apple Home or Homebridge until another command, such as Identify/Play Sound, caused fresh local traffic and shook the connection loose.

## [1.1.1] - 2026-06-19

### Fixed
- Included `CHANGELOG.md` in the release package and aligned git tags to show release notes correctly in the Homebridge UI.

## [1.1.0] - 2026-06-19

### Added
- **Dynamic Firmware Version Reporting:** Retrieve the vacuum's actual firmware version (e.g. `3.5.8_1059`) at startup via local connection instead of using a static fallback.
- **Config Validation:** Added strict format validation checks for `ip`, `token` (32 hex characters), and `deviceId` (numeric) during platform initialization to produce clear, friendly startup logs.
- **Room Cleaning (Experimental):** Added room-by-room vacuuming support using the Matter `ServiceArea` cluster. Exposes saved room IDs to controllers for targeted cleaning.

### Changed
- **Battery Status Mapping:** Refined the battery charging state mapping for the Matter `PowerSource.batChargeState` enum to support charging, discharging, and full-charge states correctly.

### Fixed
- **Command Retries:** Added retries (using `connectAttempts`) to UDP commands in `doAction(...)` for improved local network reliability.
- **Parsing Robustness:** Made property mapping bounds-safe to prevent runtime crashes if the device returns partial or missing values.
- **Legacy Cache Leak:** Automatically unregister cached legacy HAP platform accessories on startup when Matter mode is active, avoiding duplicate or unresponsive objects in Homebridge.

---

## [1.0.2] - 2026-05-26

### Changed
- Normalized package structure with a whitelisted `files` list in `package.json` to keep package sizes lightweight.
- Extensively updated documentation, including network configuration guides for cross-subnet VLAN setups and details of supported models.

### Fixed
- Polished diagnostic messages, connection timing, and overall Command response times.

---

## [1.0.1] - 2026-05-26

### Added
- **Local LAN Control:** Bypasses Xiaomi Cloud by talking directly to the vacuum locally via the UDP `miIO` transport.
- **Matter Fan/Cleaner Control:** Exposes Quiet, Default, Medium, and Strong suction modes.
- **Locate Command:** Registers standard HomeKit identify callbacks to trigger the vacuum's audible locate command.
- **Consumable Warning Log:** Warns the user when the brush or filter life dips below configured thresholds (default: 20%).
- **CLI Diagnostic Helper:** Added a `check:local` utility to verify network settings and reset consumables (filter, main brush, side brush) from the command line.
