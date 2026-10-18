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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.reviews.js — ratings, and what moves the storefront number.
 *
 * Run: node scripts/verify.stores.reviews.js
 *
 * ## What this pins
 *
 *   - one review per (customer, order, product): a second submission is a 409, so a
 *     customer cannot stack their own rating
 *   - a review with an order is a verified purchase; without one it is not
 *   - new reviews start `pending` — nothing reaches the storefront unmoderated
 *   - the outlet rating is the average of APPROVED reviews only, rounded to one decimal,
 *     and it is recomputed on every moderation decision
 *   - helpful votes increment without touching anything else
 */

const mongoose = require('mongoose');
require('dotenv').config();

const reviewService = require('../src/modules/stores/services/stores.review.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.review.model');
require('../src/modules/stores/models/store.outlet.model');

const StoreReview = mongoose.model('StoreReview');
const StoreOutlet = mongoose.model('StoreOutlet');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const OUTLET = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();
const CUSTOMER = new mongoose.Types.ObjectId();
const PRODUCT = new mongoose.Types.ObjectId();
const ORDER = new mongoose.Types.ObjectId();

const cleanup = async () => {
  await StoreReview.deleteMany({ outlet: OUTLET });
  await StoreOutlet.deleteMany({ _id: OUTLET });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  await StoreOutlet.create({ _id: OUTLET, chain: CHAIN, outletCode: 'REV', name: 'review suite' });

  console.log('\n=== one review per customer, order and product ===\n');

  const first = await reviewService.createReview({
    chain: CHAIN, outlet: OUTLET, customer: CUSTOMER, order: ORDER,
    product: PRODUCT, rating: 5, title: 'Great', comment: 'Loved it',
  });
  ck('a review starts pending', first.status === 'pending', first.status);
  ck('an order-backed review is a verified purchase', first.isVerifiedPurchase === true);
  ck('images default to empty', Array.isArray(first.images) && first.images.length === 0);

  let dup = false;
  try {
    await reviewService.createReview({
      chain: CHAIN, outlet: OUTLET, customer: CUSTOMER, order: ORDER,
      product: PRODUCT, rating: 1, title: 'Second', comment: 'Trying again',
    });
  } catch (e) {
    dup = e.statusCode === 409;
  }
  ck('a second review for the same triple is refused', dup);

  const differentProduct = await reviewService.createReview({
    chain: CHAIN, outlet: OUTLET, customer: CUSTOMER, order: ORDER,
    product: new mongoose.Types.ObjectId(), rating: 4, title: 'Other', comment: 'Fine',
  });
  ck('a different product on the same order gets its own review', !!differentProduct._id);
  await StoreReview.deleteOne({ _id: differentProduct._id });

  const noOrder = await reviewService.createReview({
    chain: CHAIN, outlet: OUTLET, customer: new mongoose.Types.ObjectId(),
    product: PRODUCT, rating: 4, title: 'No order', comment: 'Saw it in store',
  });
  ck('a review without an order is not a verified purchase', noOrder.isVerifiedPurchase === false);
  await StoreReview.deleteOne({ _id: noOrder._id });

  console.log('\n=== moderation moves the outlet number ===\n');

  const before = await StoreOutlet.findById(OUTLET).select('rating ratingCount').lean();
  ck('the outlet starts unrated', (before.rating || 0) === 0 && (before.ratingCount || 0) === 0);

  await reviewService.moderateReview(first._id, { status: 'approved' });
  const afterApprove = await StoreOutlet.findById(OUTLET).lean();
  ck('approving the only review sets the outlet rating', afterApprove.rating === 5 && afterApprove.ratingCount === 1,
    `${afterApprove.rating}/${afterApprove.ratingCount}`);

  const second = await reviewService.createReview({
    chain: CHAIN, outlet: OUTLET, customer: new mongoose.Types.ObjectId(), order: new mongoose.Types.ObjectId(),
    product: new mongoose.Types.ObjectId(), rating: 3, title: 'OK', comment: 'Average',
  });
  await reviewService.moderateReview(second._id, { status: 'approved' });
  const afterTwo = await StoreOutlet.findById(OUTLET).lean();
  ck('the average covers approved reviews only ((5+3)/2)', afterTwo.rating === 4 && afterTwo.ratingCount === 2,
    `${afterTwo.rating}/${afterTwo.ratingCount}`);

  const pending = await reviewService.createReview({
    chain: CHAIN, outlet: OUTLET, customer: new mongoose.Types.ObjectId(), order: new mongoose.Types.ObjectId(),
    product: new mongoose.Types.ObjectId(), rating: 1, title: 'Low', comment: 'Bad',
  });
  const withPending = await StoreOutlet.findById(OUTLET).lean();
  ck('a pending review does not move the number', withPending.rating === 4 && withPending.ratingCount === 2,
    `${withPending.rating}/${withPending.ratingCount}`);

  await reviewService.moderateReview(first._id, { status: 'rejected' });
  const afterReject = await StoreOutlet.findById(OUTLET).lean();
  ck('rejecting the 5-star leaves the 3-star as the average', afterReject.rating === 3 && afterReject.ratingCount === 1,
    `${afterReject.rating}/${afterReject.ratingCount}`);
  await StoreReview.deleteMany({ _id: { $in: [second._id, pending._id] } });

  console.log('\n=== helpful votes and listing ===\n');

  const helpful = await reviewService.markHelpful(first._id);
  ck('a helpful vote increments', Number(helpful.isHelpful) === 1, helpful.isHelpful);
  const helpfulAgain = await reviewService.markHelpful(first._id);
  ck('votes accumulate', Number(helpfulAgain.isHelpful) === 2, helpfulAgain.isHelpful);

  const listed = await reviewService.listReviews({ outlet: OUTLET, page: 1, limit: 10 });
  ck('listing scopes to the outlet', listed.items.every((r) => String(r.outlet) === String(OUTLET)));
  ck('listing reports totals and paging', typeof listed.total === 'number' && listed.page === 1);
  const approvedOnly = await reviewService.listReviews({ outlet: OUTLET, status: 'approved' });
  ck('status filter returns only that status',
    approvedOnly.items.length >= 0 && approvedOnly.items.every((r) => r.status === 'approved'));

  let missing = false;
  try {
    await reviewService.moderateReview(new mongoose.Types.ObjectId(), { status: 'approved' });
  } catch (e) {
    missing = e.statusCode === 404;
  }
  ck('moderating a missing review is a 404', missing);
};

run()
  .catch((e) => {
    failures += 1;
    console.log('\nSUITE ERROR: ' + (e && e.stack ? e.stack : e));
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      /* the run already failed; cleanup errors must not mask it */
    }
    await mongoose.disconnect();
    console.log('\n' + (failures === 0 ? 'ALL STORES REVIEW CHECKS PASSED' : failures + ' STORES REVIEW CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });