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
 * verify.stores.support.js — complaints and warranty claims.
 *
 * Run: node scripts/verify.stores.support.js
 *
 * ## What this pins
 *
 *   - both transition tables, legal and illegal: a complaint or claim that accepts a move
 *     the table forbids will mislead every screen built on it (the partner app mirrors
 *     both tables as lookups, and a drift means a button that 409s)
 *   - ORDER_NOT_OWNED on both: a customer cannot file against another customer's order,
 *     which is the one authorization check standing between strangers' orders
 *   - OUTLET_MISMATCH on warranty: the claim must name the outlet that sold it
 *   - outlet scoping on reads: one outlet's queue never shows another's rows
 */

const mongoose = require('mongoose');
require('dotenv').config();

const complaintService = require('../src/modules/stores/services/stores.complaint.service');
const warrantyService = require('../src/modules/stores/services/stores.warranty.service');

// The services resolve models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.complaint.model');
require('../src/modules/stores/models/store.warranty.request.model');
require('../src/modules/stores/models/store.order.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/chain.product.variant.model');

const StoreComplaint = mongoose.model('StoreComplaint');
const StoreWarrantyRequest = mongoose.model('StoreWarrantyRequest');
const StoreOrder = mongoose.model('StoreOrder');

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
const CUSTOMER = new mongoose.Types.ObjectId();
const OTHER_CUSTOMER = new mongoose.Types.ObjectId();
const PRODUCT = new mongoose.Types.ObjectId();
const VARIANT = new mongoose.Types.ObjectId();
const STAMP = Date.now();

let orderNoSeq = 0;

const makeOrder = async (customer = CUSTOMER, outlet = OUTLET) =>
  StoreOrder.create({
    orderNo: 990000 + (orderNoSeq += 1) + (STAMP % 1000),
    customer,
    outlet,
    chain: CHAIN,
    items: [],
    grandTotal: 100,
    paymentMode: 'gateway',
    paymentStatus: 'paid',
    lifecycle: 'completed',
  });

const cleanup = async () => {
  await StoreComplaint.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await StoreWarrantyRequest.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await StoreOrder.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== the complaint transition table ===\n');

  let allLegal = true;
  for (const [from, allowed] of Object.entries(complaintService.COMPLAINT_TRANSITIONS || {})) {
    for (const to of allowed) {
      try {
        complaintService.assertTransition(from, to);
      } catch (e) {
        allLegal = false;
        ck(`complaint ${from} -> ${to} allowed`, false, e.message);
      }
    }
  }
  ck('every permitted complaint transition is accepted', allLegal);

  // The table is exported; if a future change removes the export, the partner app's
  // mirrored lookup silently goes stale, so assert the export itself.
  ck('the complaint table is exported for clients to mirror',
    !!complaintService.COMPLAINT_TRANSITIONS && Object.keys(complaintService.COMPLAINT_TRANSITIONS).length === 5);

  const illegal = [
    ['open', 'picked_up'],
    ['resolved', 'in_progress'],
    ['resolved', 'escalated'],
    ['closed', 'resolved'],
    ['closed', 'escalated'],
    ['escalated', 'open'],
  ];
  for (const [from, to] of illegal) {
    let msg = '';
    try {
      complaintService.assertTransition(from, to);
    } catch (e) {
      msg = e.message || '';
    }
    ck(`complaint ${from} -> ${to} is rejected`, /ILLEGAL_COMPLAINT_MOVE/.test(msg), msg);
  }

  console.log('\n=== complaints: ownership and scoping ===\n');

  const order = await makeOrder();

  let stranger = false;
  try {
    await complaintService.createComplaint({
      customer: OTHER_CUSTOMER, outlet: OUTLET, chain: CHAIN, order: order._id,
      subject: 'not mine', description: 'filing against a stranger', category: 'delivery',
    });
  } catch (e) {
    stranger = e.statusCode === 403 && /ORDER_NOT_OWNED/.test(e.message);
  }
  ck('a customer cannot complain against another customer order', stranger);

  let ghostOrder = false;
  try {
    await complaintService.createComplaint({
      customer: CUSTOMER, outlet: OUTLET, chain: CHAIN, order: new mongoose.Types.ObjectId(),
      subject: 'ghost', description: 'no such order', category: 'delivery',
    });
  } catch (e) {
    ghostOrder = e.statusCode === 404;
  }
  ck('complaining against a missing order is a 404', ghostOrder);

  const complaint = await complaintService.createComplaint({
    customer: CUSTOMER, outlet: OUTLET, chain: CHAIN, order: order._id,
    subject: 'late delivery', description: 'arrived cold', priority: 'high', category: 'delivery',
  });
  ck('a complaint starts open', complaint.status === 'open', complaint.status);
  ck('priority defaults to medium when unasked', (await complaintService.createComplaint({
    customer: CUSTOMER, outlet: OUTLET, chain: CHAIN, subject: 'x', description: 'y', category: 'delivery',
  })).priority === 'medium');

  const moved = await complaintService.transitionComplaint(complaint._id, 'in_progress', { outlet: OUTLET });
  ck('open -> in_progress', moved.status === 'in_progress', moved.status);

  let crossMove = false;
  try {
    await complaintService.transitionComplaint(complaint._id, 'resolved', { outlet: OTHER_OUTLET });
  } catch (e) {
    crossMove = e.statusCode === 404;
  }
  ck('transitioning through another outlet is a 404', crossMove);

  const resolved = await complaintService.transitionComplaint(complaint._id, 'resolved', { outlet: OUTLET });
  ck('in_progress -> resolved', resolved.status === 'resolved', resolved.status);
  const closed = await complaintService.transitionComplaint(complaint._id, 'closed', { outlet: OUTLET });
  ck('resolved -> closed', closed.status === 'closed', closed.status);

  const openList = await complaintService.getOpenComplaints(OUTLET);
  ck('a closed complaint leaves the open queue', !openList.some((c) => String(c._id) === String(complaint._id)));
  const otherList = await complaintService.getOpenComplaints(OTHER_OUTLET);
  ck('another outlet sees none of this outlet rows', otherList.length === 0);

  console.log('\n=== the warranty transition table ===\n');

  let allWarrantyLegal = true;
  for (const [from, allowed] of Object.entries(warrantyService.WARRANTY_TRANSITIONS || {})) {
    for (const to of allowed) {
      try {
        warrantyService.assertTransition(from, to);
      } catch (e) {
        allWarrantyLegal = false;
        ck(`warranty ${from} -> ${to} allowed`, false, e.message);
      }
    }
  }
  ck('every permitted warranty transition is accepted', allWarrantyLegal);
  ck('the warranty table is exported for clients to mirror',
    !!warrantyService.WARRANTY_TRANSITIONS && Object.keys(warrantyService.WARRANTY_TRANSITIONS).length === 7);

  const wIllegal = [
    ['requested', 'in_repair'],
    ['requested', 'resolved'],
    ['approved', 'closed'],
    ['resolved', 'in_repair'],
    ['closed', 'open'],
    ['cancelled', 'open'],
  ];
  for (const [from, to] of wIllegal) {
    let msg = '';
    try {
      warrantyService.assertTransition(from, to);
    } catch (e) {
      msg = e.message || '';
    }
    ck(`warranty ${from} -> ${to} is rejected`, /ILLEGAL/.test(msg), msg);
  }

  console.log('\n=== warranty: ownership, outlet match, and expiry watch ===\n');

  let wStranger = false;
  try {
    await warrantyService.createWarrantyRequest({
      customer: OTHER_CUSTOMER, outlet: OUTLET, chain: CHAIN, order: order._id,
      product: PRODUCT, variant: VARIANT, warrantyType: 'manufacturer',
      warrantyMonths: 12, purchaseDate: new Date(), issueDescription: 'dead on arrival',
    });
  } catch (e) {
    wStranger = e.statusCode === 403 && /ORDER_NOT_OWNED/.test(e.message);
  }
  ck('a warranty cannot be filed against another customer order', wStranger);

  let mismatch = false;
  try {
    await warrantyService.createWarrantyRequest({
      customer: CUSTOMER, outlet: OTHER_OUTLET, chain: CHAIN, order: order._id,
      product: PRODUCT, variant: VARIANT, warrantyType: 'manufacturer',
      warrantyMonths: 12, purchaseDate: new Date(), issueDescription: 'x',
    });
  } catch (e) {
    mismatch = e.statusCode === 409 && /OUTLET_MISMATCH/.test(e.message);
  }
  ck('a warranty naming the wrong outlet is refused', mismatch);

  const claim = await warrantyService.createWarrantyRequest({
    customer: CUSTOMER, outlet: OUTLET, chain: CHAIN, order: order._id,
    product: PRODUCT, variant: VARIANT, productName: 'Mixer', sku: 'MX-1',
    warrantyType: 'manufacturer', warrantyMonths: 12,
    purchaseDate: new Date(), warrantyExpiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    issueDescription: 'motor burned out',
  });
  ck('a claim starts requested', claim.status === 'requested', claim.status);

  const approved = await warrantyService.transitionWarranty(claim._id, 'approved', { outlet: OUTLET });
  ck('requested -> approved', approved.status === 'approved', approved.status);
  const inRepair = await warrantyService.transitionWarranty(claim._id, 'in_repair', { outlet: OUTLET });
  ck('approved -> in_repair', inRepair.status === 'in_repair', inRepair.status);
  const wResolved = await warrantyService.transitionWarranty(claim._id, 'resolved', { outlet: OUTLET });
  ck('in_repair -> resolved', wResolved.status === 'resolved', wResolved.status);
  const wClosed = await warrantyService.transitionWarranty(claim._id, 'closed', { outlet: OUTLET });
  ck('resolved -> closed', wClosed.status === 'closed', wClosed.status);

  const paged = await warrantyService.listWarrantyRequests({ outlet: OUTLET, page: 1, limit: 5 });
  ck('warranty listing pages', Array.isArray(paged.items) && typeof paged.total === 'number');
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
    console.log('\n' + (failures === 0 ? 'ALL STORES SUPPORT CHECKS PASSED' : failures + ' STORES SUPPORT CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });