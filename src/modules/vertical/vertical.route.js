const express = require('express');
const appAuth = require('../../middlewares/appAuth');
const controller = require('./vertical.controller');

const router = express.Router();

router.get('/', appAuth(), controller.list);

module.exports = router;