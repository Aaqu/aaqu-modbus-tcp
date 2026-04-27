# Changelog

## [0.4.1] - 2026-04-28

### Documentation
- README updated with new nodes (`aaqu-modbus-read-write`, `aaqu-modbus-diagnostic`, `aaqu-modbus-file`), new function codes (FC22 mask write, FC24 FIFO), and feature list.
- Inline `Changelog` section moved out of README; full version history now lives in `CHANGELOG.md`.
- Backfilled missing 0.1.x and 0.3.x entries in `CHANGELOG.md`.

## [0.4.0] - 2026-04-28

### Added
- Extended Modbus TCP function codes:
  - FC17 (`reportServerId`)
  - FC20 (`readFileRecord`)
  - FC21 (`writeFileRecord`)
  - FC22 (`maskWriteRegister`)
  - FC23 (`readWriteMultipleRegisters`)
  - FC24 (`readFifoQueue`)
  - FC43/14 (`readDeviceIdentification`, MEI 0x0E)
- Three new Node-RED nodes:
  - `aaqu-modbus-read-write` — atomic read/write multiple registers (FC23)
  - `aaqu-modbus-diagnostic` — server ID and device identification (FC17, FC43/14)
  - `aaqu-modbus-file` — file record read/write (FC20, FC21)
- FC22 mask write integrated into existing `aaqu-modbus-write` node
- FC24 FIFO read integrated into existing `aaqu-modbus-read` node
- Response byte-count validation for all read operations (rejects malformed frames)
- New constants: `MEI_TYPES`, `DEVICE_ID_CODES`, `DEVICE_ID_OBJECTS`,
  `FILE_RECORD_REFERENCE_TYPE`, plus `MAX_FIFO_COUNT`, `MAX_RW_READ_REGISTERS`,
  `MAX_RW_WRITE_REGISTERS`, `MAX_FILE_RECORD_LENGTH` in `LIMITS`
- Locales (en-US, pl-PL, ja-JP, zh-CN) for the three new nodes
- Documentation: `aaqu-modbus-tcp Implementation Notes` section in
  `dev/docs/modbus_implementation_documentation.md` covering connection lifecycle,
  auto-reconnect, heartbeat, Node-RED layer, External Data mode, status indicators,
  message schema, error handling, byte-count validation, and out-of-scope FC list.

### Out of scope
- FC07, FC08, FC11, FC12 — Serial Line only per spec V1.1b3 §6, not applicable to TCP.

## [0.3.2] - 2026-02-05

### Fixed
- `MaxListenersExceededWarning` — event listeners on `ModbusClient` (`connect`/`disconnect`/`error`) are now removed when the config node is closed.
- Config node allows unlimited listeners, preventing warnings when 10+ operational nodes share a connection.

## [0.3.1] - 2026-02-05

### Fixed
- Memory leak: `connected`/`disconnected` listeners on the config node are now properly removed when operation nodes are closed/redeployed.

## [0.3.0] - 2026-02-05

### Added
- **Heartbeat** — periodic Modbus requests to keep connections alive.
  - Configurable interval (default: 5000 ms).
  - Automatically skipped when there are pending requests.
- **External Data mode** for `modbus-read` and `modbus-write` nodes.
  - When enabled, Unit ID/Address/Quantity fields are hidden and must come from `msg`.
  - When disabled, `msg.*` overrides are ignored (uses only node config).
- `modbus-write-multiple` now operates in forced external data mode (Unit ID and Address must come from `msg`).
- **Include Raw Response** option in client config (includes raw Modbus frame buffer in `msg.raw`).
- Disclaimer in README.

### Changed
- Improved disconnect logging with reason (`error` or `server closed`).
- Updated External Data hints to show parameter names (`msg.unitId`, `msg.address`, `msg.quantity`).

### Fixed
- Checkbox state persistence in configuration dialog.

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
- Uncaught exception when Modbus server is unavailable (ECONNREFUSED).
- Improved error handling to prevent Node-RED crash on connection errors.
- Timeout when closing Node-RED with an unavailable Modbus server.

### Added
- `host:port` info in connection error messages.
- Option to disable connection error logging in console.

## [0.2.0]

### Changed
- Node names made unique (added `aaqu-` prefix).
- Palette category changed to "Aaqu Portal".
- Locale files renamed to match new node names.

## [0.1.3]

### Changed
- README updates.

## [0.1.2]

### Changed
- Test GitHub Actions.

## [0.1.1]

### Added
- Published to npm registry.
- README updates.

## [0.1.0]

### Added
- Initial release
- ModbusClient class with TCP connection management
- Read nodes (FC01-FC04): coils, discrete inputs, holding/input registers
- Write nodes (FC05, FC06): single coil and register
- Write multiple nodes (FC15, FC16): multiple coils and registers
- Auto-reconnect functionality
- Multi-language support (en-US, pl-PL, ja-JP, zh-CN)
