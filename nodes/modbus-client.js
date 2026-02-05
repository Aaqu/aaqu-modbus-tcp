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
        this.logErrors = config.logErrors !== false;
        this.keepAlive = config.keepAlive !== false;
        this.keepAliveInitialDelay = parseInt(config.keepAliveInitialDelay) || 10000;
        this.heartbeat = config.heartbeat || false;
        this.heartbeatInterval = parseInt(config.heartbeatInterval) || 5000;
        this.includeRaw = config.includeRaw || false;

        this.client = new ModbusClient({
            host: this.host,
            port: this.port,
            timeout: this.timeout,
            reconnect: this.reconnect,
            reconnectInterval: this.reconnectInterval,
            keepAlive: this.keepAlive,
            keepAliveInitialDelay: this.keepAliveInitialDelay
        });

        this.users = new Set();

        this.client.on('connect', () => {
            node.log(`Connected to ${node.host}:${node.port}`);
            if (node.heartbeat) {
                node.client.startHeartbeat(node.heartbeatInterval);
            }
            node.emit('connected');
        });

        this.client.on('disconnect', (info) => {
            node.client.stopHeartbeat();
            const reason = info && info.hadError ? 'error' : 'server closed';
            node.log(`Disconnected from ${node.host}:${node.port} (reason: ${reason})`);
            node.emit('disconnected');
        });

        this.client.on('error', (err) => {
            if (node.logErrors) {
                node.error(`Connection error to ${node.host}:${node.port} - ${err.code || err.message || 'Unknown error'}`);
            }
            // Emit custom event instead of 'error' to prevent uncaught exception
            node.emit('connectionError', err);
        });

        this.register = function(userNode) {
            node.users.add(userNode);
            if (node.users.size === 1) {
                node.client.connect().catch(err => {
                    if (node.logErrors) {
                        node.error(`Failed to connect to ${node.host}:${node.port} - ${err.message || err.code || 'Unknown error'}`);
                    }
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

    RED.nodes.registerType('aaqu-modbus-client', ModbusClientNode);
};
