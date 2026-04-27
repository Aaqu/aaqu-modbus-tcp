'use strict';

const { FUNCTION_CODES } = require('../lib/modbus-tcp');

module.exports = function(RED) {
    function ModbusReadWriteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.server = RED.nodes.getNode(config.server);
        this.externalData = config.externalData || false;
        this.readAddress = parseInt(config.readAddress) || 0;
        this.readQuantity = parseInt(config.readQuantity) || 1;
        this.writeAddress = parseInt(config.writeAddress) || 0;
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

            let readAddress, readQuantity, writeAddress, unitId;

            if (node.externalData) {
                if (msg.unitId === undefined || msg.readAddress === undefined ||
                    msg.readQuantity === undefined || msg.writeAddress === undefined) {
                    const err = new Error('External data mode: msg.unitId, msg.readAddress, msg.readQuantity, msg.writeAddress are required');
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                unitId = parseInt(msg.unitId);
                readAddress = parseInt(msg.readAddress);
                readQuantity = parseInt(msg.readQuantity);
                writeAddress = parseInt(msg.writeAddress);
            } else {
                unitId = node.unitId;
                readAddress = node.readAddress;
                readQuantity = node.readQuantity;
                writeAddress = node.writeAddress;
            }

            let writeValues = msg.payload;
            if (!Array.isArray(writeValues)) {
                writeValues = [writeValues];
            }
            writeValues = writeValues.map(v => parseInt(v) || 0);

            for (let i = 0; i < writeValues.length; i++) {
                if (writeValues[i] < 0 || writeValues[i] > 0xFFFF) {
                    const err = new Error(`Write value at index ${i} out of range: ${writeValues[i]}`);
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'read+write...' });

            node.server.request('readWriteMultipleRegisters', readAddress, readQuantity, writeAddress, writeValues, unitId)
                .then(result => {
                    if (result.error) {
                        msg.payload = null;
                        msg.error = { code: result.code, message: result.message };
                        if (node.server.includeRaw) msg.raw = result.raw;
                        node.status({ fill: 'yellow', shape: 'ring', text: result.message });
                    } else {
                        msg.payload = result.responseBuffer;
                        msg.responseBuffer = { buffer: result.buffer };
                        msg.requestModbus = {
                            functionCode: FUNCTION_CODES.READ_WRITE_MULTIPLE_REGISTERS,
                            readAddress, readQuantity, writeAddress,
                            writeQuantity: writeValues.length,
                            unitId, byteCount: result.byteCount
                        };
                        if (node.server.includeRaw) msg.raw = result.raw;
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

    RED.nodes.registerType('aaqu-modbus-read-write', ModbusReadWriteNode);
};
