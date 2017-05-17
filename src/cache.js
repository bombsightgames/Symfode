'use strict';

let Q = require('q');

function Cache() {
    this.get = (key) => {
        var defer = Q.defer();

        var randomKey = Math.random();
        var cacheListener = function(message) {
            if (message.cmd === 'cache' && message.randomKey === randomKey) {
                process.removeListener('message', cacheListener);
                defer.resolve(message.value);
            }
        };
        process.on('message', cacheListener);

        process.send({cmd: 'cache', data: {
            type: 'get',
            key: key,
            randomKey: randomKey
        }});

        return defer.promise;
    };

    this.set = (key, value, expirationTime) => {
        process.send({cmd: 'cache', data: {
            type: 'set',
            key: key,
            value: value,
            expirationTime: expirationTime
        }});
    };

    this.delete = (key) => {
        process.send({cmd: 'cache', data: {
            type: 'delete',
            key: key
        }});
    };
}

module.exports = Cache;