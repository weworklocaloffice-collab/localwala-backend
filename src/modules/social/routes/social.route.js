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
const appAuth = require('../../../middlewares/appAuth');
const validate = require('../../../middlewares/validate');
const { contactsSyncLimiter } = require('../../../middlewares/rateLimiter');
const contactsController = require('../contacts/contacts.controller');
const syncContactsValidator = require('../contacts/validators/sync-contacts.validator');
const privacyController = require('../privacy/privacy.controller');
const privacyValidation = require('../privacy/privacy.validation');

const router = express.Router();

// Phase 1 uses authenticated-only appAuth() so a missing rights string can
// never 403 a real customer; named rights in config/roles.js are enforced
// incrementally (docs §11).
router.post(
  '/contacts/sync',
  appAuth(),
  contactsSyncLimiter,
  validate(syncContactsValidator.syncContactsValidation),
  contactsController.sync
);

router.get('/privacy', appAuth(), privacyController.get);
router.patch(
  '/privacy',
  appAuth(),
  validate(privacyValidation.updatePrivacyValidation),
  privacyController.update
);

module.exports = router;
