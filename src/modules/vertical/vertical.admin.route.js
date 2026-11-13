const express = require('express');
const webAuth = require('../../middlewares/webAuth');
const controller = require('./vertical.controller');

const router = express.Router();

router.get('/', webAuth('header_banner_manage'), controller.list);

module.exports = router;