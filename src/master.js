'use strict';

const cluster = require('cluster'),
    Q = require('q'),
    http = require('http'),
    _ = require('lodash'),
    net = require('net');

let memoryCache = {};
class Master {
    init(config, options) {
        this.initialized = false;
        this.config = config;
        this.options = options;
        this.workers = config.workers ? config.workers : 2;

        this.initDefer = Q.defer();

        this.startServices().then(() => {
            this.startWorker();
        }, (err) => {
            this.initDefer.reject(err);
        });

        return this.initDefer.promise;
    }

    startWorker() {
        if (Object.keys(cluster.workers).length > this.workers) {
            console.error('Tried to start a new worker but the limit has been reached.');
            return;
        }

        let worker = cluster.fork();

        console.info('Initializing worker #' + worker.id + '.');
        worker.on('message', (message) => {
            switch(message.cmd) {
                case 'init':
                    if (!this.initialized) {
                        if (Object.keys(cluster.workers).length >= this.workers) {
                            this.initialized = true;
                            this.initDefer.resolve();
                        } else {
                            this.startWorker();
                        }
                    }
                    break;
                case 'cache':
                    if (message.data.type === 'get') {
                        let value = memoryCache[message.data.key];
                        if (value && (!value.expires || value.expires > Date.now())) {
                            value = value.value;
                        } else if (value) {
                            value = null;
                            delete memoryCache[message.data.key];
                        }

                        worker.send({
                            cmd: 'cache',
                            value: value,
                            randomKey: message.data.randomKey
                        });
                    } else if (message.data.type === 'set') {
                        memoryCache[message.data.key] = {
                            value: message.data.value,
                            expires: message.data.expirationTime ? Date.now() + message.data.expirationTime : null
                        };
                    } else if (message.data.type === 'delete') {
                        delete memoryCache[message.data.key];
                    }
                    break;
                default:
                    console.error('Invalid master command:', message.cmd);
                    break;
            }
        });

        worker.on('exit', (code) => {
            console.error('Worker #' + worker.id + ' exited with code:', code);
            worker = null;

            if (this.initialized) {
                this.startWorker();
            } else {
                this.initDefer.reject('Worker exited on startup.');
            }
        });
    }

    startServices() {
        let defer = Q.defer();

        let port = this.config.api_port ? this.config.api_port : 3000;
        let server = net.createServer({}, (connection) => {
            let realIp = connection.remoteAddress;
            connection.on('data', (data) => {
                connection.removeAllListeners('data');
                connection.pause();

                let s = data.toString('ascii'),
                    sarray = s.split('\r\n');

                _.forEach(sarray, function (h) {
                    if (h.indexOf('X-Forwarded-For:') > -1) {
                        realIp = h.replace('X-Forwarded-For:', '').trim().split(',')[0];
                    }
                });

                let id = getWorkerIndex(realIp, this.config.workers);
                let worker = cluster.workers[id];
                if (worker) {
                    worker.send({
                        type: 'sticky-session:connection',
                        data: data,
                        realIp: realIp
                    }, connection);
                } else {
                    console.error('Worker not found for request. WID: ' + id + ' IP: ' + realIp);
                }
            });
        });

        server.listen(port);
        server.once('listening', function () {
            try {
                defer.resolve();
            } catch (e) {
                defer.reject(e);
            }
        });

        server.on('error', function (err) {
            if (!this.initialized) {
                defer.reject(err);
            } else {
                console.error('Socket Error:', err);
            }
        });

        return defer.promise;
    }
}

function getWorkerIndex(ip, len) {
    let s = 0;
    for (let i=0, _len=ip.length; i<_len; i++) {
        s += ip.charCodeAt(i);
    }
    let num = (Number(s) % len);
    return Object.keys(cluster.workers)[num];
}

module.exports = new Master();