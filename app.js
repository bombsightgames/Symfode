'use strict';

const cluster = require('cluster');

let startupCommand = {
    command: null,
    args: {}
};
process.argv.forEach((val, index) => {
    val = val.trim();
    if (index > 2) {
        if (val.startsWith('--')) {
            let stripped = val.replace('--', '').trim();
            if (stripped.includes('=')) {
                let split = stripped.split('=');
                startupCommand.args[split[0]] = split[1];
            }
        } else {
            console.error('Invalid command argument:', val);
            process.exit(1);
        }
    } else if (index > 1) {
        startupCommand.command = val;
    }
});

[
    ['warn',  '\x1b[33m'],
    ['error', '\x1b[31m'],
    ['info',   '\x1b[35m'],
    ['log',   '\x1b[2m'],
].forEach((pair) => {
    var method = pair[0], reset = '\x1b[0m', color = '\x1b[36m' + pair[1];
    console[method] = console[method].bind(console, cluster.worker ? 'W-' + cluster.worker.id : 'M', color, method.toUpperCase(), reset);
});

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'local') {
    console.error('Environment variable NODE_ENV must be set to either "production", "development", or "local".');
    process.exit(1);
}

//TODO: Safe shutdown.
process.on('uncaughtException', (err) => {
    console.error(new Date(), 'Uncaught Exception:', err.stack ? err.stack : err);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error(new Date(), 'Unhandled Rejection:', err.stack ? err.stack : err);
    process.exit(1);
});

class Symfode {

    init(baseDir, initModules, commands, options) {
        let modules = [];
        initModules.forEach((module) => {
            modules.push(baseDir + '/' + module);
        });

        let config = null;
        try {
            config = require(baseDir + '/config');
        } catch (e) {
            console.error('Failed to load configuration from "' + baseDir + '/config.js":', e);
            process.exit(1);
        }

        if (startupCommand.command) {
            config.workers = 1;
        }

        if (cluster.isMaster) {
            process.title = 'sym-master';

            var master = require('./src/master');
            console.info(new Date(), 'Initializing master process.');
            master.init(config, startupCommand, options).then(() => {
                console.info('Master process initialized.');
                if (startupCommand.command) {
                    console.info('Command executed successfully.');
                    process.exit(0);
                }
            }, (err) => {
                console.error('Failed to initialize master process:', err.stack ? err.stack : err);
                process.exit(1);
            });
        } else {
            process.title = 'sym-worker' + cluster.worker.id;

            var worker = require('./src/worker');
            worker.init(config, startupCommand, modules, commands, options).then(() => {
                console.info('Worker initialized.');
                process.send({cmd: 'init'});
            }, (err) => {
                console.error('Failed to initialize worker:', err.stack ? err.stack : err);
                process.exit(1);
            });
        }
    }
}
module.exports = new Symfode();