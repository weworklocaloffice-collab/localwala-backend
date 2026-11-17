const express = require('express');
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/ls.admin.queues.controller');

const router = express.Router();
router.route('/summary').get(webAuth('localservices_catalog_read'), controller.getQueuesSummary);

module.exports = router;
