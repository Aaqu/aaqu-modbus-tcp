# Changelog

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
