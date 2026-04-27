'use strict';

const { FUNCTION_CODES } = require('../lib/modbus-tcp');

module.exports = function(RED) {
    function ModbusFileNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.server = RED.nodes.getNode(config.server);
        this.operation = config.operation || 'read';
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

            const operation = msg.operation || node.operation;
            const unitId = msg.unitId !== undefined ? parseInt(msg.unitId) : node.unitId;
            const records = msg.payload;

            if (!Array.isArray(records) || records.length === 0) {
                const err = new Error('msg.payload must be a non-empty array of record descriptors');
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            let promise;
            let fc;
            if (operation === 'read') {
                fc = FUNCTION_CODES.READ_FILE_RECORD;
                promise = node.server.request('readFileRecord', records, unitId);
            } else if (operation === 'write') {
                fc = FUNCTION_CODES.WRITE_FILE_RECORD;
                promise = node.server.request('writeFileRecord', records, unitId);
            } else {
                const err = new Error(`Unknown file operation: ${operation}`);
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            node.status({ fill: 'blue', shape: 'dot', text: operation === 'read' ? 'reading file...' : 'writing file...' });

            promise.then(result => {
                if (result.error) {
                    msg.payload = null;
                    msg.error = { code: result.code, message: result.message };
                    if (node.server.includeRaw) msg.raw = result.raw;
                    node.status({ fill: 'yellow', shape: 'ring', text: result.message });
                } else {
                    msg.payload = result.records;
                    msg.requestModbus = { functionCode: fc, operation, unitId };
                    if (node.server.includeRaw) msg.raw = result.raw;
                    node.status({ fill: 'green', shape: 'dot', text: 'success' });
                }
                send(msg);
                if (done) done();
            }).catch(err => {
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

    RED.nodes.registerType('aaqu-modbus-file', ModbusFileNode);
};
