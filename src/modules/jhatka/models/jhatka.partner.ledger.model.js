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

const mongoose = require('mongoose');
const toJSON = require('../../../models/plugins/tojson.plugin');

/**
 * JhatkaPartnerLedger — the partner/franchisee account record.
 *
 * ## What this ledger is for
 *
 * One append-only account per (outlet) carrying every B2B money movement that is
 * NOT a customer transaction: prepayments for stock in, stock debits out,
 * refund credits, payout nettings, manual adjustments. The "prepaid balance
 * that stays in the record" and the outstanding-supply-balance that gates
 * deduct-mode both read from here.
 *
 * ## Invariants
 *
 * 1. APPEND-ONLY. No update path exists for money fields; a correction is a new
 *    entry referencing the old one (BR-19 discipline — every movement is a
 *    document). Nothing here is ever deleted.
 * 2. `balanceAfter` is written by the ledger service, computed in JavaScript
 *    from the previous entry — never an aggregation, never `$inc` (F-9).
 *    Amounts are PAISE integers internally (`amountPaise`), signed from the
 *    partner's perspective: positive = partner's credit grows (they paid us /
 *    we refunded / we netted a payout to them), negative = their balance drops
 *    (stock delivered to them / royalty charged).
 * 3. Sequential per outlet: `{ outlet: 1, seq: 1 }` unique — the service
 *    allocates `seq` under the request's transaction so two concurrent writers
 *    cannot fork the chain.
 * 4. Every entry names its reference (a JhatkaSupplyRequest, a PaymentInitiation,
 *    a JhatkaOperatorPayout, or an admin adjustment note), so "why did this
 *    balance move" is always answerable by eye.
 */
const jhatkaPartnerLedgerSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
      index: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    seq: {
      type: Number,
      required: true,
      min: 1,
    },
    /** Signed paise, partner's perspective. Positive = credit in; negative = debit out. */
    amountPaise: {
      type: Number,
      required: true,
    },
    balanceAfterPaise: {
      type: Number,
      required: true,
    },
    entryType: {
      type: String,
      required: true,
      enum: [
        'PREPAYMENT',        // partner paid for stock up front (gateway/offline)
        'STOCK_DEBIT',       // supply request fulfilled — meat value out
        'REFUND_CREDIT',     // cancelled/under-delivered request credited back
        'COLLECTION',        // on-delivery cash collected at the partner's door
        'PAYOUT_NETTING',    // weekly payout swept the outstanding balance
        'ADJUSTMENT',        // admin correction, reason REQUIRED
      ],
      index: true,
    },
    referenceType: {
      type: String,
      required: true,
      enum: [
        'JhatkaSupplyRequest',
        'PaymentInitiation',
        'JhatkaOperatorPayout',
        'AdminAdjustment',
      ],
    },
    referenceId: {
      type: mongoose.SchemaTypes.ObjectId,
      required: true,
    },
    referenceNo: { type: String, required: false, trim: true },
    /** REQUIRED for ADJUSTMENT; optional context otherwise. */
    note: { type: String, required: false, trim: true, maxlength: 500 },
    performedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    performedByName: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

jhatkaPartnerLedgerSchema.plugin(toJSON);

// The chain: one sequence per outlet, so balanceAfter replays deterministically.
jhatkaPartnerLedgerSchema.index({ outlet: 1, seq: 1 }, { unique: true });
// "What moved for this reference?" — the reverse lookup.
jhatkaPartnerLedgerSchema.index({ referenceType: 1, referenceId: 1 });
// Ledger sweeps read newest-first per outlet.
jhatkaPartnerLedgerSchema.index({ outlet: 1, createdAt: -1 });

/**
 * The partner's current balance in PAISE (positive = prepaid credit standing;
 * negative = outstanding amount owed to LocalWala). Pure — reads a value the
 * service maintains, so a display can never disagree with the chain.
 */
jhatkaPartnerLedgerSchema.statics.balanceOfLastEntry = function (lastEntry) {
  return lastEntry ? Number(lastEntry.balanceAfterPaise || 0) : 0;
};

const JhatkaPartnerLedger = mongoose.model(
  'JhatkaPartnerLedger',
  jhatkaPartnerLedgerSchema
);

module.exports = JhatkaPartnerLedger;
