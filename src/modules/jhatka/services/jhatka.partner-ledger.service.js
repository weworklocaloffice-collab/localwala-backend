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

/**
 * jhatka.partner-ledger.service.js — the ONLY writer of JhatkaPartnerLedger.
 *
 * ## Why a single writer matters
 *
 * Every balance in this vertical is money, and the F-9 rule is that money is
 * computed in JavaScript and written through the model — never aggregated,
 * never `$inc`-ed. The ledger is no exception: `postEntry` reads the outlet's
 * last entry, adds the signed amount in JS, and writes the next chain node with
 * the resulting `balanceAfterPaise`. Two concurrent writers cannot fork the
 * chain because `seq` is allocated from `max+1` INSIDE the caller's session and
 * the `{outlet, seq}` unique index rejects any race at the database.
 *
 * ## What callers may do
 *
 *   postEntry   — one signed movement (the five entry types on the model)
 *   getBalance  — the outlet's current balance (paise; positive = prepaid
 *                 credit standing, negative = owed)
 *   computeDeductEligibility — whether "deduct from payout" may be offered for
 *                 a request of a given value: earned by settlement history and
 *                 bounded by the platform credit cap.
 *
 * Nothing here deletes. A wrong entry is corrected by a new entry.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/**
 * Append one entry to the outlet's ledger and return it.
 *
 * MUST be called inside the caller's transaction session when the movement is
 * part of a multi-document operation (fulfilment = receipt + debit in ONE
 * transaction — a stock delivery without its ledger debit is exactly the
 * half-written state this vertical exists to prevent).
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaPartnerLedger }`
 * @param {mongoose.ClientSession} [p.session]
 * @param {string} p.outletId
 * @param {string} p.businessId
 * @param {string} p.entryType   one of the model's enum
 * @param {number} p.amountPaise signed, partner's perspective
 * @param {string} p.referenceType
 * @param {string} p.referenceId
 * @param {string} [p.referenceNo]
 * @param {string} [p.note]
 * @param {object} [p.actor]     `{ _id, name }`
 * @returns {Promise<object>} the persisted entry
 */
async function postEntry({
  models, session, outletId, businessId, entryType, amountPaise,
  referenceType, referenceId, referenceNo, note, actor,
}) {
  const { JhatkaPartnerLedger } = models;
  const amount = Math.round(Number(amountPaise) || 0);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Ledger amount must be a non-zero integer of paise');
  }
  if (entryType === 'ADJUSTMENT' && !note) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'An ADJUSTMENT entry requires a note');
  }

  const last = await JhatkaPartnerLedger.findOne({ outlet: outletId })
    .sort({ seq: -1 })
    .select('seq balanceAfterPaise')
    .session(session || null)
    .lean();

  const seq = (last?.seq || 0) + 1;
  const balanceAfterPaise = (last?.balanceAfterPaise || 0) + amount;

  const entry = await JhatkaPartnerLedger.create(
    [
      {
        outlet: outletId,
        business: businessId,
        seq,
        entryType,
        amountPaise: amount,
        balanceAfterPaise,
        referenceType,
        referenceId,
        referenceNo: referenceNo || undefined,
        note: note || undefined,
        performedBy: actor?._id,
        performedByName: actor?.name,
      },
    ],
    { session: session || undefined }
  );

  return Array.isArray(entry) ? entry[0] : entry;
}

/**
 * The outlet's current ledger balance, in PAISE.
 * Positive = prepaid credit standing. Negative = owed to LocalWala.
 */
async function getBalance({ models, outletId }) {
  const last = await models.JhatkaPartnerLedger.findOne({ outlet: outletId })
    .sort({ seq: -1 })
    .select('balanceAfterPaise')
    .lean();
  return last ? Number(last.balanceAfterPaise || 0) : 0;
}

/**
 * May "deduct from payout" be offered for a request of `requestValuePaise`?
 *
 * Two gates, both checkable and dispute-proof (no earnings forecasting):
 *   1. HISTORY — the outlet has at least one PAID operator payout. A partner
 *      with no settlement record has no deduction base; they prepay.
 *   2. CAP — (already-outstanding supply value + this request) must stay under
 *      the platform credit cap. Outstanding = fulfilled-but-unsettled requests,
 *      computed from the requests themselves (the source of truth for "supplied
 *      but not recovered"), never from a ledger aggregation (F-9).
 *
 * @param {object} p
 * @param {object} p.models      `{ JhatkaOperatorPayout, JhatkaSupplyRequest }`
 * @param {string} p.outletId
 * @param {number} p.requestValuePaise
 * @param {number} p.creditCapPaise  platform cap (from JhatkaSettings)
 * @returns {Promise<{eligible: boolean, outstandingPaise: number, reasons: string[]}>}
 */
async function computeDeductEligibility({ models, outletId, requestValuePaise, creditCapPaise }) {
  const { JhatkaOperatorPayout, JhatkaSupplyRequest } = models;
  const reasons = [];

  const settled = await JhatkaOperatorPayout.countDocuments({
    outlet: outletId,
    status: 'paid',
  }).lean();
  if (settled === 0) reasons.push('NO_SETTLED_PAYOUT_HISTORY');

  const openRequests = await JhatkaSupplyRequest.find({
    outlet: outletId,
    status: 'fulfilled',
    // Mongo `null` matches both missing and null — fulfilled and not yet settled.
    settledAt: null,
  })
    .select('fulfilment.deliveredValuePaise payment.status paymentMode payment.paidAmountPaise')
    .lean();

  // The model's own outstandingPaise() is the authority; lean docs need the
  // same arithmetic inline (lean carries no methods).
  const outstandingPaise = openRequests.reduce((sum, r) => {
    if (r.paymentMode === 'prepaid' && r.payment?.status === 'paid') return sum;
    const delivered = Number(r.fulfilment?.deliveredValuePaise || 0);
    const prepaidApplied = r.paymentMode === 'prepaid'
      ? Math.min(delivered, Number(r.payment?.paidAmountPaise || 0))
      : 0;
    return sum + Math.max(0, delivered - prepaidApplied);
  }, 0);

  if (outstandingPaise + requestValuePaise > creditCapPaise) {
    reasons.push('CREDIT_CAP_EXCEEDED');
  }

  return { eligible: reasons.length === 0, outstandingPaise, reasons };
}

module.exports = { postEntry, getBalance, computeDeductEligibility };
