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
 * verify.stores.featured.js — paid visibility.
 *
 * Run: node scripts/verify.stores.featured.js
 *
 * ## What this pins
 *
 *   A featured placement is money for visibility: the outlet pays, then the placement
 *   goes live. The order of those two events is the whole rule — approving an unpaid
 *   placement gives away the slot for free:
 *
 *     pending_payment -> paid -> approved -> live
 *                             -> rejected
 *
 *   - `approveFeaturedPlacement` refuses anything not yet paid (409)
 *   - reads and writes are outlet-scoped; another outlet's placement is a 404
 *   - `getLivePlacements` and `getPendingApprovals` answer the two questions the
 *     storefront and the approver actually ask
 */

const mongoose = require('mongoose');
require('dotenv').config();

const featuredService = require('../src/modules/stores/services/stores.featured.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.featured.placement.model');
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.chain.model');
require('../src/modules/stores/models/store.chain.model');

const StoreFeaturedPlacement = mongoose.model('StoreFeaturedPlacement');

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
const OTHER_OUTLET = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();
const PRODUCT = new mongoose.Types.ObjectId();

const makePlacement = async (overrides = {}) =>
  featuredService.createFeaturedPlacement({
    subjectType: 'product',
    outlet: OUTLET,
    chain: CHAIN,
    product: PRODUCT,
    slot: 'homepage-hero',
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    amount: 1000,
    ...overrides,
  });

const cleanup = async () => {
  await StoreFeaturedPlacement.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await mongoose.model('StoreOutlet').deleteMany({ _id: { $in: [OUTLET, OTHER_OUTLET] } });
  await mongoose.model('StoreChain').deleteMany({ _id: CHAIN });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  // listFeaturedPlacements populates outlet/chain/product: synthetic ids read back null,
  // so the outlet and chain rows must exist.
  await mongoose.model('StoreChain').create({ _id: CHAIN, business: new mongoose.Types.ObjectId(), name: 'featured suite', slug: 'featured-suite' });
  await mongoose.model('StoreOutlet').create({ _id: OUTLET, chain: CHAIN, outletCode: 'FEAT', name: 'featured suite' });

  console.log('\n=== a placement starts awaiting payment ===\n');

  const placement = await makePlacement();
  ck('a placement starts at pending_payment', placement.status === 'pending_payment', placement.status);

  console.log('\n=== approval requires payment first ===\n');

  let unpaid = false;
  try {
    await featuredService.approveFeaturedPlacement(placement._id, { outlet: OUTLET });
  } catch (e) {
    unpaid = e.statusCode === 409;
  }
  ck('approving an unpaid placement is refused', unpaid);

  // Simulate payment: the billing path flips pending_payment -> paid.
  await StoreFeaturedPlacement.updateOne({ _id: placement._id }, { status: 'paid' });
  const approved = await featuredService.approveFeaturedPlacement(placement._id, {
    outlet: OUTLET, actor: new mongoose.Types.ObjectId(),
  });
  ck('a paid placement approves', approved.status === 'approved', approved.status);
  ck('the approver is stamped', !!approved.approvedBy && !!approved.approvedAt);

  let doubleApprove = false;
  try {
    await featuredService.approveFeaturedPlacement(placement._id, { outlet: OUTLET });
  } catch (e) {
    doubleApprove = e.statusCode === 409;
  }
  ck('an approved placement cannot be approved again', doubleApprove);

  console.log('\n=== rejection ===\n');

  const toReject = await makePlacement();
  const rejected = await featuredService.rejectFeaturedPlacement(toReject._id, {
    outlet: OUTLET, reason: 'slot full',
  });
  ck('a pending placement rejects', rejected.status === 'rejected', rejected.status);

  console.log('\n=== outlet scoping ===\n');

  let crossRead = false;
  try {
    await featuredService.getFeaturedPlacement(placement._id, { outlet: OTHER_OUTLET });
  } catch (e) {
    crossRead = e.statusCode === 404;
  }
  ck('another outlet cannot read this placement', crossRead);

  let crossApprove = false;
  try {
    await featuredService.approveFeaturedPlacement(placement._id, { outlet: OTHER_OUTLET });
  } catch (e) {
    crossApprove = e.statusCode === 404;
  }
  ck('another outlet cannot approve this placement', crossApprove);

  console.log('\n=== live and pending queries ===\n');

  const live = await featuredService.getLivePlacements(OUTLET);
  ck('live placements resolve without throwing', Array.isArray(live));

  const pending = await featuredService.getPendingApprovals();
  ck('pending approvals resolve without throwing', Array.isArray(pending));

  console.log('\n=== listing ===\n');

  const listed = await featuredService.listFeaturedPlacements({ outlet: OUTLET, page: 1, limit: 10 });
  ck('listing scopes to the outlet', listed.items.every((r) => String(r.outlet) === String(OUTLET) || String(r.outlet._id) === String(OUTLET)));
  ck('listing reports totals and paging', typeof listed.total === 'number' && listed.page === 1);
  const byStatus = await featuredService.listFeaturedPlacements({ outlet: OUTLET, status: 'approved' });
  ck('status filter returns only that status', byStatus.items.length > 0 && byStatus.items.every((r) => r.status === 'approved'));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES FEATURED CHECKS PASSED' : failures + ' STORES FEATURED CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });