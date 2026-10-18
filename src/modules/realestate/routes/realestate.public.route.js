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
 * modification, or use of this source code is governed by
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const express = require('express');
const validate = require('../../../middlewares/validate');
const documentAccess = require('../middlewares/realestate.document.access');
const RealEstatePublicValidation = require('../validations/realestate.public.validation');
const RealEstatePublicController = require('../controllers/realestate.public.controller');
const { realestateSearchLimiter } = require('../../../middlewares/rateLimiter');

const router = express.Router();

/**
 * Public Real Estate routes. Mounted at `/v1/realestate/public` from
 * `routes/v1/index.js`.
 *
 * ## No `appAuth()` on purpose
 *
 * A customer browses and searches before signing in — blueprint §11's journey starts
 * at "Real Estate → Buy → Location → Filters → Properties", with the account created at
 * the enquiry, not before it. Requiring a token to look at listings would put the login
 * wall in front of the product.
 *
 * These routes are therefore guest-accessible, matching `/v1/public/*` for food and
 * dairy. That is also why there are no rights strings here: a rights string is only
 * meaningful on an authenticated route, and `verify.realestate.roles.js` checks
 * *authenticated* routes only.
 *
 * ## `documentAccess.attach()` on the one route that reads documents
 *
 * Only `/properties/:id/verification` touches `RealEstatePropertyDocument`, so only it
 * carries the middleware. Attaching it there rather than `router.use()` is deliberate:
 * a document route added later without it throws on `req.documentAccess` being
 * undefined, instead of silently inheriting a permissive default. The resolved actor is
 * `guest` here (no token), which yields `CUSTOMER_VISIBLE` as the only readable class.
 *
 * ## The `status: PUBLISHED` guarantee
 *
 * Blueprint §8 and BR-03 say only `PUBLISHED` is customer-visible. The service enforces
 * it — `search.service` hardcodes it into every filter, and the controller's
 * `assertPubliclyVisible` guards every by-id fetch. No route here accepts a `status`
 * parameter, so there is nothing for a caller to set.
 *
 * ## Route ordering matters
 *
 * `/properties/nearby`, `/properties/featured`, `/properties/recent`, `/properties/filters`
 * and `/properties/by-code/:code` are declared BEFORE `/properties/:id`. Express matches
 * in declaration order, so `:id` would otherwise capture the literal string `"nearby"`
 * and fail as an invalid ObjectId.
 */

// Category Routes //
router.get('/categories', RealEstatePublicController.listCategories);
router.get('/categories/grouped', RealEstatePublicController.groupedCategories);
router.get(
  '/categories/:key',
  validate(RealEstatePublicValidation.categoryKeyParams),
  RealEstatePublicController.getCategory
);
// Category Routes //

// Search Routes //
// Declared before `/properties/:id` — see the ordering note above.
// F-16: the list/search endpoints run 2dsphere + sort unauthenticated, so
// they carry the search limiter. Single-doc reads below stay unthrottled.
router.get(
  '/properties',
  realestateSearchLimiter,
  validate(RealEstatePublicValidation.search),
  RealEstatePublicController.searchProperties
);
router.get(
  '/properties/nearby',
  realestateSearchLimiter,
  validate(RealEstatePublicValidation.nearby),
  RealEstatePublicController.nearbyProperties
);
router.get('/properties/featured', realestateSearchLimiter, RealEstatePublicController.featuredProperties);
router.get('/properties/recent', realestateSearchLimiter, RealEstatePublicController.recentProperties);
router.get('/properties/filters', realestateSearchLimiter, RealEstatePublicController.listFilters);
router.get(
  '/properties/by-code/:code',
  validate(RealEstatePublicValidation.codeParams),
  RealEstatePublicController.getPropertyByCode
);
// Search Routes //

// Property Detail Routes //
router.get(
  '/properties/:id',
  validate(RealEstatePublicValidation.idParams),
  RealEstatePublicController.getProperty
);
router.get(
  '/properties/:id/similar',
  validate(RealEstatePublicValidation.idParams),
  RealEstatePublicController.similarProperties
);
// Verification Metadata Routes //
// BR-18: the actor is attached so a customer resolves to CUSTOMER_VISIBLE only, and the
// controller returns document TYPES — never a file URL.
router.get(
  '/properties/:id/verification',
  documentAccess.attach(),
  validate(RealEstatePublicValidation.idParams),
  RealEstatePublicController.getPropertyVerification
);
// Verification Metadata Routes //
// Property Detail Routes //

module.exports = router;
