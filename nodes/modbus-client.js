'use strict';

const { ModbusClient } = require('../lib/modbus-tcp');

module.exports = function(RED) {
    function ModbusClientNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.host = config.host;
        this.port = parseInt(config.port) || 502;
        this.timeout = parseInt(config.timeout) || 5000;
        this.reconnect = config.reconnect !== false;
        this.reconnectInterval = parseInt(config.reconnectInterval) || 5000;

        this.client = new ModbusClient({
            host: this.host,
            port: this.port,
            timeout: this.timeout,
            reconnect: this.reconnect,
            reconnectInterval: this.reconnectInterval
        });

        this.users = new Set();

        this.client.on('connect', () => {
            node.log(`Connected to ${node.host}:${node.port}`);
            node.emit('connected');
        });

        this.client.on('disconnect', () => {
            node.log(`Disconnected from ${node.host}:${node.port}`);
            node.emit('disconnected');
        });

        this.client.on('error', (err) => {
            node.error(`Connection error: ${err.message}`);
            node.emit('error', err);
        });

        this.register = function(userNode) {
            node.users.add(userNode);
            if (node.users.size === 1) {
                node.client.connect().catch(err => {
                    node.error(`Failed to connect: ${err.message}`);
                });
            }
        };

        this.deregister = function(userNode) {
            node.users.delete(userNode);
            if (node.users.size === 0) {
                node.client.disconnect();
            }
        };

        this.request = function(method, ...args) {
            if (!node.client.connected) {
                return Promise.reject(new Error('Not connected'));
            }
            return node.client[method](...args);
        };

        this.on('close', function(done) {
            node.client.disconnect().then(done).catch(done);
        });
    }

    RED.nodes.registerType('modbus-client', ModbusClientNode);
};
