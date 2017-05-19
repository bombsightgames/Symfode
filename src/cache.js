'use strict';

const Q = require('q');

function Cache() {
    var cachePromises = {};
    process.on('message', function(message) {
        var defer = cachePromises[message.randomKey];
        if (message.cmd === 'cache' && defer) {
            delete cachePromises[message.randomKey];
            defer.resolve(message.value);
        }
    });

    this.get = (key) => {
        var defer = Q.defer();

        var randomKey = Math.random();
        process.send({cmd: 'cache', data: {
            type: 'get',
            key: key,
            randomKey: randomKey
        }});
        cachePromises[randomKey] = defer;

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