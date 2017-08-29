'use strict';

const symfode = require('../app.js');

symfode.init(__dirname, [
    'src'
], {
    'generate-migration': (defer, worker, command) => {
        //TODO: Generate migration files.
        defer.resolve();
    }
}, {
    enableSessions: true,
    enableRedis: true,
    enableWebsockets: true
});