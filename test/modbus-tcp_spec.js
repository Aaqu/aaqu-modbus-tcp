'use strict';

const should = require('should');
const {
    ModbusClient,
    ModbusError,
    FUNCTION_CODES,
    EXCEPTION_CODES,
    COIL_VALUES,
    LIMITS,
    MBAP,
    MEI_TYPES,
    DEVICE_ID_CODES,
    DEVICE_ID_OBJECTS,
    FILE_RECORD_REFERENCE_TYPE
} = require('../lib/modbus-tcp');

describe('modbus-tcp library', function() {

    describe('constants', function() {
        it('should export FUNCTION_CODES', function() {
            FUNCTION_CODES.should.have.property('READ_COILS', 0x01);
            FUNCTION_CODES.should.have.property('READ_DISCRETE_INPUTS', 0x02);
            FUNCTION_CODES.should.have.property('READ_HOLDING_REGISTERS', 0x03);
            FUNCTION_CODES.should.have.property('READ_INPUT_REGISTERS', 0x04);
            FUNCTION_CODES.should.have.property('WRITE_SINGLE_COIL', 0x05);
            FUNCTION_CODES.should.have.property('WRITE_SINGLE_REGISTER', 0x06);
            FUNCTION_CODES.should.have.property('WRITE_MULTIPLE_COILS', 0x0F);
            FUNCTION_CODES.should.have.property('WRITE_MULTIPLE_REGISTERS', 0x10);
        });

        it('should export EXCEPTION_CODES', function() {
            EXCEPTION_CODES.should.have.property('ILLEGAL_FUNCTION', 0x01);
            EXCEPTION_CODES.should.have.property('ILLEGAL_DATA_ADDRESS', 0x02);
            EXCEPTION_CODES.should.have.property('ILLEGAL_DATA_VALUE', 0x03);
            EXCEPTION_CODES.should.have.property('SERVER_DEVICE_FAILURE', 0x04);
        });

        it('should export COIL_VALUES', function() {
            COIL_VALUES.should.have.property('OFF', 0x0000);
            COIL_VALUES.should.have.property('ON', 0xFF00);
        });

        it('should export LIMITS', function() {
            LIMITS.should.have.property('MAX_ADDRESS', 0xFFFF);
            LIMITS.should.have.property('MAX_COILS_READ', 2000);
            LIMITS.should.have.property('MAX_REGISTERS_READ', 125);
            LIMITS.should.have.property('MAX_COILS_WRITE', 1968);
            LIMITS.should.have.property('MAX_REGISTERS_WRITE', 123);
        });

        it('should export MBAP constants', function() {
            MBAP.should.have.property('HEADER_LENGTH', 7);
            MBAP.should.have.property('PROTOCOL_ID', 0x0000);
            MBAP.should.have.property('DEFAULT_PORT', 502);
            MBAP.should.have.property('DEFAULT_UNIT_ID', 1);
            MBAP.should.have.property('DEFAULT_TIMEOUT', 5000);
        });
    });

    describe('ModbusError', function() {
        it('should create error with message and code', function() {
            const err = new ModbusError('Test error', 0x02);
            err.should.be.instanceOf(Error);
            err.name.should.equal('ModbusError');
            err.message.should.equal('Test error');
            err.code.should.equal(0x02);
        });
    });

    describe('ModbusClient', function() {
        describe('constructor', function() {
            it('should use default values', function() {
                const client = new ModbusClient();
                client.host.should.equal('localhost');
                client.port.should.equal(502);
                client.timeout.should.equal(5000);
                client.reconnect.should.equal(true);
                client.reconnectInterval.should.equal(5000);
            });

            it('should accept custom options', function() {
                const client = new ModbusClient({
                    host: '192.168.1.100',
                    port: 5020,
                    timeout: 10000,
                    reconnect: false,
                    reconnectInterval: 3000
                });
                client.host.should.equal('192.168.1.100');
                client.port.should.equal(5020);
                client.timeout.should.equal(10000);
                client.reconnect.should.equal(false);
                client.reconnectInterval.should.equal(3000);
            });

            it('should start disconnected', function() {
                const client = new ModbusClient();
                client.connected.should.equal(false);
            });
        });

        describe('validation', function() {
            let client;

            beforeEach(function() {
                client = new ModbusClient();
            });

            it('should reject invalid address for readCoils', function() {
                should(() => client.readCoils(-1, 10)).throw(ModbusError);
                should(() => client.readCoils(0x10000, 10)).throw(ModbusError);
            });

            it('should reject invalid quantity for readCoils', function() {
                should(() => client.readCoils(0, 0)).throw(ModbusError);
                should(() => client.readCoils(0, 2001)).throw(ModbusError);
            });

            it('should reject invalid quantity for readHoldingRegisters', function() {
                should(() => client.readHoldingRegisters(0, 0)).throw(ModbusError);
                should(() => client.readHoldingRegisters(0, 126)).throw(ModbusError);
            });

            it('should reject invalid register value for writeSingleRegister', function() {
                should(() => client.writeSingleRegister(0, -1)).throw(ModbusError);
                should(() => client.writeSingleRegister(0, 0x10000)).throw(ModbusError);
            });

            it('should reject non-array for writeMultipleCoils', function() {
                should(() => client.writeMultipleCoils(0, 'not array')).throw(ModbusError);
            });

            it('should reject too many coils for writeMultipleCoils', function() {
                const tooMany = new Array(1969).fill(true);
                should(() => client.writeMultipleCoils(0, tooMany)).throw(ModbusError);
            });

            it('should reject too many registers for writeMultipleRegisters', function() {
                const tooMany = new Array(124).fill(100);
                should(() => client.writeMultipleRegisters(0, tooMany)).throw(ModbusError);
            });

            it('should reject invalid value in writeMultipleRegisters', function() {
                should(() => client.writeMultipleRegisters(0, [100, -1, 200])).throw(ModbusError);
                should(() => client.writeMultipleRegisters(0, [100, 0x10000, 200])).throw(ModbusError);
            });
        });

        describe('connection state', function() {
            let client;

            beforeEach(function() {
                client = new ModbusClient();
            });

            it('should reject requests when not connected', function(done) {
                client.readCoils(0, 10)
                    .then(() => done(new Error('Should have rejected')))
                    .catch(err => {
                        err.message.should.equal('Not connected');
                        done();
                    });
            });
        });

        describe('response byte-count validation', function() {
            let client;

            beforeEach(function() {
                client = new ModbusClient();
                // Bypass socket — preload a fake pending request and call _processResponse directly
                client._connected = true;
            });

            function buildFrame(transactionId, unitId, pdu) {
                const frame = Buffer.alloc(MBAP.HEADER_LENGTH + pdu.length);
                frame.writeUInt16BE(transactionId, 0);
                frame.writeUInt16BE(0x0000, 2);
                frame.writeUInt16BE(pdu.length + 1, 4);
                frame.writeUInt8(unitId, 6);
                pdu.copy(frame, MBAP.HEADER_LENGTH);
                return frame;
            }

            function preparePending(client, txId, functionCode, expectedQuantity) {
                return new Promise((resolve, reject) => {
                    client._pendingRequests.set(txId, {
                        functionCode,
                        expectedQuantity,
                        resolve,
                        reject,
                        timer: setTimeout(() => {}, 100000)
                    });
                });
            }

            it('should reject bit response with wrong byte count', function(done) {
                const txId = 1;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_COILS, 16);
                // Expected ceil(16/8)=2 bytes. Send 3 bytes -> mismatch.
                const pdu = Buffer.from([FUNCTION_CODES.READ_COILS, 0x03, 0xFF, 0xFF, 0xFF]);
                const frame = buildFrame(txId, 1, pdu);
                client._processResponse(frame);
                promise.then(() => done(new Error('Should have rejected')))
                    .catch(err => {
                        err.should.be.instanceOf(ModbusError);
                        err.message.should.match(/Invalid byte count/);
                        done();
                    });
            });

            it('should accept bit response with correct byte count', function(done) {
                const txId = 2;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_COILS, 16);
                const pdu = Buffer.from([FUNCTION_CODES.READ_COILS, 0x02, 0xAB, 0xCD]);
                const frame = buildFrame(txId, 1, pdu);
                client._processResponse(frame);
                promise.then(result => {
                    result.byteCount.should.equal(2);
                    result.responseBuffer.should.eql([0xAB, 0xCD]);
                    done();
                }).catch(done);
            });

            it('should reject register response with wrong byte count', function(done) {
                const txId = 3;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_HOLDING_REGISTERS, 3);
                // Expected 3*2=6 bytes. Send 4 bytes -> mismatch.
                const pdu = Buffer.from([FUNCTION_CODES.READ_HOLDING_REGISTERS, 0x04, 0x00, 0x01, 0x00, 0x02]);
                const frame = buildFrame(txId, 1, pdu);
                client._processResponse(frame);
                promise.then(() => done(new Error('Should have rejected')))
                    .catch(err => {
                        err.should.be.instanceOf(ModbusError);
                        err.message.should.match(/Invalid byte count/);
                        done();
                    });
            });

            it('should accept register response with correct byte count', function(done) {
                const txId = 4;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_HOLDING_REGISTERS, 2);
                const pdu = Buffer.from([FUNCTION_CODES.READ_HOLDING_REGISTERS, 0x04, 0x00, 0x01, 0x00, 0x02]);
                const frame = buildFrame(txId, 1, pdu);
                client._processResponse(frame);
                promise.then(result => {
                    result.byteCount.should.equal(4);
                    result.responseBuffer.should.eql([0x00, 0x01, 0x00, 0x02]);
                    done();
                }).catch(done);
            });

            it('should reject truncated register response', function(done) {
                const txId = 5;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_HOLDING_REGISTERS, 1);
                // byteCount says 2 but only 1 byte follows. Buffer.slice silently truncates.
                const pdu = Buffer.from([FUNCTION_CODES.READ_HOLDING_REGISTERS, 0x02, 0xAB]);
                const frame = buildFrame(txId, 1, pdu);
                // byteCount=2 matches expected (1*2=2) — passes byte-count check, but slice yields 1 byte. Truncation check catches it.
                client._processResponse(frame);
                promise.then(() => done(new Error('Should have rejected')))
                    .catch(err => {
                        err.should.be.instanceOf(ModbusError);
                        err.message.should.match(/Truncated/);
                        done();
                    });
            });

            it('should still expose modbus exception responses (not validate byteCount on errors)', function(done) {
                const txId = 6;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_HOLDING_REGISTERS, 10);
                // Exception PDU: function code | 0x80, exception code
                const pdu = Buffer.from([FUNCTION_CODES.READ_HOLDING_REGISTERS | 0x80, 0x02]);
                const frame = buildFrame(txId, 1, pdu);
                client._processResponse(frame);
                promise.then(result => {
                    result.error.should.equal(true);
                    result.code.should.equal(0x02);
                    done();
                }).catch(done);
            });
        });

        describe('extended function codes (validation)', function() {
            let client;

            beforeEach(function() {
                client = new ModbusClient();
            });

            it('maskWriteRegister: rejects out-of-range masks', function() {
                should(() => client.maskWriteRegister(0, -1, 0)).throw(ModbusError);
                should(() => client.maskWriteRegister(0, 0x10000, 0)).throw(ModbusError);
                should(() => client.maskWriteRegister(0, 0, 0x10000)).throw(ModbusError);
            });

            it('readWriteMultipleRegisters: rejects oversized read/write quantities', function() {
                should(() => client.readWriteMultipleRegisters(0, 126, 0, [1])).throw(ModbusError);
                const tooManyWrites = new Array(122).fill(1);
                should(() => client.readWriteMultipleRegisters(0, 1, 0, tooManyWrites)).throw(ModbusError);
            });

            it('readWriteMultipleRegisters: rejects non-array writeValues', function() {
                should(() => client.readWriteMultipleRegisters(0, 1, 0, 'nope')).throw(ModbusError);
            });

            it('readWriteMultipleRegisters: rejects out-of-range write value', function() {
                should(() => client.readWriteMultipleRegisters(0, 1, 0, [0x10000])).throw(ModbusError);
            });

            it('readDeviceIdentification: rejects invalid readDeviceIdCode', function() {
                should(() => client.readDeviceIdentification(1, 0)).throw(ModbusError);
                should(() => client.readDeviceIdentification(1, 5)).throw(ModbusError);
            });

            it('readFileRecord: rejects empty/invalid records', function() {
                should(() => client.readFileRecord([])).throw(ModbusError);
                should(() => client.readFileRecord([{ fileNumber: 0, recordNumber: 0, recordLength: 1 }])).throw(ModbusError);
                should(() => client.readFileRecord([{ fileNumber: 1, recordNumber: 0, recordLength: 0 }])).throw(ModbusError);
            });

            it('writeFileRecord: rejects empty recordData', function() {
                should(() => client.writeFileRecord([{ fileNumber: 1, recordNumber: 0, recordData: [] }])).throw(ModbusError);
            });

            it('writeFileRecord: rejects out-of-range value in recordData', function() {
                should(() => client.writeFileRecord([{ fileNumber: 1, recordNumber: 0, recordData: [0x10000] }])).throw(ModbusError);
            });
        });

        describe('extended function codes (PDU + parser)', function() {
            let client;

            beforeEach(function() {
                client = new ModbusClient();
                client._connected = true;
            });

            function buildFrame(transactionId, unitId, pdu) {
                const frame = Buffer.alloc(MBAP.HEADER_LENGTH + pdu.length);
                frame.writeUInt16BE(transactionId, 0);
                frame.writeUInt16BE(0x0000, 2);
                frame.writeUInt16BE(pdu.length + 1, 4);
                frame.writeUInt8(unitId, 6);
                pdu.copy(frame, MBAP.HEADER_LENGTH);
                return frame;
            }

            function preparePending(client, txId, functionCode, expectedQuantity) {
                return new Promise((resolve, reject) => {
                    client._pendingRequests.set(txId, {
                        functionCode,
                        expectedQuantity,
                        resolve,
                        reject,
                        timer: setTimeout(() => {}, 100000)
                    });
                });
            }

            it('maskWriteRegister: parses echo response', function(done) {
                const txId = 10;
                const promise = preparePending(client, txId, FUNCTION_CODES.MASK_WRITE_REGISTER);
                const pdu = Buffer.alloc(7);
                pdu.writeUInt8(FUNCTION_CODES.MASK_WRITE_REGISTER, 0);
                pdu.writeUInt16BE(0x0010, 1);
                pdu.writeUInt16BE(0x00F2, 3);
                pdu.writeUInt16BE(0x0025, 5);
                client._processResponse(buildFrame(txId, 1, pdu));
                promise.then(result => {
                    result.address.should.equal(0x0010);
                    result.andMask.should.equal(0x00F2);
                    result.orMask.should.equal(0x0025);
                    done();
                }).catch(done);
            });

            it('readFifoQueue: parses values', function(done) {
                const txId = 11;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_FIFO_QUEUE);
                // PDU: FC=0x18, byteCount=2+2*3=8, fifoCount=3, [0x01B8, 0x1284, 0x0000]
                const pdu = Buffer.alloc(11);
                pdu.writeUInt8(FUNCTION_CODES.READ_FIFO_QUEUE, 0);
                pdu.writeUInt16BE(8, 1);
                pdu.writeUInt16BE(3, 3);
                pdu.writeUInt16BE(0x01B8, 5);
                pdu.writeUInt16BE(0x1284, 7);
                pdu.writeUInt16BE(0x0000, 9);
                client._processResponse(buildFrame(txId, 1, pdu));
                promise.then(result => {
                    result.fifoCount.should.equal(3);
                    result.values.should.eql([0x01B8, 0x1284, 0x0000]);
                    done();
                }).catch(done);
            });

            it('readFifoQueue: rejects fifoCount > 31', function(done) {
                const txId = 12;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_FIFO_QUEUE);
                const pdu = Buffer.alloc(5);
                pdu.writeUInt8(FUNCTION_CODES.READ_FIFO_QUEUE, 0);
                pdu.writeUInt16BE(2, 1);
                pdu.writeUInt16BE(32, 3);
                client._processResponse(buildFrame(txId, 1, pdu));
                promise.then(() => done(new Error('Should reject')))
                    .catch(err => {
                        err.should.be.instanceOf(ModbusError);
                        err.message.should.match(/FIFO count/);
                        done();
                    });
            });

            it('reportServerId: parses serverId, runIndicator, additionalData', function(done) {
                const txId = 13;
                const promise = preparePending(client, txId, FUNCTION_CODES.REPORT_SERVER_ID);
                // FC=0x11, byteCount=4, serverId=0x42, runIndicator=0xFF, additionalData=[0x01, 0x02]
                const pdu = Buffer.from([FUNCTION_CODES.REPORT_SERVER_ID, 0x04, 0x42, 0xFF, 0x01, 0x02]);
                client._processResponse(buildFrame(txId, 1, pdu));
                promise.then(result => {
                    result.serverId.should.equal(0x42);
                    result.runIndicator.should.equal(true);
                    result.additionalData.length.should.equal(2);
                    result.additionalData[0].should.equal(0x01);
                    result.additionalData[1].should.equal(0x02);
                    done();
                }).catch(done);
            });

            it('readDeviceIdentification: parses objects', function(done) {
                const txId = 14;
                const promise = preparePending(client, txId, FUNCTION_CODES.ENCAPSULATED_INTERFACE_TRANSPORT);
                // [FC=0x2B][meiType=0x0E][readDeviceIdCode=0x01][conformity=0x01][moreFollows=0x00][nextObjectId=0x00][numberOfObjects=2]
                // [objId=0x00][len=4]['ACME'][objId=0x01][len=2]['v1']
                const header = Buffer.from([
                    FUNCTION_CODES.ENCAPSULATED_INTERFACE_TRANSPORT,
                    MEI_TYPES.READ_DEVICE_IDENTIFICATION,
                    0x01, 0x01, 0x00, 0x00, 0x02
                ]);
                const obj1 = Buffer.concat([Buffer.from([0x00, 0x04]), Buffer.from('ACME', 'ascii')]);
                const obj2 = Buffer.concat([Buffer.from([0x01, 0x02]), Buffer.from('v1', 'ascii')]);
                const pdu = Buffer.concat([header, obj1, obj2]);
                client._processResponse(buildFrame(txId, 1, pdu));
                promise.then(result => {
                    result.numberOfObjects.should.equal(2);
                    result.objects[0x00].should.equal('ACME');
                    result.objects[0x01].should.equal('v1');
                    result.moreFollows.should.equal(false);
                    done();
                }).catch(done);
            });

            it('readFileRecord: parses sub-responses', function(done) {
                const txId = 15;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_FILE_RECORD);
                // FC=0x14, respDataLength=8
                // sub1: fileRespLength=3, refType=0x06, [0x0DFE]
                // sub2: fileRespLength=3, refType=0x06, [0x1234]
                const pdu = Buffer.from([
                    FUNCTION_CODES.READ_FILE_RECORD, 0x08,
                    0x03, FILE_RECORD_REFERENCE_TYPE, 0x0D, 0xFE,
                    0x03, FILE_RECORD_REFERENCE_TYPE, 0x12, 0x34
                ]);
                client._processResponse(buildFrame(txId, 1, pdu));
                promise.then(result => {
                    result.records.length.should.equal(2);
                    result.records[0].recordData.should.eql([0x0DFE]);
                    result.records[1].recordData.should.eql([0x1234]);
                    done();
                }).catch(done);
            });

            it('writeFileRecord: parses echo', function(done) {
                const txId = 16;
                const promise = preparePending(client, txId, FUNCTION_CODES.WRITE_FILE_RECORD);
                // FC=0x15, respDataLength=9
                // refType=0x06, fileNumber=0x0004, recordNumber=0x0007, recordLength=0x0001, data=[0x06AF]
                const pdu = Buffer.from([
                    FUNCTION_CODES.WRITE_FILE_RECORD, 0x09,
                    FILE_RECORD_REFERENCE_TYPE, 0x00, 0x04, 0x00, 0x07, 0x00, 0x01, 0x06, 0xAF
                ]);
                client._processResponse(buildFrame(txId, 1, pdu));
                promise.then(result => {
                    result.records.length.should.equal(1);
                    result.records[0].fileNumber.should.equal(4);
                    result.records[0].recordNumber.should.equal(7);
                    result.records[0].recordData.should.eql([0x06AF]);
                    done();
                }).catch(done);
            });

            it('readWriteMultipleRegisters: validates expectedQuantity on response', function(done) {
                // build request first to seed the pending entry properly via _sendRequest path
                // But we need _connected=true; bypass by manual entry mirroring real flow.
                const txId = 17;
                const promise = preparePending(client, txId, FUNCTION_CODES.READ_WRITE_MULTIPLE_REGISTERS, 2);
                // Wrong byteCount: expected 4, got 2
                const pdu = Buffer.from([FUNCTION_CODES.READ_WRITE_MULTIPLE_REGISTERS, 0x02, 0xAB, 0xCD]);
                client._processResponse(buildFrame(txId, 1, pdu));
                promise.then(() => done(new Error('Should reject')))
                    .catch(err => {
                        err.should.be.instanceOf(ModbusError);
                        err.message.should.match(/Invalid byte count/);
                        done();
                    });
            });
        });

        describe('extended FUNCTION_CODES export', function() {
            it('should export new function codes', function() {
                FUNCTION_CODES.should.have.property('REPORT_SERVER_ID', 0x11);
                FUNCTION_CODES.should.have.property('READ_FILE_RECORD', 0x14);
                FUNCTION_CODES.should.have.property('WRITE_FILE_RECORD', 0x15);
                FUNCTION_CODES.should.have.property('MASK_WRITE_REGISTER', 0x16);
                FUNCTION_CODES.should.have.property('READ_WRITE_MULTIPLE_REGISTERS', 0x17);
                FUNCTION_CODES.should.have.property('READ_FIFO_QUEUE', 0x18);
                FUNCTION_CODES.should.have.property('ENCAPSULATED_INTERFACE_TRANSPORT', 0x2B);
            });

            it('should export MEI_TYPES and DEVICE_ID constants', function() {
                MEI_TYPES.should.have.property('READ_DEVICE_IDENTIFICATION', 0x0E);
                DEVICE_ID_CODES.should.have.property('BASIC', 0x01);
                DEVICE_ID_OBJECTS.should.have.property('VendorName', 0x00);
            });
        });
    });
});
