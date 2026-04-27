'use strict';

const { FUNCTION_CODES } = require('../lib/modbus-tcp');

const READ_METHODS = {
    [FUNCTION_CODES.READ_COILS]: 'readCoils',
    [FUNCTION_CODES.READ_DISCRETE_INPUTS]: 'readDiscreteInputs',
    [FUNCTION_CODES.READ_HOLDING_REGISTERS]: 'readHoldingRegisters',
    [FUNCTION_CODES.READ_INPUT_REGISTERS]: 'readInputRegisters',
    [FUNCTION_CODES.READ_FIFO_QUEUE]: 'readFifoQueue'
};

module.exports = function(RED) {
    function ModbusReadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.server = RED.nodes.getNode(config.server);
        this.externalData = config.externalData || false;
        this.functionCode = parseInt(config.functionCode) || FUNCTION_CODES.READ_HOLDING_REGISTERS;
        this.address = parseInt(config.address) || 0;
        this.quantity = parseInt(config.quantity) || 1;
        this.unitId = parseInt(config.unitId) || 1;

        if (!this.server) {
            node.error('No Modbus client configured');
            node.status({ fill: 'red', shape: 'ring', text: 'no server' });
            return;
        }

        const updateStatus = () => {
            if (node.server.client.connected) {
                node.status({ fill: 'green', shape: 'dot', text: 'connected' });
            } else {
                node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
            }
        };

        this.server.on('connected', updateStatus);
        this.server.on('disconnected', updateStatus);
        this.server.register(this);
        updateStatus();

        node.on('input', function(msg, send, done) {
            send = send || function() { node.send.apply(node, arguments); };

            let fc, address, quantity, unitId;
            const fcOverride = msg.functionCode !== undefined ? parseInt(msg.functionCode) : node.functionCode;
            const isFifo = fcOverride === FUNCTION_CODES.READ_FIFO_QUEUE;

            if (node.externalData) {
                if (msg.unitId === undefined || msg.address === undefined) {
                    const err = new Error('External data mode: msg.unitId and msg.address are required');
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                if (!isFifo && msg.quantity === undefined) {
                    const err = new Error('External data mode: msg.quantity is required (not for FIFO)');
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                unitId = parseInt(msg.unitId);
                address = parseInt(msg.address);
                quantity = isFifo ? undefined : parseInt(msg.quantity);
                fc = fcOverride;
            } else {
                fc = fcOverride;
                address = node.address;
                quantity = isFifo ? undefined : node.quantity;
                unitId = node.unitId;
            }

            const method = READ_METHODS[fc];
            if (!method) {
                const err = new Error(`Invalid function code for read: ${fc}`);
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'reading...' });

            const args = isFifo ? [address, unitId] : [address, quantity, unitId];

            node.server.request(method, ...args)
                .then(result => {
                    if (result.error) {
                        msg.payload = null;
                        msg.error = {
                            code: result.code,
                            message: result.message
                        };
                        if (node.server.includeRaw) {
                            msg.raw = result.raw;
                        }
                        node.status({ fill: 'yellow', shape: 'ring', text: result.message });
                    } else if (isFifo) {
                        msg.payload = result.values;
                        msg.fifoCount = result.fifoCount;
                        msg.requestModbus = {
                            functionCode: fc,
                            address: address,
                            unitId: unitId,
                            fifoCount: result.fifoCount
                        };
                        if (node.server.includeRaw) {
                            msg.raw = result.raw;
                        }
                        node.status({ fill: 'green', shape: 'dot', text: 'success' });
                    } else {
                        msg.payload = result.responseBuffer;
                        msg.responseBuffer = {
                            buffer: result.buffer
                        };
                        msg.requestModbus = {
                            functionCode: fc,
                            address: address,
                            quantity: quantity,
                            unitId: unitId,
                            byteCount: result.byteCount
                        };
                        if (node.server.includeRaw) {
                            msg.raw = result.raw;
                        }
                        node.status({ fill: 'green', shape: 'dot', text: 'success' });
                    }
                    send(msg);
                    if (done) done();
                })
                .catch(err => {
                    node.status({ fill: 'red', shape: 'ring', text: err.message });
                    if (done) done(err);
                    else node.error(err, msg);
                });
        });

        node.on('close', function(done) {
            node.server.removeListener('connected', updateStatus);
            node.server.removeListener('disconnected', updateStatus);
            node.server.deregister(node);
            done();
        });
    }

    RED.nodes.registerType('aaqu-modbus-read', ModbusReadNode);
};
