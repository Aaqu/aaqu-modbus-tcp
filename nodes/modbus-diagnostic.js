'use strict';

const { FUNCTION_CODES, DEVICE_ID_CODES, DEVICE_ID_OBJECTS } = require('../lib/modbus-tcp');

module.exports = function(RED) {
    function ModbusDiagnosticNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.server = RED.nodes.getNode(config.server);
        this.operation = config.operation || 'reportServerId';
        this.readDeviceIdCode = parseInt(config.readDeviceIdCode) || DEVICE_ID_CODES.BASIC;
        this.objectId = parseInt(config.objectId) || DEVICE_ID_OBJECTS.VendorName;
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

            let promise;
            let fc;

            if (operation === 'reportServerId') {
                fc = FUNCTION_CODES.REPORT_SERVER_ID;
                promise = node.server.request('reportServerId', unitId);
            } else if (operation === 'readDeviceIdentification') {
                fc = FUNCTION_CODES.ENCAPSULATED_INTERFACE_TRANSPORT;
                const code = msg.readDeviceIdCode !== undefined ? parseInt(msg.readDeviceIdCode) : node.readDeviceIdCode;
                const objId = msg.objectId !== undefined ? parseInt(msg.objectId) : node.objectId;
                promise = node.server.request('readDeviceIdentification', unitId, code, objId);
            } else {
                const err = new Error(`Unknown diagnostic operation: ${operation}`);
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            node.status({ fill: 'blue', shape: 'dot', text: operation + '...' });

            promise.then(result => {
                if (result.error) {
                    msg.payload = null;
                    msg.error = { code: result.code, message: result.message };
                    if (node.server.includeRaw) msg.raw = result.raw;
                    node.status({ fill: 'yellow', shape: 'ring', text: result.message });
                } else {
                    msg.payload = result;
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

    RED.nodes.registerType('aaqu-modbus-diagnostic', ModbusDiagnosticNode);
};
