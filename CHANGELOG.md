# Changelog

## [0.2.3] - 2026-01-28

### Added
- TCP Keep-Alive support to prevent connection drops from firewalls/routers
- `keepAlive` option (default: enabled)
- `keepAliveInitialDelay` option (default: 10000ms)
- `bugs` field in package.json
- `homepage` field in package.json

## [0.2.2] - 2026-01-28

### Changed
- Renamed example file from `basic-usage.json` to `basic usage.json`
- Updated package description to be more descriptive

## [0.2.1]

### Fixed
- Client fixes

## [0.2.0]

### Changed
- Updated to unique names for Node-RED nodes

## [0.1.0]

### Added
- Initial release
- ModbusClient class with TCP connection management
- Read nodes (FC01-FC04): coils, discrete inputs, holding/input registers
- Write nodes (FC05, FC06): single coil and register
- Write multiple nodes (FC15, FC16): multiple coils and registers
- Auto-reconnect functionality
- Multi-language support (en-US, pl-PL, ja-JP, zh-CN)
