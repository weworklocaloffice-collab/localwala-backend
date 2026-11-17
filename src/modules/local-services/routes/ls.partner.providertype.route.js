const express = require('express');
const appAuth = require('../../../middlewares/appAuth');
const controller = require('../controllers/ls.providertype.controller');

const router = express.Router();

router.route('/provider-types').get(appAuth('localservices_partner_read'), controller.listPartner);

module.exports = router;
