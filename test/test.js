'use strict';

const symfode = require('../app.js');

symfode.init(__dirname, [
    'src'
], [], {
    enableSessions: true,
    enableWebsockets: true
});