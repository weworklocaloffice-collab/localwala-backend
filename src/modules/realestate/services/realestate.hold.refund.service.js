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

const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
const RealEstateHoldRefund = require('../models/realestate.hold.refund.model');
const holdService = require('./realestate.hold.service');
const ledgerService = require('./realestate.ledger.service');

/**
 * Hold refund service (plan §6.5).
 *
 * No refund path bypasses the existing payment stack: the payout goes
 * through `payment.initiation.service` with
 * `paymentFrom: 'property_hold_refund'`. On gateway confirm, in ONE
 * transaction: hold → REFUNDED, refund → COMPLETED, ledger CREDITs
 * (principal LIABILITY, fee REVENUE only if refundable).
 *
 * `requestRefund` creates the PENDING row and computes the split from
 * the §6.2 matrix. `completeRefund` applies it. The gateway call
 * between them belongs to the payment controller, not here.
 */

async function requestRefund(holdId, event, requestedBy = null, session = null) {
  const hold = await RealEstatePropertyHold.findById(holdId);
  if (!hold) throw new Error('Hold not found');
  const split = holdService.resolveDisposition(event, hold.policySnapshot || {});
  const snap = hold.policySnapshot || {};
  const doc = {
    hold: hold._id,
    customer: hold.customer,
    principalAmount: split.refundPrincipal ? hold.principal : 0,
    feeAmount: split.refundFee ? hold.serviceFee : 0,
    reason: event === 'EXPIRY' ? 'EXPIRY' : event === 'LISTING_WITHDRAWN' ? 'LISTING_WITHDRAWN' : event === 'SALE_ABORTED' ? 'SALE_ABORTED' : 'CANCELLATION',
    status: 'PENDING',
    // Freeze custody + tax + SLA at request time — reports render from here.
    custodySnapshot: snap.custodySnapshot || {},
    taxSnapshot: snap.taxSnapshot || {},
    refundSLASnapshot:
      (snap.custodySnapshot && snap.custodySnapshot.refundSLA) || 'standard',
  };
  if (requestedBy) doc.requestedBy = requestedBy;
  const created = session
    ? (await RealEstateHoldRefund.create([doc], { session }))[0]
    : await RealEstateHoldRefund.create(doc);

  hold.status = 'REFUND_PENDING';
  hold.refund = created._id;
  await hold.save(session ? { session } : {});
  return created;
}

async function completeRefund(refundId, processedBy = null, session = null) {
  const refund = await RealEstateHoldRefund.findById(refundId);
  if (!refund) throw new Error('Refund not found');
  if (refund.status === 'COMPLETED') return refund;

  const custodyRef =
    (refund.custodySnapshot && (refund.custodySnapshot.custodyAccount || refund.custodySnapshot.custodianBankReference)) ||
    null;
  if (refund.principalAmount > 0) {
    await ledgerService.record(
      {
        eventType: 'REFUND',
        accountType: 'LIABILITY',
        direction: 'CREDIT',
        amount: refund.principalAmount,
        partyType: 'CUSTOMER',
        party: refund.customer,
        sourceModel: 'RealEstateHoldRefund',
        sourceId: refund._id,
        narration: `Hold principal refund for hold ${refund.hold}`,
        custodyReference: custodyRef,
        metadata: {
          holdId: String(refund.hold),
          custodySnapshot: refund.custodySnapshot || {},
          taxSnapshot: (refund.taxSnapshot && refund.taxSnapshot.holdPrincipal) || { inactive: true },
          refundSLA: refund.refundSLASnapshot || null,
        },
      },
      session
    );
  }
  if (refund.feeAmount > 0) {
    await ledgerService.record(
      {
        eventType: 'REFUND',
        accountType: 'REVENUE',
        direction: 'CREDIT',
        amount: refund.feeAmount,
        partyType: 'CUSTOMER',
        party: refund.customer,
        sourceModel: 'RealEstateHoldRefund',
        sourceId: refund._id,
        narration: `Hold fee refund for hold ${refund.hold}`,
        custodyReference: custodyRef,
        metadata: {
          holdId: String(refund.hold),
          custodySnapshot: refund.custodySnapshot || {},
          taxSnapshot: (refund.taxSnapshot && refund.taxSnapshot.holdServiceFee) || { inactive: true },
          refundSLA: refund.refundSLASnapshot || null,
        },
      },
      session
    );
  }

  refund.status = 'COMPLETED';
  refund.completedAt = new Date();
  if (processedBy) refund.processedBy = processedBy;
  await refund.save(session ? { session } : {});

  const hold = await RealEstatePropertyHold.findById(refund.hold);
  if (hold) {
    hold.status = 'REFUNDED';
    await hold.save(session ? { session } : {});
  }
  // Phase 10: customer confirmation. Never throws into completion.
  try {
    const fcm = require('../../../services/fcm.notification.service');
    await fcm.realEstateHoldRefunded({
      userId: refund.customer,
      recipientType: 'CUSTOMER',
      title: 'Refund completed',
      body: 'Your hold refund has been completed.',
      data: { refundId: String(refund._id), holdId: String(refund.hold) },
    });
  } catch (e) {
    /* notify-only */
  }
  return refund;
}

const realEstateHoldRefundService = {
  requestRefund,
  completeRefund,
};

module.exports = realEstateHoldRefundService;
