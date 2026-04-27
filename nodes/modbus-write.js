'use strict';

const { FUNCTION_CODES } = require('../lib/modbus-tcp');

const WRITE_METHODS = {
    [FUNCTION_CODES.WRITE_SINGLE_COIL]: 'writeSingleCoil',
    [FUNCTION_CODES.WRITE_SINGLE_REGISTER]: 'writeSingleRegister',
    [FUNCTION_CODES.MASK_WRITE_REGISTER]: 'maskWriteRegister'
};

module.exports = function(RED) {
    function ModbusWriteNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.server = RED.nodes.getNode(config.server);
        this.externalData = config.externalData || false;
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

            let fc, address, unitId;

            if (node.externalData) {
                if (msg.unitId === undefined || msg.address === undefined) {
                    const err = new Error('External data mode: msg.unitId and msg.address are required');
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                unitId = parseInt(msg.unitId);
                address = parseInt(msg.address);
                fc = msg.functionCode !== undefined ? parseInt(msg.functionCode) : node.functionCode;
            } else {
                fc = msg.functionCode !== undefined ? parseInt(msg.functionCode) : node.functionCode;
                address = node.address;
                unitId = node.unitId;
            }

            const method = WRITE_METHODS[fc];
            if (!method) {
                const err = new Error(`Invalid function code for single write: ${fc}`);
                if (done) done(err);
                else node.error(err, msg);
                return;
            }

            let args;
            if (fc === FUNCTION_CODES.MASK_WRITE_REGISTER) {
                if (msg.andMask === undefined || msg.orMask === undefined) {
                    const err = new Error('FC22 mask write requires msg.andMask and msg.orMask');
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                const andMask = parseInt(msg.andMask);
                const orMask = parseInt(msg.orMask);
                if (Number.isNaN(andMask) || andMask < 0 || andMask > 0xFFFF) {
                    const err = new Error(`andMask out of range: ${msg.andMask}`);
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                if (Number.isNaN(orMask) || orMask < 0 || orMask > 0xFFFF) {
                    const err = new Error(`orMask out of range: ${msg.orMask}`);
                    if (done) done(err);
                    else node.error(err, msg);
                    return;
                }
                args = [address, andMask, orMask, unitId];
            } else {
                let value = msg.payload;
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
                args = [address, value, unitId];
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'writing...' });

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
                    } else if (fc === FUNCTION_CODES.MASK_WRITE_REGISTER) {
                        msg.requestModbus = {
                            functionCode: fc,
                            address: result.address,
                            andMask: result.andMask,
                            orMask: result.orMask,
                            unitId: unitId
                        };
                        if (node.server.includeRaw) {
                            msg.raw = result.raw;
                        }
                        node.status({ fill: 'green', shape: 'dot', text: 'success' });
                    } else {
                        msg.requestModbus = {
                            functionCode: fc,
                            address: result.address,
                            value: result.value,
                            unitId: unitId
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

    RED.nodes.registerType('aaqu-modbus-write', ModbusWriteNode);
};
