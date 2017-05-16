'use strict';

let Q = require('q'),
    fs = require('fs'),
    express = require('express'),
    Sequelize = require('sequelize'),
    mongo = require('mongoose'),
    bodyParser = require('body-parser');

mongo.Promise = global.Promise;

let mysql = null;
let app = null;
let entities = {};
let documents = {};
let services = {};
let controllers = {};
class Worker {
    init(config, startupCommand) {
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
                return this.runStartupCommand(startupCommand);
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
        fs.readdirSync(__dirname + '/entities/').forEach((file) => {
            if (file.match(/\.entity.js$/) !== null && file !== 'index.js') {
                let name = file.replace('.entity.js', '');
                console.info('Loading entity:', name);
                entities[name] = require(__dirname + '/entities/' + file)(this);
            }
        });
    }

    loadDocuments() {
        fs.readdirSync(__dirname + '/documents/').forEach((file) => {
            if (file.match(/\.document.js$/) !== null && file !== 'index.js') {
                let name = file.replace('.document.js', '');
                console.info('Loading document:', name);
                documents[name] = require(__dirname + '/documents/' + file)(this);
            }
        });
    }

    loadServices() {
        let defer = Q.defer();

        let promises = [];
        fs.readdirSync(__dirname + '/services/').forEach((file) => {
            if (file.match(/\.service.js$/) !== null && file !== 'index.js') {
                let name = file.replace('.service.js', '');
                console.info('Loading service:', name);

                let service = require(__dirname + '/services/' + file);
                services[name] = new service(this);

                if (services[name].init) {
                    promises.push(services[name].init());
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

        fs.readdirSync(__dirname + '/controllers/').forEach((file) => {
            if (file.match(/\.controller.js$/) !== null && file !== 'index.js') {
                let name = file.replace('.controller.js', '');
                console.info('Loading controller:', name);
                controllers[name] = require(__dirname + '/controllers/' + file)(this, app);
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
                console.error('RESPONSE:', res.statusCode, err.stack ? err.stack : err);
                res.send({
                    success: false,
                    error: err.message ? err.message : err,
                    stack: err.stack
                });
            } else {
                res.send({
                    success: false,
                    error: err
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

    runStartupCommand(startupCommand) {
        let defer = Q.defer();

        console.info('Executing command:', startupCommand.command, startupCommand.args);
        if (startupCommand.command === 'create-user') {
            if (startupCommand.args.username && startupCommand.args.password) {
                this.services.user.createUser(startupCommand.args.username, startupCommand.args.password, null).then(() => {
                    defer.resolve();
                }, (err) => {
                    defer.reject(err);
                });
            } else {
                defer.reject('Invalid command arguments.');
            }
        } else if (startupCommand.command === 'force-sync') {
            let util = require('util');
            console.warn('Executing a force synchronization to the database is dangerous and will result in data loss!');
            console.warn('Please type "danger" if you are fine with this:');
            process.stdin.on('data', function (buffer) {
                let string = buffer.toString('utf8').trim();
                if (string === 'danger') {
                    mysql.sync({force: true}).then(() => {
                        defer.resolve();
                    }, (err) => {
                        defer.reject(err);
                    })
                } else {
                    defer.reject('Force synchronization canceled.');
                }
            });
        }  else {
            defer.reject('Unrecognized command.');
        }

        return defer.promise;
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