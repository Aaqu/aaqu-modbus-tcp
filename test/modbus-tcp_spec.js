'use strict';

const should = require('should');
const { ModbusClient, ModbusError, FUNCTION_CODES, EXCEPTION_CODES, COIL_VALUES, LIMITS, MBAP } = require('../lib/modbus-tcp');

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
    });
});
