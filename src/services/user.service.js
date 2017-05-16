'use strict';

let Q = require('q'),
    passhash = require('password-hash-and-salt'),
    crypto = require('crypto');

module.exports = function(w) {
    this.login = (username, password) => {
        let defer = Q.defer();

        //TODO: Account lockout after so many attempts.
        w.entities.user.findOne({where: {username: username}}).then((user) => {
            if (user) {
                passhash(password).verifyAgainst(user.get('password'), (err, verified) => {
                    if (err) {
                        defer.reject(err);
                    } else {
                        if (verified) {
                            this.createSession(user).then((session) => {
                                defer.resolve(session.get('session'));
                            }, function(err) {
                                defer.reject(err);
                            });
                        } else {
                            defer.reject({type: 'invalid_login', message: 'Invalid username or password.'});
                        }
                    }
                });
            } else {
                defer.reject({type: 'invalid_login', message: 'Invalid username or password.'});
            }
        }, (err) => {
            defer.reject(err);
        });

        return defer.promise;
    };

    this.createSession = (user) => {
        let defer = Q.defer();

        crypto.randomBytes(64, (err, buffer) => {
            if (err) {
                defer.reject(err);
            } else {
                var session = new w.documents.session({
                    userId: user.get('id'),
                    session: buffer.toString('hex')
                });

                session.save().then((session) => {
                    defer.resolve(session);
                }, (err) => {
                    defer.reject(err);
                });
            }
        });

        return defer.promise;
    };

    let sessionCache = {};
    this.verifySession = (token) => {
        let defer = Q.defer();

        //TODO: Ensure session is not expired.
        if (sessionCache[token]) {
            defer.resolve(sessionCache[token]);
        } else {
            w.documents.session.findOne({session: token}).then((session) => {
                if (session) {
                    this.getUser(session.get('userId')).then((user) => {
                        if (user) {
                            let data = {
                                session: {
                                    userId: session.get('userId'),
                                    session: session.get('session')
                                },
                                user: {
                                    id: user.get('id'),
                                    username: user.get('username'),
                                    name: user.get('name')
                                }
                            };
                            sessionCache[token] = data;
                            defer.resolve(data);
                        } else {
                            defer.reject('invalid_session');
                        }
                    }, (err) => {
                        defer.reject(err);
                    });
                } else {
                    defer.reject('invalid_session');
                }
            }, (err) => {
                defer.reject(err);
            });
        }

        return defer.promise;
    };

    this.getUser = (userId) => {
        return w.entities.user.findById(userId);
    };

    this.createUser = (username, password, name) => {
        let defer = Q.defer();

        passhash(password).hash((err, hash) => {
            if (err) {
                defer.reject(err);
            } else {
                w.entities.user.create({
                    username: username,
                    password: hash,
                    name: name
                }).then(() => {
                    defer.resolve()
                }, (err) =>{
                    defer.reject(err)
                });
            }
        });

        return defer.promise;
    };
};