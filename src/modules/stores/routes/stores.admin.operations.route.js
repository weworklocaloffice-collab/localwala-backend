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
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/stores.admin.operations.controller');

const router = express.Router();

/**
 * The operational consoles. Mounted at `/v1/admin/stores/operations`.
 *
 * ## GET only
 *
 * Every handler is a query. These surfaces report; they do not mutate. An operator taps
 * through to the record from here and acts on the record's own screen, so a console can
 * never become a second path to the same write with weaker guardrails.
 *
 * ## `stores_admin_console`, not per-console rights
 *
 * One right covers all eight. They are read-only and share one audience — the operations
 * team — so splitting them would add eight permission strings to `config/roles.js` and an
 * eight-way admin role matrix to maintain, in exchange for not letting a subscription
 * analyst see the refund console. The trade is not worth it at this size; if a customer
 * ever needs a narrower read, this is the line to cut.
 */
const CONSOLE_RIGHT = 'stores_admin_console';

// The literal `/summary` is declared BEFORE any `:param` sibling would be added here.
// Express matches in registration order, so a future `/consoles/:id` appended below this
// line is unreachable. Kept explicit because that mistake is recorded in the plan as the
// route-ordering trap and it has already been made once in this codebase.
router.get('/summary', webAuth(CONSOLE_RIGHT), controller.summary);

router.get('/subscription-health', webAuth(CONSOLE_RIGHT), controller.subscriptionHealth);
router.get('/settlement-exceptions', webAuth(CONSOLE_RIGHT), controller.settlementExceptions);
router.get('/refund-failures', webAuth(CONSOLE_RIGHT), controller.refundFailures);
router.get('/inventory-drift', webAuth(CONSOLE_RIGHT), controller.inventoryDrift);
router.get('/compliance-expiry', webAuth(CONSOLE_RIGHT), controller.complianceExpiry);
router.get('/organic-verification', webAuth(CONSOLE_RIGHT), controller.organicVerificationQueue);
router.get('/abuse-queue', webAuth(CONSOLE_RIGHT), controller.abuseQueue);
router.get('/application-ageing', webAuth(CONSOLE_RIGHT), controller.applicationAgeing);
router.get('/cod-remittance', webAuth(CONSOLE_RIGHT), controller.codRemittance);

module.exports = router;