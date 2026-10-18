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

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const SERVICE_UNAVAILABLE = (httpStatus && httpStatus.SERVICE_UNAVAILABLE) || 503;
const { PaymentInitiation, PaymentConfig } = require('../../../models');
const paymentInitiationService = require('../../../services/payment.initiation.service');
const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
const RealEstateHoldPayment = require('../models/realestate.hold.payment.model');
const policyService = require('./realestate.hold.policy.service');

/**
 * Hold payment initiation (customer PENDING_PAYMENT → gateway).
 *
 * The hold itself is created first (BR-12 reserve + BR-15 snapshot);
 * this step creates the `property_hold` initiation the gateway calls
 * back into via `realestate.payment.service routePaidCallback`, which
 * runs `activateHold` (2 ledger rows) on confirm. Idempotent: an
 * existing `initiated` initiation for the hold is returned, never
 * duplicated — gateway callbacks also replay safely.
 *
 * OD-01 gate: live hold payments stay disabled until an APPROVED
 * custodial arrangement is in force. The throw surfaces verbatim in
 * the app so the customer sees why pay is unavailable.
 */
async function initiateHoldPayment({ holdId, customerId, paymentConfigId = null }) {
  const hold = await RealEstatePropertyHold.findById(holdId);
  if (!hold || String(hold.customer) !== String(customerId)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Hold not found');
  }
  if (hold.status !== 'PENDING_PAYMENT') {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      `Hold is ${hold.status} and cannot be paid.`
    );
  }

  // OD-01: re-assert at pay time, not just at creation. A hold created
  // before a custody change must not become payable under unapproved terms.
  const policy = hold.policy
    ? await policyService.getById(hold.policy)
    : await policyService.getActive();
  policyService.assertCustodyApprovedForLive(policy);

  const existing = await PaymentInitiation.findOne({
    hold: hold._id,
    status: 'initiated',
  }).sort({ createdAt: -1 });
  if (existing) return { hold, initiation: existing };

  let paymentConfig = null;
  if (paymentConfigId) {
    paymentConfig = await PaymentConfig.findById(paymentConfigId);
    if (!paymentConfig) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Payment method not found');
    }
  } else {
    paymentConfig =
      (await PaymentConfig.findOne({ isDefault: true, status: true, paymentWay: 'online' })) ||
      (await PaymentConfig.findOne({ status: true, paymentWay: 'online' }));
    if (!paymentConfig) {
      throw new ApiError(SERVICE_UNAVAILABLE, 'Online payments are not available right now');
    }
  }

  const amount = Number(hold.total);
  if (!(amount > 0)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Hold total must be positive to pay.');
  }

  const initiation = await paymentInitiationService.initiatePayment({
    user: String(customerId),
    payment: String(paymentConfig._id),
    hold: String(hold._id),
    amount,
    from: 'property_hold',
    ref: `property hold ${hold.holdCode}`,
  });

  try {
    await RealEstateHoldPayment.create({
      hold: hold._id,
      customer: hold.customer,
      amount,
      paymentInitiation: initiation._id,
      paymentRef: `property hold ${hold.holdCode}`,
      status: 'PENDING',
    });
  } catch (e) {
    // Concurrent double-tap: another request won the PENDING race and the
    // partial unique index rejected this write with E11000. Return the
    // existing initiation so the customer pays once, not twice. The orphan
    // initiation above stays `initiated` and is harmless: the next call's
    // `findOne initiated` check returns it, and the gateway callback is
    // idempotent (already-ACTIVE hold is a no-op).
    if (e && e.code === 11000) {
      const winner = await PaymentInitiation.findOne({
        hold: hold._id,
        status: 'initiated',
      }).sort({ createdAt: 1 });
      if (winner) return { hold, initiation: winner };
    }
    throw e;
  }

  return { hold, initiation };
}

module.exports = {
  initiateHoldPayment,
};
