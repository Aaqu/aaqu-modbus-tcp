# @aaqu/node-red-modbus-tcp

Node-RED nodes for Modbus TCP client communication.

## Disclaimer

**THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.** The author makes no guarantees regarding the reliability, accuracy, or suitability of this software for any particular purpose. Use at your own risk. The author shall not be liable for any damages arising from the use of this software in production environments, industrial automation, or any other application.

## Features

- **Modbus TCP Client** - Connect to Modbus TCP servers (PLCs, RTUs, simulators)
- **Read Operations** - FC01, FC02, FC03, FC04
- **Write Operations** - FC05, FC06, FC15, FC16
- **Auto-reconnect** - Automatic reconnection on connection loss
- **Dynamic configuration** - Override parameters via `msg` properties
- **External Data mode** - Hide GUI fields and require parameters from `msg` only
- **Unit ID per node** - Different Unit IDs for each operation
- **No external dependencies** - Uses only native Node.js modules
- **Multi-language support** - English, Polish, Chinese, Japanese

## Installation

### From npm

```bash
npm install @aaqu/node-red-modbus-tcp
```

### From source

```bash
cd ~/.node-red
npm install /path/to/aaqu-modbus-tcp
```

After installation, restart Node-RED and refresh the browser.

## Nodes

### aaqu-modbus-client (Configuration Node)

Manages the TCP connection to a Modbus server. Shared by all operation nodes.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| Host | string | localhost | IP address or hostname of Modbus server |
| Port | number | 502 | TCP port number |
| Timeout | number | 5000 | Request timeout in milliseconds |
| Auto Reconnect | boolean | true | Automatically reconnect on connection loss |
| Reconnect Interval | number | 5000 | Time between reconnection attempts (ms) |
| Log Connection Errors | boolean | true | Log connection errors to console |
| TCP Keep-Alive | boolean | true | Enable TCP keep-alive probes |
| Keep-Alive Delay | number | 10000 | Initial delay before first keep-alive probe (ms) |
| Heartbeat | boolean | false | Send periodic Modbus requests to keep connection active |
| Heartbeat Interval | number | 5000 | Interval between heartbeat requests (ms) |
| Include Raw Response | boolean | false | Include raw Modbus frame buffer in msg.raw |

#### Connection Keep-Alive Options

The client provides multiple options to maintain stable connections:

1. **TCP Keep-Alive** - System-level TCP probes. May not work with all devices.
2. **Heartbeat** - Application-level Modbus requests. More reliable for devices that close idle connections.

**Recommendation:** If your device closes idle connections, enable **Heartbeat**. It sends periodic read requests (FC03) that are ignored but keep the connection active. Heartbeat is skipped when there are pending requests to avoid interference.

### aaqu-modbus-read

Reads data from a Modbus server.

#### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| Server | config | - | Reference to aaqu-modbus-client node |
| External Data | checkbox | false | When enabled, Unit ID/Address/Quantity are hidden and must come from msg |
| Unit ID | number | 1 | Modbus unit identifier (1-255) |
| Function | select | FC03 | Function code (FC01-FC04) |
| Address | number | 0 | Starting address (0-65535) |
| Quantity | number | 1 | Number of items to read |

#### Supported Functions

| Function | Code | Description | Max Quantity |
|----------|------|-------------|--------------|
| Read Coils | FC01 | Read coil status (bits) | 2000 |
| Read Discrete Inputs | FC02 | Read discrete input status (bits) | 2000 |
| Read Holding Registers | FC03 | Read holding registers (16-bit) | 125 |
| Read Input Registers | FC04 | Read input registers (16-bit) | 125 |

#### Input Message (optional overrides)

```javascript
msg.unitId = 2;           // Override Unit ID
msg.functionCode = 3;     // Override function code
msg.address = 100;        // Override starting address
msg.quantity = 10;        // Override quantity
```

#### External Data Mode

When **External Data** checkbox is enabled, the GUI fields for Unit ID, Address, and Quantity are hidden. These values **must** be provided in the incoming message:

```javascript
msg.unitId = 1;           // Required
msg.address = 100;        // Required
msg.quantity = 10;        // Required
msg.functionCode = 3;     // Optional (uses node config if not provided)
```

This mode is useful when parameters come from external sources (database, API, other nodes) and you don't want to configure them statically in the node.

#### Output Message

```javascript
msg.payload = [100, 101, 102, ...];  // Array of read values
msg.modbus = {
    unitId: 1,
    functionCode: 3,
    address: 0,
    quantity: 10,
    byteCount: 20
};
```

### aaqu-modbus-write

Writes a single value to a Modbus server.

#### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| Server | config | - | Reference to aaqu-modbus-client node |
| External Data | checkbox | false | When enabled, Unit ID/Address are hidden and must come from msg |
| Unit ID | number | 1 | Modbus unit identifier (1-255) |
| Function | select | FC06 | Function code (FC05 or FC06) |
| Address | number | 0 | Address to write (0-65535) |

#### Supported Functions

| Function | Code | Description | Value Range |
|----------|------|-------------|-------------|
| Write Single Coil | FC05 | Write single coil | true/false |
| Write Single Register | FC06 | Write single register | 0-65535 |

#### Input Message

```javascript
msg.payload = 1234;       // Value to write (number for registers, boolean for coils)
msg.unitId = 2;           // Optional: Override Unit ID
msg.functionCode = 6;     // Optional: Override function code
msg.address = 100;        // Optional: Override address
```

#### External Data Mode

When **External Data** checkbox is enabled, the GUI fields for Unit ID and Address are hidden. These values **must** be provided in the incoming message:

```javascript
msg.payload = 1234;       // Value to write
msg.unitId = 1;           // Required
msg.address = 100;        // Required
msg.functionCode = 6;     // Optional (uses node config if not provided)
```

#### Output Message

```javascript
msg.payload = 1234;       // Original payload (unchanged)
msg.modbus = {
    unitId: 1,
    functionCode: 6,
    address: 100,
    value: 1234
};
```

### aaqu-modbus-write-multiple

Writes multiple values to a Modbus server. This node operates in **forced external data mode** - Unit ID and Address must always be provided via the incoming message.

#### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| Server | config | - | Reference to aaqu-modbus-client node |
| Function | select | FC16 | Function code (FC15 or FC16) |

> **Note:** Unit ID and Address are not configurable in the node. They must be provided in `msg.unitId` and `msg.address`.

#### Supported Functions

| Function | Code | Description | Max Quantity |
|----------|------|-------------|--------------|
| Write Multiple Coils | FC15 | Write multiple coils | 1968 |
| Write Multiple Registers | FC16 | Write multiple registers | 123 |

#### Input Message

```javascript
msg.payload = [100, 200, 300];  // Array of values to write
msg.unitId = 1;                  // Required: Modbus Unit ID (1-255)
msg.address = 100;               // Required: Starting address (0-65535)
msg.functionCode = 16;           // Optional: Override function code
```

#### Output Message

```javascript
msg.payload = [100, 200, 300];  // Original payload (unchanged)
msg.requestModbus = {
    unitId: 1,
    functionCode: 16,
    address: 100,
    quantity: 3
};
```

#### Why External Data Mode?

This node is designed for dynamic, data-driven scenarios where parameters come from external sources (database, API, other nodes). This makes it ideal for:
- Multi-device communication with varying addresses
- Dynamic write operations based on external configuration
- Integration with SCADA systems and databases

## Examples

### Read 10 Holding Registers

```
[inject] -> [aaqu-modbus-read] -> [debug]
```

Configure aaqu-modbus-read:
- Function: FC03 - Read Holding Registers
- Address: 0
- Quantity: 10
- Unit ID: 1

### Write Single Register

```
[inject (payload: 1234)] -> [aaqu-modbus-write] -> [debug]
```

Configure aaqu-modbus-write:
- Function: FC06 - Write Single Register
- Address: 0
- Unit ID: 1

### Write Multiple Registers

```
[inject] -> [function] -> [aaqu-modbus-write-multiple] -> [debug]
```

Inject node sends payload, Function node adds required properties:
```javascript
msg.payload = [100, 200, 300];
msg.unitId = 1;
msg.address = 100;
return msg;
```

Configure aaqu-modbus-write-multiple:
- Function: FC16 - Write Multiple Registers

### Dynamic Configuration

Use a function node to set parameters dynamically:

```javascript
msg.unitId = 2;
msg.address = flow.get('startAddress') || 0;
msg.quantity = 5;
return msg;
```

### External Data Mode

When you need all parameters to come from external sources (database, API, etc.), enable **External Data** checkbox. This hides the GUI fields and requires values in the message:

```
[inject] -> [function] -> [aaqu-modbus-read (External Data: ON)] -> [debug]
```

Function node:
```javascript
msg.unitId = msg.payload.deviceId;
msg.address = msg.payload.registerAddress;
msg.quantity = msg.payload.count;
return msg;
```

This is useful for:
- Reading device configuration from database
- Dynamic polling based on external schedules
- Multi-device scanning with varying parameters

## Error Handling

Errors are reported through Node-RED's standard error handling:

1. **Node status** - Visual indicator (red ring with error message)
2. **Catch node** - Use a catch node to handle errors programmatically
3. **Debug sidebar** - Errors appear in the debug sidebar

### Common Errors

| Error | Description | Solution |
|-------|-------------|----------|
| Not connected | No connection to server | Check host/port, network connectivity |
| Request timeout | Server didn't respond in time | Increase timeout, check server |
| Illegal Data Address | Invalid address | Check address range |
| Illegal Data Value | Invalid value | Check value range |
| Illegal Function | Function not supported | Check server capabilities |

## Modbus Protocol Reference

### Address Space

| Type | Address Range | Description |
|------|---------------|-------------|
| Coils | 0-65535 | Read/Write single bits |
| Discrete Inputs | 0-65535 | Read-only single bits |
| Holding Registers | 0-65535 | Read/Write 16-bit values |
| Input Registers | 0-65535 | Read-only 16-bit values |

### Data Types

- **Coils/Discrete Inputs**: Boolean (true/false)
- **Registers**: 16-bit unsigned integer (0-65535)

For larger data types (32-bit, float, etc.), read multiple consecutive registers and combine them in a function node.

### Unit ID

The Unit ID (also called Slave ID) identifies the target device when multiple devices share a connection (e.g., through a gateway). Valid range: 1-255.

## Testing

Run the test suite:

```bash
npm test
```

## Supported Languages

| Language | Locale |
|----------|--------|
| English | en-US |
| Polish | pl-PL |
| Chinese (Simplified) | zh-CN |
| Japanese | ja-JP |

## Requirements

- Node.js >= 14.0.0
- Node-RED >= 2.0.0
- No external dependencies (uses native Node.js `net` module)

## License

MIT

## Author

Aaqu

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## Changelog

### 0.3.1 (2026-02-05)

- **Fixed memory leak** - Event listeners (`connected`/`disconnected`) on config node are now properly removed when operation nodes are closed/redeployed

### 0.3.0 (2026-02-05)

- **Heartbeat** - periodic Modbus requests to keep connections alive
  - Configurable interval (default: 5000ms)
  - Automatically skipped when there are pending requests
- **External Data mode** for modbus-read and modbus-write nodes
  - When enabled, Unit ID/Address/Quantity fields are hidden and must come from msg
  - When disabled, `msg.*` overrides are ignored (uses only node config)
- **modbus-write-multiple** now operates in forced external data mode
  - Unit ID and Address must be provided via `msg.unitId` and `msg.address`
- **Include Raw Response** option in client config
  - When enabled, includes raw Modbus frame buffer in msg.raw (default: disabled)
- Fixed checkbox state persistence in configuration dialog
- Updated External Data hints to show parameter names (msg.unitId, msg.address, msg.quantity)
- Improved disconnect logging with reason (`error` or `server closed`)
- Added disclaimer to README

### 0.2.1

- Fixed uncaught exception when Modbus server is unavailable (ECONNREFUSED)
- Improved error handling to prevent Node-RED crash on connection errors
- Added host:port info to connection error messages
- Fixed timeout when closing Node-RED with unavailable Modbus server
- Added option to disable connection error logging in console

### 0.2.0

- Fixed node names to be unique (added `aaqu-` prefix)
- Changed palette category to "Aaqu Portal"
- Renamed locale files to match new node names

### 0.1.3

- Update README

### 0.1.2

- Test github actions

### 0.1.1

- Added to npm registry
- Updated README

### 0.1.0

- Initial release
- Support for FC01, FC02, FC03, FC04 (read operations)
- Support for FC05, FC06, FC15, FC16 (write operations)
- Auto-reconnect functionality
- Unit ID configuration per node
- Dynamic parameter override via message properties
