const express = require('express');
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/ls.admin.settings.controller');

const router = express.Router();
router.route('/').get(webAuth('localservices_catalog_read'), controller.getSettings);
router.route('/').patch(webAuth('localservices_catalog_write'), controller.updateSetting);

module.exports = router;
