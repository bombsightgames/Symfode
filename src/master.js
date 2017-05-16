'use strict';

let cluster = require('cluster'),
    Q = require('q');

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
            if (message.cmd && message.cmd === 'init') {
                if (!this.initialized) {
                    if (Object.keys(cluster.workers).length >= this.workers) {
                        this.initialized = true;
                        this.initDefer.resolve();
                    } else {
                        this.startWorker();
                    }
                }
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