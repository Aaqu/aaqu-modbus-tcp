'use strict';

const { FUNCTION_CODES } = require('../lib/modbus-tcp');

const READ_METHODS = {
    [FUNCTION_CODES.READ_COILS]: 'readCoils',
    [FUNCTION_CODES.READ_DISCRETE_INPUTS]: 'readDiscreteInputs',
    [FUNCTION_CODES.READ_HOLDING_REGISTERS]: 'readHoldingRegisters',
    [FUNCTION_CODES.READ_INPUT_REGISTERS]: 'readInputRegisters'
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

            if (node.externalData) {
                if (msg.unitId === undefined || msg.address === undefined || msg.quantity === undefined) {
                    const err = new Error('External data mode: msg.unitId, msg.address, and msg.quantity are required');
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                unitId = parseInt(msg.unitId);
                address = parseInt(msg.address);
                quantity = parseInt(msg.quantity);
                fc = msg.functionCode !== undefined ? parseInt(msg.functionCode) : node.functionCode;
            } else {
                fc = msg.functionCode !== undefined ? parseInt(msg.functionCode) : node.functionCode;
                address = msg.address !== undefined ? parseInt(msg.address) : node.address;
                quantity = msg.quantity !== undefined ? parseInt(msg.quantity) : node.quantity;
                unitId = msg.unitId !== undefined ? parseInt(msg.unitId) : node.unitId;
            }

            const method = READ_METHODS[fc];
            if (!method) {
                const err = new Error(`Invalid function code for read: ${fc}`);
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'reading...' });

            node.server.request(method, address, quantity, unitId)
                .then(result => {
                    if (result.error) {
                        msg.payload = null;
                        msg.error = {
                            code: result.code,
                            message: result.message
                        };
                        msg.raw = result.raw;
                        node.status({ fill: 'yellow', shape: 'ring', text: result.message });
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
                        msg.raw = result.raw;
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
            node.server.deregister(node);
            done();
        });
    }

    RED.nodes.registerType('aaqu-modbus-read', ModbusReadNode);
};
