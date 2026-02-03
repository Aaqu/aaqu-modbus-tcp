'use strict';

const { FUNCTION_CODES } = require('../lib/modbus-tcp');

const WRITE_METHODS = {
    [FUNCTION_CODES.WRITE_MULTIPLE_COILS]: 'writeMultipleCoils',
    [FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS]: 'writeMultipleRegisters'
};

module.exports = function(RED) {
    function ModbusWriteMultipleNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.server = RED.nodes.getNode(config.server);
        this.functionCode = parseInt(config.functionCode) || FUNCTION_CODES.WRITE_MULTIPLE_REGISTERS;
        this.address = parseInt(config.address) || 0;
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

            const fc = msg.functionCode !== undefined ? parseInt(msg.functionCode) : node.functionCode;
            const address = msg.address !== undefined ? parseInt(msg.address) : node.address;
            const unitId = msg.unitId !== undefined ? parseInt(msg.unitId) : node.unitId;
            let values = msg.payload;

            const method = WRITE_METHODS[fc];
            if (!method) {
                const err = new Error(`Invalid function code for multiple write: ${fc}`);
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            if (!Array.isArray(values)) {
                values = [values];
            }

            if (values.length === 0) {
                const err = new Error('Values array cannot be empty');
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            if (fc === FUNCTION_CODES.WRITE_MULTIPLE_COILS) {
                values = values.map(v => !!v);
                if (values.length > 1968) {
                    const err = new Error(`Too many coils: ${values.length} (max: 1968)`);
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
            } else {
                values = values.map(v => parseInt(v) || 0);
                if (values.length > 123) {
                    const err = new Error(`Too many registers: ${values.length} (max: 123)`);
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                for (let i = 0; i < values.length; i++) {
                    if (values[i] < 0 || values[i] > 65535) {
                        const err = new Error(`Register value at index ${i} out of range: ${values[i]}`);
                        if (done) done(err);
                        else node.error(err, msg);
                        return;
                    }
                }
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'writing...' });

            node.server.request(method, address, values, unitId)
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
                        msg.requestModbus = {
                            functionCode: fc,
                            address: result.address,
                            quantity: result.quantity,
                            unitId: unitId
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

    RED.nodes.registerType('aaqu-modbus-write-multiple', ModbusWriteMultipleNode);
};
