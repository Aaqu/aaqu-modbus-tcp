'use strict';

const net = require('net');
const EventEmitter = require('events');
const {
    FUNCTION_CODES,
    EXCEPTION_CODES,
    EXCEPTION_MESSAGES,
    COIL_VALUES,
    LIMITS,
    MBAP,
    MEI_TYPES,
    DEVICE_ID_CODES,
    DEVICE_ID_OBJECTS,
    FILE_RECORD_REFERENCE_TYPE
} = require('./constants');

class ModbusError extends Error {
    constructor(message, code, raw) {
        super(message);
        this.name = 'ModbusError';
        this.code = code;
        this.raw = raw;
    }
}

class ModbusClient extends EventEmitter {
    constructor(options = {}) {
        super();
        this.host = options.host || 'localhost';
        this.port = options.port || MBAP.DEFAULT_PORT;
        this.timeout = options.timeout || MBAP.DEFAULT_TIMEOUT;
        this._reconnectEnabled = options.reconnect !== false;
        this.reconnect = this._reconnectEnabled;
        this.reconnectInterval = options.reconnectInterval || 5000;
        this.keepAlive = options.keepAlive !== false;
        this.keepAliveInitialDelay = options.keepAliveInitialDelay || 10000;

        this._socket = null;
        this._connected = false;
        this._connecting = false;
        this._transactionId = 0;
        this._pendingRequests = new Map();
        this._reconnectTimer = null;
        this._heartbeatTimer = null;
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

            // Przywróć oryginalną wartość reconnect i wyczyść buffer
            this.reconnect = this._reconnectEnabled;
            this._buffer = Buffer.alloc(0);

            this._connecting = true;
            this._socket = new net.Socket();
            this._socket.setKeepAlive(this.keepAlive, this.keepAliveInitialDelay);

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

            const onClose = (hadError) => {
                const wasConnected = this._connected;
                this._connected = false;
                this._connecting = false;
                this._rejectPendingRequests(new ModbusError('Connection closed'));
                if (wasConnected) {
                    this.emit('disconnect', { hadError });
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
            this.stopHeartbeat();
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

    startHeartbeat(interval, address = 0, quantity = 1, unitId = 1) {
        this.stopHeartbeat();
        this._heartbeatTimer = setInterval(() => {
            // Skip heartbeat when there are pending requests or not connected
            if (this._connected && this._pendingRequests.size === 0) {
                this.readHoldingRegisters(address, quantity, unitId).catch(() => {});
            }
        }, interval);
    }

    stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
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
            request.resolve({
                error: true,
                code: exceptionCode,
                message: message,
                raw: Buffer.from(frame)
            });
            return;
        }

        const pdu = frame.slice(MBAP.HEADER_LENGTH);
        try {
            request.resolve(this._parseResponse(request.functionCode, pdu, frame, request.expectedQuantity));
        } catch (err) {
            request.reject(err);
        }
    }

    _parseResponse(functionCode, pdu, frame, expectedQuantity) {
        const raw = Buffer.from(frame);
        let result;

        switch (functionCode) {
            case FUNCTION_CODES.READ_COILS:
            case FUNCTION_CODES.READ_DISCRETE_INPUTS:
                result = this._parseBitResponse(pdu, expectedQuantity);
                break;

            case FUNCTION_CODES.READ_HOLDING_REGISTERS:
            case FUNCTION_CODES.READ_INPUT_REGISTERS:
                result = this._parseRegisterResponse(pdu, expectedQuantity);
                break;

            case FUNCTION_CODES.WRITE_SINGLE_COIL:
                result = this._parseWriteSingleCoilResponse(pdu);
                break;

            case FUNCTION_CODES.WRITE_SINGLE_REGISTER:
                result = this._parseWriteSingleRegisterResponse(pdu);
                break;

            case FUNCTION_CODES.WRITE_MULTIPLE_COILS:
            case FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS:
                result = this._parseWriteMultipleResponse(pdu);
                break;

            case FUNCTION_CODES.MASK_WRITE_REGISTER:
                result = this._parseMaskWriteResponse(pdu);
                break;

            case FUNCTION_CODES.READ_WRITE_MULTIPLE_REGISTERS:
                result = this._parseRegisterResponse(pdu, expectedQuantity);
                break;

            case FUNCTION_CODES.READ_FIFO_QUEUE:
                result = this._parseFifoResponse(pdu);
                break;

            case FUNCTION_CODES.REPORT_SERVER_ID:
                result = this._parseReportServerIdResponse(pdu);
                break;

            case FUNCTION_CODES.READ_FILE_RECORD:
                result = this._parseReadFileRecordResponse(pdu);
                break;

            case FUNCTION_CODES.WRITE_FILE_RECORD:
                result = this._parseWriteFileRecordResponse(pdu);
                break;

            case FUNCTION_CODES.ENCAPSULATED_INTERFACE_TRANSPORT:
                result = this._parseEncapsulatedInterfaceResponse(pdu);
                break;

            default:
                result = {};
        }

        result.raw = raw;
        return result;
    }

    _parseBitResponse(pdu, expectedQuantity) {
        const byteCount = pdu[1];
        if (expectedQuantity !== undefined) {
            const expected = Math.ceil(expectedQuantity / 8);
            if (byteCount !== expected) {
                throw new ModbusError(
                    `Invalid byte count in response: got ${byteCount}, expected ${expected} for quantity ${expectedQuantity}`,
                    EXCEPTION_CODES.ILLEGAL_DATA_VALUE
                );
            }
        }
        const data = pdu.slice(2, 2 + byteCount);
        if (data.length !== byteCount) {
            throw new ModbusError(
                `Truncated response: byteCount ${byteCount} but only ${data.length} bytes available`,
                EXCEPTION_CODES.ILLEGAL_DATA_VALUE
            );
        }
        return { responseBuffer: [...data], buffer: data, byteCount };
    }

    _parseRegisterResponse(pdu, expectedQuantity) {
        const byteCount = pdu[1];
        if (expectedQuantity !== undefined) {
            const expected = expectedQuantity * 2;
            if (byteCount !== expected) {
                throw new ModbusError(
                    `Invalid byte count in response: got ${byteCount}, expected ${expected} for quantity ${expectedQuantity}`,
                    EXCEPTION_CODES.ILLEGAL_DATA_VALUE
                );
            }
        }
        const data = pdu.slice(2, 2 + byteCount);
        if (data.length !== byteCount) {
            throw new ModbusError(
                `Truncated response: byteCount ${byteCount} but only ${data.length} bytes available`,
                EXCEPTION_CODES.ILLEGAL_DATA_VALUE
            );
        }
        return { responseBuffer: [...data], buffer: data, byteCount };
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

    _parseMaskWriteResponse(pdu) {
        return {
            address: pdu.readUInt16BE(1),
            andMask: pdu.readUInt16BE(3),
            orMask: pdu.readUInt16BE(5)
        };
    }

    _parseFifoResponse(pdu) {
        // PDU: [FC=0x18][byteCount(2)][fifoCount(2)][values...]
        const byteCount = pdu.readUInt16BE(1);
        const fifoCount = pdu.readUInt16BE(3);
        if (fifoCount > LIMITS.MAX_FIFO_COUNT) {
            throw new ModbusError(
                `FIFO count exceeds max: ${fifoCount} > ${LIMITS.MAX_FIFO_COUNT}`,
                EXCEPTION_CODES.ILLEGAL_DATA_VALUE
            );
        }
        const expectedBytes = 2 + fifoCount * 2;
        if (byteCount !== expectedBytes) {
            throw new ModbusError(
                `Invalid FIFO byte count: got ${byteCount}, expected ${expectedBytes}`,
                EXCEPTION_CODES.ILLEGAL_DATA_VALUE
            );
        }
        const values = [];
        for (let i = 0; i < fifoCount; i++) {
            values.push(pdu.readUInt16BE(5 + i * 2));
        }
        return { fifoCount, values };
    }

    _parseReportServerIdResponse(pdu) {
        // PDU: [FC=0x11][byteCount][serverId][runIndicator][additionalData...]
        const byteCount = pdu[1];
        if (byteCount < 2) {
            throw new ModbusError(
                `Invalid Report Server ID byte count: ${byteCount}`,
                EXCEPTION_CODES.ILLEGAL_DATA_VALUE
            );
        }
        const serverId = pdu[2];
        const runIndicator = pdu[3] === 0xFF;
        const additionalData = Buffer.from(pdu.slice(4, 2 + byteCount));
        return { serverId, runIndicator, additionalData };
    }

    _parseReadFileRecordResponse(pdu) {
        // PDU: [FC=0x14][respDataLength][subResp1][subResp2]...
        // subResp: [fileRespLength][refType=0x06][recordData(N*2)]
        const respDataLength = pdu[1];
        const records = [];
        let offset = 2;
        const end = 2 + respDataLength;
        while (offset < end) {
            const fileRespLength = pdu[offset];
            const refType = pdu[offset + 1];
            if (refType !== FILE_RECORD_REFERENCE_TYPE) {
                throw new ModbusError(
                    `Invalid file reference type: 0x${refType.toString(16)}`,
                    EXCEPTION_CODES.ILLEGAL_DATA_VALUE
                );
            }
            const dataBytes = fileRespLength - 1;
            const values = [];
            for (let i = 0; i < dataBytes; i += 2) {
                values.push(pdu.readUInt16BE(offset + 2 + i));
            }
            records.push({ recordData: values });
            offset += 2 + dataBytes;
        }
        return { records };
    }

    _parseWriteFileRecordResponse(pdu) {
        // Echo of request — same format as request body.
        const respDataLength = pdu[1];
        const records = [];
        let offset = 2;
        const end = 2 + respDataLength;
        while (offset < end) {
            const refType = pdu[offset];
            if (refType !== FILE_RECORD_REFERENCE_TYPE) {
                throw new ModbusError(
                    `Invalid file reference type: 0x${refType.toString(16)}`,
                    EXCEPTION_CODES.ILLEGAL_DATA_VALUE
                );
            }
            const fileNumber = pdu.readUInt16BE(offset + 1);
            const recordNumber = pdu.readUInt16BE(offset + 3);
            const recordLength = pdu.readUInt16BE(offset + 5);
            const values = [];
            for (let i = 0; i < recordLength; i++) {
                values.push(pdu.readUInt16BE(offset + 7 + i * 2));
            }
            records.push({ fileNumber, recordNumber, recordData: values });
            offset += 7 + recordLength * 2;
        }
        return { records };
    }

    _parseEncapsulatedInterfaceResponse(pdu) {
        // PDU: [FC=0x2B][meiType][...]
        const meiType = pdu[1];
        if (meiType !== MEI_TYPES.READ_DEVICE_IDENTIFICATION) {
            throw new ModbusError(
                `Unsupported MEI type: 0x${meiType.toString(16)}`,
                EXCEPTION_CODES.ILLEGAL_FUNCTION
            );
        }
        // [FC][meiType][readDeviceIdCode][conformityLevel][moreFollows][nextObjectId][numberOfObjects][objects...]
        const readDeviceIdCode = pdu[2];
        const conformityLevel = pdu[3];
        const moreFollows = pdu[4] === 0xFF;
        const nextObjectId = pdu[5];
        const numberOfObjects = pdu[6];
        const objects = {};
        let offset = 7;
        for (let i = 0; i < numberOfObjects; i++) {
            const objectId = pdu[offset];
            const objectLength = pdu[offset + 1];
            const objectValue = pdu.slice(offset + 2, offset + 2 + objectLength).toString('ascii');
            objects[objectId] = objectValue;
            offset += 2 + objectLength;
        }
        return { meiType, readDeviceIdCode, conformityLevel, moreFollows, nextObjectId, numberOfObjects, objects };
    }

    _buildMBAPHeader(transactionId, pduLength, unitId) {
        const header = Buffer.alloc(MBAP.HEADER_LENGTH);
        header.writeUInt16BE(transactionId, 0);
        header.writeUInt16BE(MBAP.PROTOCOL_ID, 2);
        header.writeUInt16BE(pduLength + 1, 4);
        header.writeUInt8(unitId, 6);
        return header;
    }

    _sendRequest(functionCode, pdu, unitId, expectedQuantity) {
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
                expectedQuantity,
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

        return this._sendRequest(FUNCTION_CODES.READ_COILS, pdu, unitId, quantity);
    }

    readDiscreteInputs(address, quantity, unitId) {
        this._validateAddress(address);
        this._validateQuantity(quantity, LIMITS.MAX_DISCRETE_INPUTS_READ);

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.READ_DISCRETE_INPUTS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(quantity, 3);

        return this._sendRequest(FUNCTION_CODES.READ_DISCRETE_INPUTS, pdu, unitId, quantity);
    }

    readHoldingRegisters(address, quantity, unitId) {
        this._validateAddress(address);
        this._validateQuantity(quantity, LIMITS.MAX_REGISTERS_READ);

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.READ_HOLDING_REGISTERS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(quantity, 3);

        return this._sendRequest(FUNCTION_CODES.READ_HOLDING_REGISTERS, pdu, unitId, quantity);
    }

    readInputRegisters(address, quantity, unitId) {
        this._validateAddress(address);
        this._validateQuantity(quantity, LIMITS.MAX_REGISTERS_READ);

        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(FUNCTION_CODES.READ_INPUT_REGISTERS, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(quantity, 3);

        return this._sendRequest(FUNCTION_CODES.READ_INPUT_REGISTERS, pdu, unitId, quantity);
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

    maskWriteRegister(address, andMask, orMask, unitId) {
        this._validateAddress(address);
        if (andMask < 0 || andMask > 0xFFFF) {
            throw new ModbusError(`AND mask out of range: ${andMask}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }
        if (orMask < 0 || orMask > 0xFFFF) {
            throw new ModbusError(`OR mask out of range: ${orMask}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        const pdu = Buffer.alloc(7);
        pdu.writeUInt8(FUNCTION_CODES.MASK_WRITE_REGISTER, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(andMask, 3);
        pdu.writeUInt16BE(orMask, 5);

        return this._sendRequest(FUNCTION_CODES.MASK_WRITE_REGISTER, pdu, unitId);
    }

    readWriteMultipleRegisters(readAddress, readQuantity, writeAddress, writeValues, unitId) {
        this._validateAddress(readAddress);
        this._validateAddress(writeAddress);
        this._validateQuantity(readQuantity, LIMITS.MAX_RW_READ_REGISTERS);

        if (!Array.isArray(writeValues)) {
            throw new ModbusError('writeValues must be an array', EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }
        this._validateQuantity(writeValues.length, LIMITS.MAX_RW_WRITE_REGISTERS);

        const writeByteCount = writeValues.length * 2;
        const pdu = Buffer.alloc(10 + writeByteCount);
        pdu.writeUInt8(FUNCTION_CODES.READ_WRITE_MULTIPLE_REGISTERS, 0);
        pdu.writeUInt16BE(readAddress, 1);
        pdu.writeUInt16BE(readQuantity, 3);
        pdu.writeUInt16BE(writeAddress, 5);
        pdu.writeUInt16BE(writeValues.length, 7);
        pdu.writeUInt8(writeByteCount, 9);
        for (let i = 0; i < writeValues.length; i++) {
            const v = writeValues[i];
            if (v < 0 || v > 0xFFFF) {
                throw new ModbusError(
                    `Register value out of range at index ${i}: ${v}`,
                    EXCEPTION_CODES.ILLEGAL_DATA_VALUE
                );
            }
            pdu.writeUInt16BE(v, 10 + i * 2);
        }

        return this._sendRequest(FUNCTION_CODES.READ_WRITE_MULTIPLE_REGISTERS, pdu, unitId, readQuantity);
    }

    readFifoQueue(address, unitId) {
        this._validateAddress(address);

        const pdu = Buffer.alloc(3);
        pdu.writeUInt8(FUNCTION_CODES.READ_FIFO_QUEUE, 0);
        pdu.writeUInt16BE(address, 1);

        return this._sendRequest(FUNCTION_CODES.READ_FIFO_QUEUE, pdu, unitId);
    }

    reportServerId(unitId) {
        const pdu = Buffer.alloc(1);
        pdu.writeUInt8(FUNCTION_CODES.REPORT_SERVER_ID, 0);
        return this._sendRequest(FUNCTION_CODES.REPORT_SERVER_ID, pdu, unitId);
    }

    readFileRecord(records, unitId) {
        if (!Array.isArray(records) || records.length === 0) {
            throw new ModbusError('records must be a non-empty array', EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        // Each sub-request: 7 bytes (refType + fileNumber + recordNumber + recordLength)
        const subReqLength = 7;
        const dataLength = records.length * subReqLength;
        if (dataLength > 245) {
            throw new ModbusError(`Too many records: ${records.length}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        const pdu = Buffer.alloc(2 + dataLength);
        pdu.writeUInt8(FUNCTION_CODES.READ_FILE_RECORD, 0);
        pdu.writeUInt8(dataLength, 1);

        let offset = 2;
        for (const r of records) {
            if (r.fileNumber < 1 || r.fileNumber > LIMITS.MAX_FILE_NUMBER) {
                throw new ModbusError(`File number out of range: ${r.fileNumber}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
            }
            if (r.recordNumber < 0 || r.recordNumber > LIMITS.MAX_FILE_RECORD_NUMBER) {
                throw new ModbusError(`Record number out of range: ${r.recordNumber}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
            }
            if (r.recordLength < 1 || r.recordLength > LIMITS.MAX_FILE_RECORD_LENGTH) {
                throw new ModbusError(`Record length out of range: ${r.recordLength}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
            }
            pdu.writeUInt8(FILE_RECORD_REFERENCE_TYPE, offset);
            pdu.writeUInt16BE(r.fileNumber, offset + 1);
            pdu.writeUInt16BE(r.recordNumber, offset + 3);
            pdu.writeUInt16BE(r.recordLength, offset + 5);
            offset += subReqLength;
        }

        return this._sendRequest(FUNCTION_CODES.READ_FILE_RECORD, pdu, unitId);
    }

    writeFileRecord(records, unitId) {
        if (!Array.isArray(records) || records.length === 0) {
            throw new ModbusError('records must be a non-empty array', EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        let dataLength = 0;
        for (const r of records) {
            if (!Array.isArray(r.recordData) || r.recordData.length === 0) {
                throw new ModbusError('recordData must be a non-empty array', EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
            }
            if (r.recordData.length > LIMITS.MAX_FILE_RECORD_LENGTH) {
                throw new ModbusError(`Record length exceeds max: ${r.recordData.length}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
            }
            dataLength += 7 + r.recordData.length * 2;
        }
        if (dataLength > 251) {
            throw new ModbusError(`Total data length exceeds PDU limit: ${dataLength}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        const pdu = Buffer.alloc(2 + dataLength);
        pdu.writeUInt8(FUNCTION_CODES.WRITE_FILE_RECORD, 0);
        pdu.writeUInt8(dataLength, 1);

        let offset = 2;
        for (const r of records) {
            if (r.fileNumber < 1 || r.fileNumber > LIMITS.MAX_FILE_NUMBER) {
                throw new ModbusError(`File number out of range: ${r.fileNumber}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
            }
            if (r.recordNumber < 0 || r.recordNumber > LIMITS.MAX_FILE_RECORD_NUMBER) {
                throw new ModbusError(`Record number out of range: ${r.recordNumber}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
            }
            pdu.writeUInt8(FILE_RECORD_REFERENCE_TYPE, offset);
            pdu.writeUInt16BE(r.fileNumber, offset + 1);
            pdu.writeUInt16BE(r.recordNumber, offset + 3);
            pdu.writeUInt16BE(r.recordData.length, offset + 5);
            for (let i = 0; i < r.recordData.length; i++) {
                const v = r.recordData[i];
                if (v < 0 || v > 0xFFFF) {
                    throw new ModbusError(
                        `Record data value out of range at index ${i}: ${v}`,
                        EXCEPTION_CODES.ILLEGAL_DATA_VALUE
                    );
                }
                pdu.writeUInt16BE(v, offset + 7 + i * 2);
            }
            offset += 7 + r.recordData.length * 2;
        }

        return this._sendRequest(FUNCTION_CODES.WRITE_FILE_RECORD, pdu, unitId);
    }

    readDeviceIdentification(unitId, readDeviceIdCode = DEVICE_ID_CODES.BASIC, objectId = DEVICE_ID_OBJECTS.VendorName) {
        if (readDeviceIdCode < 1 || readDeviceIdCode > 4) {
            throw new ModbusError(
                `readDeviceIdCode out of range: ${readDeviceIdCode} (allowed: 1-4)`,
                EXCEPTION_CODES.ILLEGAL_DATA_VALUE
            );
        }
        if (objectId < 0 || objectId > 0xFF) {
            throw new ModbusError(`objectId out of range: ${objectId}`, EXCEPTION_CODES.ILLEGAL_DATA_VALUE);
        }

        const pdu = Buffer.alloc(4);
        pdu.writeUInt8(FUNCTION_CODES.ENCAPSULATED_INTERFACE_TRANSPORT, 0);
        pdu.writeUInt8(MEI_TYPES.READ_DEVICE_IDENTIFICATION, 1);
        pdu.writeUInt8(readDeviceIdCode, 2);
        pdu.writeUInt8(objectId, 3);

        return this._sendRequest(FUNCTION_CODES.ENCAPSULATED_INTERFACE_TRANSPORT, pdu, unitId);
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
    MBAP,
    MEI_TYPES,
    DEVICE_ID_CODES,
    DEVICE_ID_OBJECTS,
    FILE_RECORD_REFERENCE_TYPE
};
