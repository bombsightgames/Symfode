'use strict';

let Sequelize = require('sequelize');

module.exports = function(w) {
    let entity = w.mysql.define('user', {
        username: Sequelize.STRING,
        password: Sequelize.STRING(512),
        name: Sequelize.STRING,
    }, {
        indexes: [
            {
                unique: true,
                fields: ['username']
            }
        ]
    });
    return entity;
};