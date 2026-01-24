'use strict';

const net = require('net');
const EventEmitter = require('events');
const { FUNCTION_CODES, EXCEPTION_CODES, EXCEPTION_MESSAGES, COIL_VALUES, LIMITS, MBAP } = require('./constants');

class ModbusError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'ModbusError';
        this.code = code;
    }
}

class ModbusClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.host = options.host || 'localhost';
        this.port = options.port || MBAP.DEFAULT_PORT;
        this.timeout = options.timeout || MBAP.DEFAULT_TIMEOUT;
        this.reconnect = options.reconnect !== false;
        this.reconnectInterval = options.reconnectInterval || 5000;

        this._socket = null;
        this._connected = false;
        this._connecting = false;
        this._transactionId = 0;
        this._pendingRequests = new Map();
        this._reconnectTimer = null;
        this._buffer = Buffer.alloc(0);
    }

    get connected() {
        return this._connected;
    }

    _getNextTransactionId() {
        this._transactionId = (this._transactionId + 1) & 0xFFFF;
        return this._transactionId;
    }

    connect() {
        return new Promise((resolve, reject) => {
            if (this._connected) {
                resolve();
                return;
            }

            if (this._connecting) {
                this.once('connect', resolve);
                this.once('error', reject);
                return;
            }

            this._connecting = true;
            this._socket = new net.Socket();

            const onConnect = () => {
                this._connected = true;
                this._connecting = false;
                this._clearReconnectTimer();
                this.emit('connect');
                resolve();
            };

            const onError = (err) => {
                this._connecting = false;
                if (!this._connected) {
                    reject(err);
                }
                // Emit error only if there are listeners to prevent uncaught exception
                if (this.listenerCount('error') > 0) {
                    this.emit('error', err);
                }
                this._scheduleReconnect();
            };

            const onClose = () => {
                const wasConnected = this._connected;
                this._connected = false;
                this._connecting = false;
                this._rejectPendingRequests(new ModbusError('Connection closed'));
                if (wasConnected) {
                    this.emit('disconnect');
                    this._scheduleReconnect();
                }
            };

            const onData = (data) => {
                this._handleData(data);
            };

            this._socket.once('connect', onConnect);
            this._socket.on('error', onError);
            this._socket.on('close', onClose);
            this._socket.on('data', onData);

            this._socket.connect(this.port, this.host);
        });
    }

    disconnect() {
        return new Promise((resolve) => {
            this._clearReconnectTimer();
            this.reconnect = false;
            this._connecting = false;

            if (!this._socket) {
                resolve();
                return;
            }

            this._rejectPendingRequests(new ModbusError('Disconnecting'));

            const socket = this._socket;
            this._socket = null;
            this._connected = false;

            // Remove all listeners to prevent memory leaks
            socket.removeAllListeners();
            socket.destroy();

            // Resolve immediately - don't wait for 'close' event
            resolve();
        });
    }

    _scheduleReconnect() {
        if (!this.reconnect || this._reconnectTimer) {
            return;
        }

        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (this.reconnect && !this._connected && !this._connecting) {
                this.connect().catch(() => {});
            }
        }, this.reconnectInterval);
    }

    _clearReconnectTimer() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    _rejectPendingRequests(error) {
        for (const [, request] of this._pendingRequests) {
            clearTimeout(request.timer);
            request.reject(error);
        }
        this._pendingRequests.clear();
    }

    _handleData(data) {
        this._buffer = Buffer.concat([this._buffer, data]);

        while (this._buffer.length >= MBAP.HEADER_LENGTH) {
            const length = this._buffer.readUInt16BE(4);
            const totalLength = MBAP.HEADER_LENGTH - 1 + length;

            if (this._buffer.length < totalLength) {
                break;
            }

            const frame = this._buffer.slice(0, totalLength);
            this._buffer = this._buffer.slice(totalLength);

            this._processResponse(frame);
        }
    }

    _processResponse(frame) {
        const transactionId = frame.readUInt16BE(0);
        const request = this._pendingRequests.get(transactionId);

        if (!request) {
            return;
        }

        clearTimeout(request.timer);
        this._pendingRequests.delete(transactionId);

        const functionCode = frame[MBAP.HEADER_LENGTH];

        if (functionCode & 0x80) {
            const exceptionCode = frame[MBAP.HEADER_LENGTH + 1];
            const message = EXCEPTION_MESSAGES[exceptionCode] || `Unknown exception: ${exceptionCode}`;
            request.reject(new ModbusError(message, exceptionCode));
            return;
        }

        const pdu = frame.slice(MBAP.HEADER_LENGTH);
        request.resolve(this._parseResponse(request.functionCode, pdu));
    }

    _parseResponse(functionCode, pdu) {
        switch (functionCode) {
            case FUNCTION_CODES.READ_COILS:
            case FUNCTION_CODES.READ_DISCRETE_INPUTS:
                return this._parseBitResponse(pdu);

            case FUNCTION_CODES.READ_HOLDING_REGISTERS:
            case FUNCTION_CODES.READ_INPUT_REGISTERS:
                return this._parseRegisterResponse(pdu);

            case FUNCTION_CODES.WRITE_SINGLE_COIL:
                return this._parseWriteSingleCoilResponse(pdu);

            case FUNCTION_CODES.WRITE_SINGLE_REGISTER:
                return this._parseWriteSingleRegisterResponse(pdu);

            case FUNCTION_CODES.WRITE_MULTIPLE_COILS:
            case FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS:
                return this._parseWriteMultipleResponse(pdu);

            default:
                return { raw: pdu };
        }
    }

    _parseBitResponse(pdu) {
        const byteCount = pdu[1];
        const bits = [];

        for (let i = 0; i < byteCount; i++) {
            const byte = pdu[2 + i];
            for (let bit = 0; bit < 8; bit++) {
                bits.push((byte >> bit) & 1 ? true : false);
            }
        }

        return { values: bits, byteCount };
    }

    _parseRegisterResponse(pdu) {
        const byteCount = pdu[1];
        const registers = [];

        for (let i = 0; i < byteCount; i += 2) {
            registers.push(pdu.readUInt16BE(2 + i));
        }

        return { values: registers, byteCount };
    }

    _parseWriteSingleCoilResponse(pdu) {
        return {
            address: pdu.readUInt16BE(1),
            value: pdu.readUInt16BE(3) === COIL_VALUES.ON
        };
    }

    _parseWriteSingleRegisterResponse(pdu) {
        return {
            address: pdu.readUInt16BE(1),
            value: pdu.readUInt16BE(3)
        };
    }

    _parseWriteMultipleResponse(pdu) {
        return {
            address: pdu.readUInt16BE(1),
            quantity: pdu.readUInt16BE(3)
        };
    }

    _buildMBAPHeader(transactionId, pduLength, unitId) {
        const header = Buffer.alloc(MBAP.HEADER_LENGTH);
        header.writeUInt16BE(transactionId, 0);
        header.writeUInt16BE(MBAP.PROTOCOL_ID, 2);
        header.writeUInt16BE(pduLength + 1, 4);
        header.writeUInt8(unitId, 6);
        return header;
    }

    _sendRequest(functionCode, pdu, unitId) {
        return new Promise((resolve, reject) => {
            if (!this._connected) {
                reject(new ModbusError('Not connected'));
                return;
            }

            const effectiveUnitId = unitId !== undefined ? unitId : MBAP.DEFAULT_UNIT_ID;
            const transactionId = this._getNextTransactionId();
            const header = this._buildMBAPHeader(transactionId, pdu.length, effectiveUnitId);
            const frame = Buffer.concat([header, pdu]);

            const timer = setTimeout(() => {
                this._pendingRequests.delete(transactionId);
                reject(new ModbusError('Request timeout'));
            }, this.timeout);

            this._pendingRequests.set(transactionId, {
                functionCode,
                resolve,
                reject,
                timer
            });

            this._socket.write(frame);
        });
    }

    _validateAddress(address) {
        if (address < 0 || address > LIMITS.MAX_ADDRESS) {
            throw new ModbusError(`Address out of range: ${address}`, EXCEPTION_CODES.ILLEGAL_DATA_ADDRESS);
        }
    }

    _validateQuantity(quantity, max, min = 1) {
        if (quantity < min || quantity > max) {
            throw new ModbusError(`Quantity out of range: ${quantity} (allowed: ${min}-${max})`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }
    }

    readCoils(address, quantity, unitId) {
        this._validateAddress(address);
        this._validateQuantity(quantity, LIMITS.MAX_COILS_READ);

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.READ_COILS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(quantity, 3);

        return this._sendRequest(FUNCTION_CODES.READ_COILS, pdu, unitId)
            .then(result => {
                result.values = result.values.slice(0, quantity);
                return result;
            });
    }

    readDiscreteInputs(address, quantity, unitId) {
        this._validateAddress(address);
        this._validateQuantity(quantity, LIMITS.MAX_DISCRETE_INPUTS_READ);

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.READ_DISCRETE_INPUTS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(quantity, 3);

        return this._sendRequest(FUNCTION_CODES.READ_DISCRETE_INPUTS, pdu, unitId)
            .then(result => {
                result.values = result.values.slice(0, quantity);
                return result;
            });
    }

    readHoldingRegisters(address, quantity, unitId) {
        this._validateAddress(address);
        this._validateQuantity(quantity, LIMITS.MAX_REGISTERS_READ);

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.READ_HOLDING_REGISTERS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(quantity, 3);

        return this._sendRequest(FUNCTION_CODES.READ_HOLDING_REGISTERS, pdu, unitId);
    }

    readInputRegisters(address, quantity, unitId) {
        this._validateAddress(address);
        this._validateQuantity(quantity, LIMITS.MAX_REGISTERS_READ);

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.READ_INPUT_REGISTERS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(quantity, 3);

        return this._sendRequest(FUNCTION_CODES.READ_INPUT_REGISTERS, pdu, unitId);
    }

    writeSingleCoil(address, value, unitId) {
        this._validateAddress(address);

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.WRITE_SINGLE_COIL, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(value ? COIL_VALUES.ON : COIL_VALUES.OFF, 3);

        return this._sendRequest(FUNCTION_CODES.WRITE_SINGLE_COIL, pdu, unitId);
    }

    writeSingleRegister(address, value, unitId) {
        this._validateAddress(address);

        if (value < 0 || value > 0xFFFF) {
            throw new ModbusError(`Register value out of range: ${value}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.WRITE_SINGLE_REGISTER, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(value, 3);

        return this._sendRequest(FUNCTION_CODES.WRITE_SINGLE_REGISTER, pdu, unitId);
    }

    writeMultipleCoils(address, values, unitId) {
        this._validateAddress(address);

        if (!Array.isArray(values)) {
            throw new ModbusError('Values must be an array', EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        this._validateQuantity(values.length, LIMITS.MAX_COILS_WRITE);

        const byteCount = Math.ceil(values.length / 8);
        const pdu = Buffer.alloc(6 + byteCount);

        pdu.writeUInt8(FUNCTION_CODES.WRITE_MULTIPLE_COILS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(values.length, 3);
        pdu.writeUInt8(byteCount, 5);

        for (let i = 0; i < values.length; i++) {
            if (values[i]) {
                const byteIndex = Math.floor(i / 8);
                const bitIndex = i % 8;
                pdu[6 + byteIndex] |= (1 << bitIndex);
            }
        }

        return this._sendRequest(FUNCTION_CODES.WRITE_MULTIPLE_COILS, pdu, unitId);
    }

    writeMultipleRegisters(address, values, unitId) {
        this._validateAddress(address);

        if (!Array.isArray(values)) {
            throw new ModbusError('Values must be an array', EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        this._validateQuantity(values.length, LIMITS.MAX_REGISTERS_WRITE);

        const byteCount = values.length * 2;
        const pdu = Buffer.alloc(6 + byteCount);

        pdu.writeUInt8(FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(values.length, 3);
        pdu.writeUInt8(byteCount, 5);

        for (let i = 0; i < values.length; i++) {
            const value = values[i];
            if (value < 0 || value > 0xFFFF) {
                throw new ModbusError(`Register value out of range at index ${i}: ${value}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
            }
            pdu.writeUInt16BE(value, 6 + i * 2);
        }

        return this._sendRequest(FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS, pdu, unitId);
    }
}

module.exports = {
    ModbusClient,
    ModbusError,
    FUNCTION_CODES,
    EXCEPTION_CODES,
    EXCEPTION_MESSAGES,
    COIL_VALUES,
    LIMITS,
    MBAP
};
