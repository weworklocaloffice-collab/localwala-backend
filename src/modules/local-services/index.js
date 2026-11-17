/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const express = require('express');
const revenueRoute = require('./routes/ls.admin.revenue.route');
const bookingRoute = require('./routes/ls.customer.booking.route');
const catalogAdminRoute = require('./routes/ls.admin.catalog.route');
const catalogPublicRoute = require('./routes/ls.public.catalog.route');
const partnerProviderRoute = require('./routes/ls.partner.provider.route');
const partnerProviderTypeRoute = require('./routes/ls.partner.providertype.route');
const partnerStaffRoute = require('./routes/ls.partner.staff.route');
const adminProviderRoute = require('./routes/ls.admin.provider.route');
const adminProviderTypeRoute = require('./routes/ls.admin.providertype.route');
const adminPolicyRoute = require('./routes/ls.admin.policy.route');
const adminBookingRoute = require('./routes/ls.admin.booking.route');
const adminReportRoute = require('./routes/ls.admin.report.route');
const adminDashboardRoute = require('./routes/ls.admin.dashboard.route');
const adminQueuesRoute = require('./routes/ls.admin.queues.route');
const adminSearchRoute = require('./routes/ls.admin.search.route');
const adminSettingsRoute = require('./routes/ls.admin.settings.route');
const adminAuditRoute = require('./routes/ls.admin.audit.route');
const extendedRoute = require('./routes/ls.extended.route');
const marketingRoute = require('./routes/ls.marketing.route');

const router = express.Router();

router.get('/health', (req, res) => res.send({ vertical: 'local_services', status: 'ok' }));
router.use('/admin/revenue', revenueRoute);
router.use('/admin/catalog', catalogAdminRoute);
router.use('/admin/providers', adminProviderRoute);
router.use('/admin/provider-types', adminProviderTypeRoute);
router.use('/admin/policies', adminPolicyRoute);
router.use('/admin/reports', adminReportRoute);
router.use('/admin/dashboard', adminDashboardRoute);
router.use('/admin/queues', adminQueuesRoute);
router.use('/admin/search', adminSearchRoute);
router.use('/admin/settings', adminSettingsRoute);
router.use('/admin/audit-logs', adminAuditRoute);
router.use('/admin', adminBookingRoute);
router.use('/customer', bookingRoute);
router.use('/partner', partnerProviderRoute);
router.use('/partner', partnerProviderTypeRoute);
router.use('/partner', partnerStaffRoute);
router.use('/public', catalogPublicRoute);
router.use('/', extendedRoute);
router.use('/', marketingRoute);

module.exports = router;
