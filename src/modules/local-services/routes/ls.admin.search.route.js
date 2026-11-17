const express = require('express');
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/ls.admin.search.controller');

const router = express.Router();
router.route('/').get(webAuth('localservices_catalog_read'), controller.adminSearch);

module.exports = router;
