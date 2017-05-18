'use strict';

const cluster = require('cluster'),
    Q = require('q');

let memoryCache = {};
class Master {
    init(config) {
        this.initialized = false;
        this.workers = config.workers ? config.workers : 2;

        this.initDefer = Q.defer();

        this.startWorker();

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
                        var value = memoryCache[message.data.key];
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
}

module.exports = new Master();