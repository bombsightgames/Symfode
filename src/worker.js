'use strict';

const Q = require('q'),
    fs = require('fs'),
    express = require('express'),
    Sequelize = require('sequelize'),
    mongo = require('mongoose'),
    Cache = require('./cache'),
    bodyParser = require('body-parser');

mongo.Promise = global.Promise;

let mysql = null;
let app = null;
let modules = null;
let config = null;
let entities = {};
let documents = {};
let services = {};
let controllers = {};
let cache = new Cache();
class Worker {
    init(initConfig, startupCommand, initModules, commands) {
        config = initConfig;
        modules = initModules;
        let defer = Q.defer();

        mysql = new Sequelize(config.mysql);
        mysql.authenticate().then(() => {
            this.loadEntities();
            return mysql.sync();
        }, (err) => {
            console.error('Failed to connect to MySQL.');
            defer.reject(err);
        }).then(() => {
            console.info('Connected to MySQL database.');
            return mongo.connect(config.mongo);
        }, (err) => {
            console.error('Failed to sync MySQL database.');
            if (!startupCommand.command) {
                defer.reject(err);
            }
        }).then(() => {
            console.info('Connected to Mongo database.');
            return this.loadDocuments();
        }, (err) => {
            console.error('Failed to connect to Mongo.');
            defer.reject(err);
        }).then(() => {
            return this.loadServices();
        }, (err) => {
            console.error('Failed to load documents.');
            defer.reject(err);
        }).then(() => {
            if (startupCommand.command) {
                return this.runStartupCommand(startupCommand, commands);
            } else {
                return this.loadControllers(config);
            }
        }, (err) => {
            console.error('Failed to load services.');
            defer.reject(err);
        }).then(() => {
            defer.resolve();
        }, (err) => {
            defer.reject(err);
        });

        return defer.promise;
    }

    loadEntities() {
        modules.forEach((module) => {
            try {
                fs.readdirSync(module + '/entities/').forEach((file) => {
                    if (file.match(/\.entity.js$/) !== null && file !== 'index.js') {
                        let name = file.replace('.entity.js', '');
                        console.info('Loading entity:', name);
                        entities[name] = require(module + '/entities/' + file)(this);
                    }
                })
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    throw e;
                }
            }
        });
    }

    loadDocuments() {
        modules.forEach((module) => {
            try {
                fs.readdirSync(module + '/documents/').forEach((file) => {
                    if (file.match(/\.document.js$/) !== null && file !== 'index.js') {
                        let name = file.replace('.document.js', '');
                        console.info('Loading document:', name);
                        documents[name] = require(module + '/documents/' + file)(this);
                    }
                });
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    throw e;
                }
            }
        });
    }

    loadServices() {
        let defer = Q.defer();

        let promises = [];
        modules.forEach((module) => {
            try {
                fs.readdirSync(module + '/services/').forEach((file) => {
                    if (file.match(/\.service.js$/) !== null && file !== 'index.js') {
                        let name = file.replace('.service.js', '');
                        console.info('Loading service:', name);

                        let service = require(module + '/services/' + file);
                        services[name] = new service(this);

                        if (services[name].init) {
                            promises.push(services[name].init());
                        }
                    }
                });
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    throw e;
                }
            }
        });


        Q.all(promises).then(() => {
            Object.keys(services).forEach((name) => {
                let service = services[name];
                if (service.postInit) {
                    service.postInit();
                }
            });

            defer.resolve();
        }, (err) => {
            defer.reject(err);
        });

        return defer.promise;
    }

    loadControllers(config) {
        let defer = Q.defer();

        app = express();

        app.use(bodyParser.json());

        app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
            res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
            next();
        });

        app.use((req, res, next) => {
            let token = req.get("authorization");
            if (token) {
                this.services.user.verifySession(token).then((session) => {
                    req.session = session;
                    next();
                }, (err) => {
                    res.status(401);
                    next(err);
                });
            } else {
                next();
            }
        });

        modules.forEach((module) => {
            try {
                fs.readdirSync(module + '/controllers/').forEach((file) => {
                    if (file.match(/\.controller.js$/) !== null && file !== 'index.js') {
                        let name = file.replace('.controller.js', '');
                        console.info('Loading controller:', name);
                        controllers[name] = require(module + '/controllers/' + file)(this, app);
                    }
                });
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    throw e;
                }
            }
        });


        app.use((err, req, res, next) => {
            if (res.headersSent) {
                return next(err);
            }

            if (res.statusCode >= 200 && res.statusCode < 300) {
                res.status(500);
            }

            if (process.env.NODE_ENV === 'development') {
                console.error(req.path, res.statusCode, err.stack ? err.stack : err);
                res.send({
                    success: false,
                    error: err.message ? err.message : err,
                    stack: err.stack,
                    errors: err.errors
                });
            } else {
                res.send({
                    success: false,
                    error: err,
                    errors: err.errors
                });
            }
        });

        app.listen(config.api_port ? config.api_port : 3000, function() {
            defer.resolve();
        }).on('error', function(err) {
            console.error('Failed to start HTTP server.');
            defer.reject(err);
        });

        return defer.promise;
    }

    runStartupCommand(startupCommand, commands) {
        let defer = Q.defer();

        if (!commands) {
            commands = {};
        }

        if (!commands['force-sync']) {
            commands['force-sync'] = (defer, worker) => {
                let util = require('util');
                console.warn('Executing a force synchronization to the database is dangerous and will remove all data!');
                console.warn('Please type "danger" if you are fine with this:');
                process.stdin.on('data', function (buffer) {
                    let string = buffer.toString('utf8').trim();
                    if (string === 'danger') {
                        worker.mysql.sync({force: true}).then(() => {
                            defer.resolve();
                        }, (err) => {
                            defer.reject(err);
                        });
                    } else {
                        defer.reject('Force synchronization canceled.');
                    }
                });
            };
        }

        if (!commands['alter-sync']) {
            commands['alter-sync'] = (defer, worker) => {
                let util = require('util');
                console.warn('Executing an alter synchronization to the database could possibly cause data loss!');
                console.warn('Executing synchronization in 5 seconds...');
                setTimeout(() => {
                    worker.mysql.sync({alter: true}).then(() => {
                        defer.resolve();
                    }, (err) => {
                        defer.reject(err);
                    });
                }, 5000);
            };
        }

        console.info('Executing command:', startupCommand.command, startupCommand.args);
        var command = commands[startupCommand.command];
        if (command) {
            try {
                command(defer, this, startupCommand);
            } catch (e) {
                console.error('Command error:', e);
                defer.reject('Failed to execute command.');
            }
        } else {
            console.error('Invalid command:', startupCommand.command);
            console.info('Command format: <command> --[key]=[value]');
            console.info('Available commands:');
            Object.keys(commands).forEach((command) => {
                console.info(' ', command);
            });
            defer.reject('Unrecognized command.');
        }

        return defer.promise;
    }

    get cache() {
        return cache;
    }

    get config() {
        return config;
    }

    get mysql() {
        return mysql;
    }

    get entities() {
        return entities;
    }

    get mongo() {
        return mongo;
    }

    get documents() {
        return documents;
    }

    get services() {
        return services;
    }
}

module.exports = new Worker();