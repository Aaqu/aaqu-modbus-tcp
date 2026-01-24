# aaqu modbus tcp

Node-RED nodes for Modbus TCP client communication.

## Features

- **Modbus TCP Client** - Connect to Modbus TCP servers (PLCs, RTUs, simulators)
- **Read Operations** - FC01, FC02, FC03, FC04
- **Write Operations** - FC05, FC06, FC15, FC16
- **Auto-reconnect** - Automatic reconnection on connection loss
- **Dynamic configuration** - Override parameters via `msg` properties
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

### aaqu-modbus-read

Reads data from a Modbus server.

#### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| Server | config | - | Reference to aaqu-modbus-client node |
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

Writes multiple values to a Modbus server.

#### Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| Server | config | - | Reference to aaqu-modbus-client node |
| Unit ID | number | 1 | Modbus unit identifier (1-255) |
| Function | select | FC16 | Function code (FC15 or FC16) |
| Address | number | 0 | Starting address (0-65535) |

#### Supported Functions

| Function | Code | Description | Max Quantity |
|----------|------|-------------|--------------|
| Write Multiple Coils | FC15 | Write multiple coils | 1968 |
| Write Multiple Registers | FC16 | Write multiple registers | 123 |

#### Input Message

```javascript
msg.payload = [100, 200, 300];  // Array of values to write
msg.unitId = 2;                  // Optional: Override Unit ID
msg.functionCode = 16;           // Optional: Override function code
msg.address = 100;               // Optional: Override starting address
```

#### Output Message

```javascript
msg.payload = [100, 200, 300];  // Original payload (unchanged)
msg.modbus = {
    unitId: 1,
    functionCode: 16,
    address: 100,
    quantity: 3
};
```

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
[inject (payload: [100, 200, 300])] -> [aaqu-modbus-write-multiple] -> [debug]
```

Configure aaqu-modbus-write-multiple:
- Function: FC16 - Write Multiple Registers
- Address: 100
- Unit ID: 1

### Dynamic Configuration

Use a function node to set parameters dynamically:

```javascript
msg.unitId = 2;
msg.address = flow.get('startAddress') || 0;
msg.quantity = 5;
return msg;
```

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
