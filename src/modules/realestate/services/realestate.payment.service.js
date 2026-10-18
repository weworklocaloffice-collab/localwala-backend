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

const orderService = require('./realestate.listing.order.service');
const holdService = require('./realestate.hold.service');
const holdRefundService = require('./realestate.hold.refund.service');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');

/**
 * realestate.payment.service.js — the Real Estate side of the shared
 * payment engine.
 *
 * Same contract as `stores.payment.service.routePaidCallback`: the
 * gateway controller (`payment.initiation.controller.js`) stays
 * vertical-agnostic and asks this module whether a paid callback is
 * Real-Estate-owned. One hook covers all 9 gateways, so the gateway
 * file carries no Real Estate logic beyond the hook line itself.
 *
 * Subjects:
 *   listing_package      vendor package order → markPaid → entitlement
 *   property_hold        customer hold total → activateHold → 2 ledger rows
 *   property_hold_refund admin principal release → completeRefund → CREDITs
 *
 * Idempotency: gateway callbacks retry. Every apply is safe to run
 * twice — an already-paid order, an already-ACTIVE hold, or an
 * already-COMPLETED refund is a no-op.
 */

const REAL_ESTATE_PAYMENT_SUBJECTS = Object.freeze(['listing_package', 'property_hold', 'property_hold_refund']);

const isRealEstateSubject = (paymentFrom) => REAL_ESTATE_PAYMENT_SUBJECTS.includes(paymentFrom);

/**
 * @param {object} payment the initiation document
 *   (`paymentInfo.payments`), with `paymentFrom` plus `listingOrder` /
 *   `hold` / `holdRefund` refs.
 * @returns {Promise<boolean>} true when handled here; false when the
 *   gateway controller must continue with its own dispatch.
 */
const routePaidCallback = async (payment) => {
  if (!payment || !isRealEstateSubject(payment.paymentFrom)) return false;
  if (payment.paymentFrom === 'listing_package') {
    await applyListingPackagePayment(payment);
    return true;
  }
  if (payment.paymentFrom === 'property_hold') {
    await applyHoldPayment(payment);
    return true;
  }
  await applyHoldRefundPayment(payment);
  return true;
};

const applyListingPackagePayment = async (payment) => {
  if (!payment.listingOrder) {
    console.error('listing_package callback with no listingOrder ref');
    return;
  }
  const RealEstateListingOrder = require('../models/realestate.listing.order.model');
  const order = await RealEstateListingOrder.findById(payment.listingOrder);
  if (!order) {
    console.error(`listing_package callback for missing order ${payment.listingOrder}`);
    return;
  }
  if (order.status === 'PAID') return; // webhook replay
  await orderService.markPaid(order._id);
};

const applyHoldPayment = async (payment) => {
  if (!payment.hold) {
    console.error('property_hold callback with no hold ref');
    return;
  }
  const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
  const hold = await RealEstatePropertyHold.findById(payment.hold);
  if (!hold) {
    console.error(`property_hold callback for missing hold ${payment.hold}`);
    return;
  }
  if (hold.status === 'ACTIVE') return; // webhook replay
  if (hold.status !== 'PENDING_PAYMENT') {
    console.error(`property_hold callback for hold ${payment.hold} in ${hold.status}`);
    return;
  }
  // F-11: activation writes 2 ledger rows + the hold flip — one unit.
  await withOptionalTransaction((session) => holdService.activateHold(hold._id, session));
};

const applyHoldRefundPayment = async (payment) => {
  if (!payment.holdRefund) {
    console.error('property_hold_refund callback with no holdRefund ref');
    return;
  }
  const RealEstateHoldRefund = require('../models/realestate.hold.refund.model');
  const refund = await RealEstateHoldRefund.findById(payment.holdRefund);
  if (!refund) {
    console.error(`property_hold_refund callback for missing refund ${payment.holdRefund}`);
    return;
  }
  if (refund.status === 'COMPLETED') return; // webhook replay
  // F-11: completion writes ledger CREDITs + refund + hold flips — one unit.
  await withOptionalTransaction((session) => holdRefundService.completeRefund(refund._id, null, session));
};

module.exports = {
  REAL_ESTATE_PAYMENT_SUBJECTS,
  isRealEstateSubject,
  routePaidCallback,
};
