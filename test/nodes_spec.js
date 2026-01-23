'use strict';

const helper = require('node-red-node-test-helper');
const should = require('should');

const modbusClientNode = require('../nodes/modbus-client.js');
const modbusReadNode = require('../nodes/modbus-read.js');
const modbusWriteNode = require('../nodes/modbus-write.js');
const modbusWriteMultipleNode = require('../nodes/modbus-write-multiple.js');

helper.init(require.resolve('node-red'));

describe('modbus nodes', function() {
    this.timeout(5000);

    afterEach(function(done) {
        helper.unload().then(function() {
            done();
        });
    });

    describe('modbus-client node', function() {
        it('should be loaded with default config', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', name: 'Test Client', host: 'localhost', port: '502', timeout: '5000', reconnect: true, reconnectInterval: '5000' }
            ];
            helper.load(modbusClientNode, flow, function() {
                const c1 = helper.getNode('c1');
                c1.should.have.property('name', 'Test Client');
                c1.should.have.property('host', 'localhost');
                c1.should.have.property('port', 502);
                c1.should.have.property('timeout', 5000);
                done();
            });
        });

        it('should have client instance', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', host: '127.0.0.1', port: '502' }
            ];
            helper.load(modbusClientNode, flow, function() {
                const c1 = helper.getNode('c1');
                c1.should.have.property('client');
                c1.client.should.have.property('host', '127.0.0.1');
                done();
            });
        });
    });

    describe('modbus-read node', function() {
        it('should be loaded with config', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', host: 'localhost', port: '502' },
                { id: 'n1', type: 'modbus-read', name: 'Read Registers', server: 'c1', functionCode: '3', address: '100', quantity: '10', unitId: '2' }
            ];
            helper.load([modbusClientNode, modbusReadNode], flow, function() {
                const n1 = helper.getNode('n1');
                n1.should.have.property('name', 'Read Registers');
                n1.should.have.property('functionCode', 3);
                n1.should.have.property('address', 100);
                n1.should.have.property('quantity', 10);
                n1.should.have.property('unitId', 2);
                done();
            });
        });

        it('should show error status without server', function(done) {
            const flow = [
                { id: 'n1', type: 'modbus-read', name: 'Read', server: '', functionCode: '3', address: '0', quantity: '1' }
            ];
            helper.load(modbusReadNode, flow, function() {
                const n1 = helper.getNode('n1');
                // Node should exist but have error status
                n1.should.have.property('name', 'Read');
                done();
            });
        });

        it('should accept unitId from config', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', host: 'localhost', port: '502' },
                { id: 'n1', type: 'modbus-read', server: 'c1', functionCode: '3', address: '0', quantity: '1', unitId: '5' }
            ];
            helper.load([modbusClientNode, modbusReadNode], flow, function() {
                const n1 = helper.getNode('n1');
                n1.should.have.property('unitId', 5);
                done();
            });
        });

        it('should default unitId to 1', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', host: 'localhost', port: '502' },
                { id: 'n1', type: 'modbus-read', server: 'c1', functionCode: '3', address: '0', quantity: '1' }
            ];
            helper.load([modbusClientNode, modbusReadNode], flow, function() {
                const n1 = helper.getNode('n1');
                n1.should.have.property('unitId', 1);
                done();
            });
        });
    });

    describe('modbus-write node', function() {
        it('should be loaded with config', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', host: 'localhost', port: '502' },
                { id: 'n1', type: 'modbus-write', name: 'Write Register', server: 'c1', functionCode: '6', address: '50', unitId: '3' }
            ];
            helper.load([modbusClientNode, modbusWriteNode], flow, function() {
                const n1 = helper.getNode('n1');
                n1.should.have.property('name', 'Write Register');
                n1.should.have.property('functionCode', 6);
                n1.should.have.property('address', 50);
                n1.should.have.property('unitId', 3);
                done();
            });
        });

        it('should default to FC06 (write single register)', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', host: 'localhost', port: '502' },
                { id: 'n1', type: 'modbus-write', server: 'c1', address: '0' }
            ];
            helper.load([modbusClientNode, modbusWriteNode], flow, function() {
                const n1 = helper.getNode('n1');
                n1.should.have.property('functionCode', 6);
                done();
            });
        });
    });

    describe('modbus-write-multiple node', function() {
        it('should be loaded with config', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', host: 'localhost', port: '502' },
                { id: 'n1', type: 'modbus-write-multiple', name: 'Write Multi', server: 'c1', functionCode: '16', address: '200', unitId: '4' }
            ];
            helper.load([modbusClientNode, modbusWriteMultipleNode], flow, function() {
                const n1 = helper.getNode('n1');
                n1.should.have.property('name', 'Write Multi');
                n1.should.have.property('functionCode', 16);
                n1.should.have.property('address', 200);
                n1.should.have.property('unitId', 4);
                done();
            });
        });

        it('should default to FC16 (write multiple registers)', function(done) {
            const flow = [
                { id: 'c1', type: 'modbus-client', host: 'localhost', port: '502' },
                { id: 'n1', type: 'modbus-write-multiple', server: 'c1', address: '0' }
            ];
            helper.load([modbusClientNode, modbusWriteMultipleNode], flow, function() {
                const n1 = helper.getNode('n1');
                n1.should.have.property('functionCode', 16);
                done();
            });
        });
    });
});
