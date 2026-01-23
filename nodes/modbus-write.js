'use strict';

const { FUNCTION_CODES } = require('../lib/modbus-tcp');

const WRITE_METHODS = {
    [FUNCTION_CODES.WRITE_SINGLE_COIL]: 'writeSingleCoil',
    [FUNCTION_CODES.WRITE_SINGLE_REGISTER]: 'writeSingleRegister'
};

module.exports = function(RED) {
    function ModbusWriteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.server = RED.nodes.getNode(config.server);
        this.functionCode = parseInt(config.functionCode) || FUNCTION_CODES.WRITE_SINGLE_REGISTER;
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
            let value = msg.payload;

            const method = WRITE_METHODS[fc];
            if (!method) {
                const err = new Error(`Invalid function code for single write: ${fc}`);
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            if (fc === FUNCTION_CODES.WRITE_SINGLE_COIL) {
                value = !!value;
            } else {
                value = parseInt(value) || 0;
                if (value < 0 || value > 65535) {
                    const err = new Error(`Register value out of range: ${value}`);
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'writing...' });

            node.server.request(method, address, value, unitId)
                .then(result => {
                    msg.modbus = {
                        functionCode: fc,
                        address: result.address,
                        value: result.value,
                        unitId: unitId
                    };
                    send(msg);
                    node.status({ fill: 'green', shape: 'dot', text: 'success' });
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

    RED.nodes.registerType('aaqu-modbus-write', ModbusWriteNode);
};
