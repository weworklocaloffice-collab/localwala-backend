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
const partnerStaffRoute = require('./routes/ls.partner.staff.route');
const adminProviderRoute = require('./routes/ls.admin.provider.route');
const adminBookingRoute = require('./routes/ls.admin.booking.route');
const extendedRoute = require('./routes/ls.extended.route');

const router = express.Router();

router.get('/health', (req, res) => res.send({ vertical: 'local_services', status: 'ok' }));
router.use('/admin/revenue', revenueRoute);
router.use('/admin/catalog', catalogAdminRoute);
router.use('/admin/providers', adminProviderRoute);
router.use('/admin', adminBookingRoute);
router.use('/customer', bookingRoute);
router.use('/partner', partnerProviderRoute);
router.use('/partner', partnerStaffRoute);
router.use('/public', catalogPublicRoute);
router.use('/', extendedRoute);

module.exports = router;
