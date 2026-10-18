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
const policyService = require('./realestate.hold.policy.service');
const ledgerService = require('./realestate.ledger.service');
const sequence = require('../models/realestate.sequence.model');
const { HOLD_TRANSITIONS, canTransition } = require('../utils/realestate.state.machine');

// Production: hold codes must be unique across restarts and PM2 instances.
// The old in-memory counter + timestamp slice collided after a restart
// (counter reset) and under concurrent creates (same ms slice).
// `sequence.next` is a single atomic $inc + upsert, so concurrent issuers
// never share a number.
async function nextHoldCode() {
  const seq = await sequence.next('holdCode');
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `HLD-${period}-${String(seq).padStart(6, '0')}`;
}

/**
 * §6.2 disposition matrix — pure logic, no database.
 *
 * Returns { refundPrincipal, refundFee } as booleans for the event.
 * Configurable per policy version (a future business change is a data
 * edit); the defaults below are the plan's decided rows.
 *
 *   CANCELLATION         principal YES / fee NO  (fee earned: off-market)
 *   EXPIRY               principal YES / fee NO
 *   SALE (convert)       principal → consideration / fee already earned
 *   LISTING_WITHDRAWN    principal YES / fee YES (we failed to deliver)
 *   SALE_ABORTED         principal YES / fee NO  (service was delivered)
 *   FORFEITURE           principal → revenue / dual control required
 */
function resolveDisposition(event, policySnapshot) {
  switch (event) {
    case 'CANCELLATION':
      return { refundPrincipal: policySnapshot.cancellationRefundable !== false, refundFee: false };
    case 'EXPIRY':
      return { refundPrincipal: policySnapshot.expiryRefundable !== false, refundFee: false };
    case 'SALE':
      return { refundPrincipal: false, refundFee: false, applyPrincipalToSale: true };
    case 'LISTING_WITHDRAWN':
      return {
        refundPrincipal: true,
        refundFee: policySnapshot.feeRefundableOnListingWithdrawal !== false,
      };
    case 'SALE_ABORTED':
      return { refundPrincipal: true, refundFee: false };
    case 'FORFEITURE':
      return { refundPrincipal: false, refundFee: false, forfeitPrincipal: true };
    default:
      throw new Error(`Unknown hold disposition event: ${event}`);
  }
}

function assertHoldTransition(from, to) {
  if (!canTransition(HOLD_TRANSITIONS, from, to)) {
    const allowed = HOLD_TRANSITIONS[from] || [];
    throw new Error(
      allowed.length
        ? `Cannot move hold from "${from}" to "${to}". Allowed: ${allowed.join(', ')}.`
        : `Hold is already "${from}" and cannot change.`
    );
  }
}

/**
 * Create a hold in PENDING_PAYMENT. The second hold on a held
 * property fails on the partial unique index (BR-12) — rejected, not
 * queued. Policy is frozen as `policySnapshot` (BR-15).
 */
async function createHold({ property, customer, lead = null }, session = null) {
  const policy = await policyService.getActive();

  // OD-01: only an APPROVED custody configuration may back live holds.
  // Unapproved PLATFORM_CURRENT is not compliant by default.
  policyService.assertCustodyApprovedForLive(policy);

  const snapshot = policyService.freeze(policy);
  const principal = policy.principalAmount;
  const fee = policyService.computeServiceFee(principal, {
    serviceFeePercent: snapshot.serviceFeePercent,
    serviceFeeMin: snapshot.serviceFeeMin,
    serviceFeeMax: snapshot.serviceFeeMax,
  });
  const doc = {
    holdCode: await nextHoldCode(),
    property,
    customer,
    policy: policy._id,
    policySnapshot: { ...snapshot, principalAmount: principal, serviceFeeMin: snapshot.serviceFeeMin || 0, serviceFeeMax: snapshot.serviceFeeMax || 0 },
    principal,
    serviceFee: fee,
    total: Number((principal + fee).toFixed(2)),
    status: 'PENDING_PAYMENT',
    placedAt: new Date(),
    expiresAt: new Date(Date.now() + snapshot.durationDays * 24 * 60 * 60 * 1000),
  };
  if (lead) doc.lead = lead;
  const created = session
    ? (await RealEstatePropertyHold.create([doc], { session }))[0]
    : await RealEstatePropertyHold.create(doc);
  // Phase 10: customer confirmation. Never throws into creation.
  try {
    const fcm = require('../../../services/fcm.notification.service');
    await fcm.realEstateHoldCreated({
      userId: customer,
      recipientType: 'CUSTOMER',
      title: 'Hold placed',
      body: `Hold ${created.holdCode} is awaiting payment.`,
      data: { holdId: String(created._id), propertyId: String(property) },
    });
  } catch (e) {
    /* notify-only */
  }
  return created;
}

/**
 * Activate a hold after payment succeeds. Writes TWO ledger entries —
 * LIABILITY (principal) + REVENUE (fee) — because one entry cannot be
 * both (plan §6.1). Fee is earned at ACTIVATION (BR-14).
 */
async function activateHold(holdId, session = null) {
  const hold = await RealEstatePropertyHold.findById(holdId);
  if (!hold) throw new Error('Hold not found');
  assertHoldTransition(hold.status, 'ACTIVE');

  // Runtime snapshots travel onto every ledger row so invoices, refunds
  // and reports render from frozen history — never from live Admin config.
  const snap = hold.policySnapshot || {};
  const custodyRef =
    (snap.custodySnapshot && (snap.custodySnapshot.custodyAccount || snap.custodySnapshot.custodianBankReference)) ||
    null;

  // Two supplies, two entries — never merged (BR-02/BR-15, OD-04 §4):
  // PROPERTY_HOLD (LIABILITY principal) + PROPERTY_HOLD_SERVICE_FEE (REVENUE fee).
  const principalEntry = await ledgerService.record(
    {
      eventType: 'PROPERTY_HOLD',
      accountType: 'LIABILITY',
      direction: 'DEBIT',
      amount: hold.principal,
      partyType: 'CUSTOMER',
      party: hold.customer,
      sourceModel: 'RealEstatePropertyHold',
      sourceId: hold._id,
      narration: `Hold principal ${hold.holdCode}`,
      custodyReference: custodyRef,
      metadata: {
        holdCode: hold.holdCode,
        custodySnapshot: snap.custodySnapshot || {},
        // Principal-side tax: inactive until approved determination.
        taxSnapshot: (snap.taxSnapshot && snap.taxSnapshot.holdPrincipal) || { inactive: true },
      },
    },
    session
  );
  const feeEntry = await ledgerService.record(
    {
      eventType: 'PROPERTY_HOLD_SERVICE_FEE',
      accountType: 'REVENUE',
      direction: 'DEBIT',
      amount: hold.serviceFee,
      partyType: 'CUSTOMER',
      party: hold.customer,
      sourceModel: 'RealEstatePropertyHold',
      sourceId: hold._id,
      narration: `Hold service fee ${hold.holdCode}`,
      custodyReference: custodyRef,
      metadata: {
        holdCode: hold.holdCode,
        custodySnapshot: snap.custodySnapshot || {},
        taxSnapshot: (snap.taxSnapshot && snap.taxSnapshot.holdServiceFee) || { inactive: true },
      },
    },
    session
  );

  hold.status = 'ACTIVE';
  hold.activatedAt = new Date();
  hold.ledgerPrincipal = principalEntry._id;
  hold.ledgerServiceFee = feeEntry._id;
  await hold.save(session ? { session } : {});
  // Phase C: fee invoice under an approved determination. Skipped while
  // the supply's tax is inactive (OD-04); failures are loud but never
  // roll back gateway-confirmed money.
  try {
    const invoiceService = require('./realestate.invoice.service');
    const policy = await policyService.getActive();
    if (policyService.getActiveTaxForSupply(policy, 'holdServiceFee')) {
      await invoiceService.issueInvoice(
        {
          supply: 'HOLD_SERVICE_FEE',
          buyerType: 'CUSTOMER',
          buyer: hold.customer,
          amountPaise: Math.round(Number(hold.serviceFee) * 100),
          sourceModel: 'RealEstatePropertyHold',
          sourceId: hold._id,
          ledgerEntry: feeEntry._id,
        },
        session
      );
    }
  } catch (e) {
    console.error(`hold fee invoice skipped for hold ${hold.holdCode}: ${e.message}`);
  }
  return hold;
}

/**
 * Forfeiture — the ONLY path where principal becomes revenue.
 * Dual control: requester ≠ approver, enforced here and asserted
 * by test (plan §6.2).
 */
function assertForfeitureDualControl(requestedBy, approvedBy) {
  if (!requestedBy || !approvedBy) throw new Error('Forfeiture requires requester and approver.');
  if (String(requestedBy) === String(approvedBy)) {
    throw new Error('Forfeiture dual control: requester and approver must be different admins.');
  }
}

/**
 * Hold on a vendor's property. The hold does not carry a `vendor`
 * field directly — it carries `property` and `customer`. A vendor
 * sees the holds on their own properties, which is a `property: { $in: ids }`
 * query.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {{ status?: string, page?: number, limit?: number }} opts
 * @returns {Promise<{ results: object[], total: number, page: number, limit: number }>}
 */
async function listForVendor(vendorId, { status, page = 1, limit = 20 } = {}) {
  if (!vendorId) return { results: [], total: 0, page, limit };
  const RealEstateProperty = require('../models/realestate.property.model');
  const propertyIds = await RealEstateProperty.find({ vendor: vendorId })
    .select('_id')
    .lean();
  const ids = propertyIds.map((p) => p._id);
  if (ids.length === 0) return { results: [], total: 0, page, limit };
  const filter = { property: { $in: ids } };
  if (status) filter.status = status;
  const [docs, total] = await Promise.all([
    RealEstatePropertyHold.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('customer', 'firstName lastName mobile')
      .populate('property', 'title propertyCode'),
    RealEstatePropertyHold.countDocuments(filter),
  ]);
  // Hydrated, not `.lean()` — `principal` / `serviceFee` / `total` are
  // moneyFields: a lean read ships paise (the 100x bug the money-edges
  // gate guards). `toObject({ getters: true })` returns rupees.
  const results = docs.map((d) => d.toObject({ getters: true }));
  return { results, total, page, limit };
}

const realEstateHoldService = {
  resolveDisposition,
  assertHoldTransition,
  assertForfeitureDualControl,
  createHold,
  activateHold,
  listForVendor,
};

module.exports = realEstateHoldService;
