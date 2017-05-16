'use strict';

module.exports = function(w, app) {
    app.get('/session', function (req, res) {
        if (req.session) {
            res.send(req.session);
        } else {
            res.sendStatus(401);
        }
    });

    app.post('/login', function (req, res) {
        w.services.user.login(req.body.username, req.body.password).then((session) => {
            res.send({
                success: true,
                message: 'Logged in successfully.',
                data: session
            });
        }, (err) => {
            res.send({
                success: false,
                type: err.type,
                message: err.message
            });
        });
    });
};