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
const couponService = require('../services/stores.coupon.service');
const storefrontService = require('../services/stores.storefront.service');
const validate = require('../../../middlewares/validate');
const V = require('../validations/stores.validation');

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
 * @description The chain owns the catalogue, the outlet owns availability (BR-36).
 *
 * `outlet` alone was not enough: `listProducts` has no outlet filter, so this returned
 * every chain's catalogue and a storefront showed products it could not sell. The outlet
 * is resolved first and its chain is the catalogue filter, so the query is scoped by the
 * PATH and cannot be widened by a caller-supplied `chain`.
 */
const browseProducts = async (req, res) => {
  const StoreOutlet = mongoose.model('StoreOutlet');
  const outlet = await StoreOutlet.findById(req.params.store).select('chain status').lean();
  if (!outlet || outlet.status !== 'active') throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');

  const result = await catalogService.listProducts({
    ...req.query,
    chain: outlet.chain,
    outlet: req.params.store,
  });
  res.status(httpStatus.OK).send(result);
};

const getStoreReviews = async (req, res) => {
  const result = await reviewService.listReviews({ outlet: req.params.store, status: 'approved' });
  res.status(httpStatus.OK).send(result);
};

/**
 * @function activeOffers
 * @description Only `active` AND `isActive` promotions inside their start/end window.
 * The flags alone were checked before, so an offer whose `endsAt` had passed stayed on
 * the storefront and failed at checkout. Chain-wide promotions (no `outlet`) are included
 * because that is how a brand offer is modelled; an outlet promotion is scoped to the
 * outlet in the path.
 */
const activeOffers = async (storeId) => {
  const StoreOutlet = mongoose.model('StoreOutlet');
  const StorePromotion = mongoose.model('StorePromotion');
  const outlet = await StoreOutlet.findById(storeId).select('chain').lean();
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');

  const now = new Date();
  return StorePromotion.find({
    ...StorePromotion.redeemableFilter(now),
    $or: [{ outlet: storeId }, { chain: outlet.chain, outlet: null }],
  })
    .select('name description type value maxDiscount minOrderAmount code startsAt endsAt')
    .sort({ createdAt: -1 })
    .lean();
};

const getStoreOffers = async (req, res) => {
  const promotions = await activeOffers(req.params.store);
  res.status(httpStatus.OK).send({ promotions });
};

/**
 * @function getStoreCoupons
 * @description The redeemable subset of the same offers: a promotion without a code is
 * an automatic discount, and showing it as a coupon the customer must type is a dead end.
 * The code is lowercased for display; validation uppercases on input.
 */
const getStoreCoupons = async (req, res) => {
  const StoreOutlet = mongoose.model('StoreOutlet');
  const outlet = await StoreOutlet.findById(req.params.store).select('chain').lean();
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');

  const [promotions, couponDocs] = await Promise.all([
    activeOffers(req.params.store),
    couponService.listActiveCoupons({ chain: outlet.chain, outlet: req.params.store }),
  ]);
  const promotionCoupons = promotions.filter((promotion) => promotion.code);
  res.status(httpStatus.OK).send({ coupons: [...couponDocs, ...promotionCoupons] });
};

// `eligibilityService` is not required here: eligibility is a partner-side concern and
// this file serves only the public storefront reads. Importing it "for symmetry" would
// be a lie about what this router does.

// ---------------------------------------------------------------------------
// chain-first customer surface (Phase 4 / Phase 16 contract)
//
// LITERAL segments before `/:store`. `/chains` and `/:store` are both one-segment GETs,
// so declaring `/chains` after the catch-all would make it unreachable.
// ---------------------------------------------------------------------------

const getCatalogTree = async (req, res) => {
  const categories = await storefrontService.getCatalogTree();
  res.status(httpStatus.OK).send({ categories });
};

const listChains = async (req, res) => {
  const chains = await storefrontService.listChains({
    lat: req.query.lat,
    lng: req.query.lng,
    radiusKm: req.query.radiusKm,
    limit: req.query.limit,
  });
  res.status(httpStatus.OK).send({ chains });
};

const getChainProfile = async (req, res) => {
  const result = await storefrontService.getChainProfile({
    chain: req.params.chain,
    outlet: req.query.outlet,
  });
  res.status(httpStatus.OK).send(result);
};

const getChainProducts = async (req, res) => {
  const result = await storefrontService.listChainProducts({
    chain: req.params.chain,
    outlet: req.query.outlet,
    query: req.query,
  });
  res.status(httpStatus.OK).send(result);
};

const getChainReviews = async (req, res) => {
  const result = await storefrontService.listChainReviews({
    chain: req.params.chain,
    page: req.query.page,
    limit: req.query.limit,
  });
  res.status(httpStatus.OK).send(result);
};

const getChainOffers = async (req, res) => {
  const promotions = await storefrontService.listChainOffers({ chain: req.params.chain });
  res.status(httpStatus.OK).send({ promotions });
};

router.get('/catalog/tree', getCatalogTree);
router.get('/chains', validate(V.chainListValidation), listChains);
router.get('/chains/:chain', validate(V.chainProfileValidation), getChainProfile);
router.get('/chains/:chain/products', validate(V.chainProductsValidation), getChainProducts);
router.get('/chains/:chain/reviews', validate(V.chainReviewsValidation), getChainReviews);
router.get('/chains/:chain/offers', validate(V.chainOffersValidation), getChainOffers);

router.get('/:store', getStoreProfile);
router.get('/:store/products', browseProducts);
router.get('/:store/reviews', getStoreReviews);
router.get('/:store/offers', getStoreOffers);
router.get('/:store/coupons', getStoreCoupons);

module.exports = router;