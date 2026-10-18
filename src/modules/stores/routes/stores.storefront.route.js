/**
 * @file The STOREFRONT: public, unauthenticated reads of a single outlet's public face.
 *
 * @description
 * These four routes are the ONLY catch-alls in the entire stores surface — every one of
 * them ends in a path that matches an arbitrary first segment. That makes this file the
 * most dangerous one to mount in the wrong position, so it is deliberately mounted LAST
 * in `stores.route.js` and mounted NOWHERE else.
 *
 * WHY A SEPARATE FILE. The bug this prevents is not hypothetical; it was live. These four
 * routes used to sit in `stores.customer.route.js`, which is mounted FIRST. Express tries
 * routers in registration order, so `GET /:store` swallowed every bare partner path
 * declared in a later file:
 *
 *     GET /v1/stores/subscription   -> getStoreProfile('subscription')  -> CastError
 *     GET /v1/stores/delivery       -> getStoreProfile('delivery')      -> CastError
 *     GET /v1/stores/settlement     -> getStoreProfile('settlement')    -> CastError
 *     GET /v1/stores/remittances    -> getStoreProfile('remittances')   -> CastError
 *     GET /v1/stores/warranty       -> getStoreProfile('warranty')      -> CastError
 *     GET /v1/stores/catalog/products -> browseProducts('catalog', ...)  -> CastError
 *     GET /v1/stores/subscriptions  -> getStoreProfile('subscriptions') -> CastError
 *
 * Every one of those endpoints existed, was guarded, was documented, and was unreachable —
 * and no test caught it, because every test called the service layer directly. The
 * tests that DID use a real server did not happen to call these paths. A handler that
 * cannot be reached passes every unit test written against the handler.
 *
 * The fix is structural rather than a reorder: nothing that shadows is allowed to be
 * declared in the same router as the catch-alls. `scripts/verify.stores.api.contract.js`
 * now walks the assembled router and FAILS if any registered route is captured by an
 * earlier one, so a future reordering fails the build instead of silently resurrecting
 * this.
 *
 * ORDER WITHIN THIS FILE is still load-bearing, for the same reason one level down:
 * `/:store/products` captures `/catalog/products`, so it must come after the catalog
 * router — which is guaranteed by this file being mounted last, not by anything here.
 *
 * @requires stores.customer.route.js
 * @module routes/stores.storefront.route
 */

const express = require('express');
const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const catalogService = require('../services/stores.catalog.service');
const reviewService = require('../services/stores.review.service');

const router = express.Router();

/**
 * @function getStoreProfile
 * @description A store's public card. `findById` on a non-ObjectId throws, which the error
 * layer renders as a 500 — so a bogus slug surfaces as an error rather than an empty
 * shell. That is intentional: this route is reached only for segments no literal route
 * claimed, and those are overwhelmingly typos or crawlers.
 */
const getStoreProfile = async (req, res) => {
  const StoreOutlet = mongoose.model('StoreOutlet');
  const outlet = await StoreOutlet.findById(req.params.store)
    .populate('chain', 'name slug logo')
    .lean();
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
  res.status(httpStatus.OK).send({ outlet });
};

/**
 * @function browseProducts
 * @description The chain owns the catalogue, the outlet owns availability (BR-36). The
 * `outlet` is taken from the PATH, never from the query, so a caller cannot widen the
 * result set by supplying their own outlet id.
 */
const browseProducts = async (req, res) => {
  const result = await catalogService.listProducts({ ...req.query, outlet: req.params.store });
  res.status(httpStatus.OK).send(result);
};

const getStoreReviews = async (req, res) => {
  const result = await reviewService.listReviews({ outlet: req.params.store, status: 'approved' });
  res.status(httpStatus.OK).send(result);
};

/**
 * @function getStoreOffers
 * @description Only `active` AND `isActive` promotions. A draft or scheduled promotion is
 * not an offer, and both flags are checked here rather than trusted from the caller.
 */
const getStoreOffers = async (req, res) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const promotions = await StorePromotion.find({ outlet: req.params.store, status: 'active', isActive: true });
  res.status(httpStatus.OK).send({ promotions });
};

// `eligibilityService` is not required here: eligibility is a partner-side concern and
// this file serves only the public storefront reads. Importing it "for symmetry" would
// be a lie about what this router does.

router.get('/:store', getStoreProfile);
router.get('/:store/products', browseProducts);
router.get('/:store/reviews', getStoreReviews);
router.get('/:store/offers', getStoreOffers);

module.exports = router;