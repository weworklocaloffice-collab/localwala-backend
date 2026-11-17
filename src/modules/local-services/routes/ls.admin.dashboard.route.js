const express = require('express');
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/ls.admin.dashboard.controller');

const router = express.Router();
router.route('/').get(webAuth('localservices_revenue_read'), controller.getAdminDashboard);

module.exports = router;
