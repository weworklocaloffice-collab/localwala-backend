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
const toJSON = require('../../../models/plugins/toJSON.plugin');

/**
 * JhatkaSupplyRequest — a partner/franchisee asking LocalWala for stock.
 *
 * ## Where this sits in the MoR model
 *
 * LocalWala supplies the meat (BR-05). This document is the PULL half of that
 * supply: the partner picks catalogue items and quantities, an admin approves
 * (a credit decision as much as a stock one), fulfilment posts a procurement
 * receipt at the partner's outlet (supplier = LocalWala), and the goods value
 * settles through JhatkaPartnerLedger by the request's paymentMode.
 *
 * ## Lifecycle
 *
 *   requested → approved → fulfilled → settled
 *        ↘ rejected        ↘ cancelled (by partner before approval, by admin after)
 *
 *   - `approved` freezes the rate per line (BR-26 spirit: the price the partner
 *     was approved at never restates).
 *   - `fulfilled` means the receipt is POSTED — stock exists at the outlet and
 *     the ledger debit is written. These two facts are one transaction.
 *   - `settled` means the goods value has been fully recovered (prepaid at
 *     request time, swept from a payout, or collected on delivery). Until then
 *     the request contributes to the outlet's outstanding balance.
 *
 * ## Payment modes and eligibility
 *
 *   prepaid      — money on the ledger before fulfilment; fulfilment debits it.
 *   on_delivery  — collected when the stock arrives; value sits outstanding
 *                  until the ledger records the collection.
 *   deduct       — swept from a future payout. ELIGIBILITY IS EARNED: only
 *                  offered when the outlet has at least one PAID operator
 *                  payout (settlement history) and its outstanding balance
 *                  plus this request's value stays under the platform credit
 *                  cap. The server computes eligibility; the UI only renders it.
 *
 * Nothing here is ever hard-deleted (BR-23): a discarded request is
 * `cancelled` with a reason.
 */
const jhatkaSupplyRequestSchema = mongoose.Schema(
  {
    requestNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
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
    /** Denormalised for hot filters (§6.2 convention). */
    businessModel: {
      type: String,
      required: true,
      enum: ['direct', 'franchise', 'commission_partner'],
    },
    requestedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    requestedByName: { type: String, required: false, trim: true },

    items: [
      {
        _id: false,
        product: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaProduct',
          required: true,
        },
        productName: { type: String, required: true, trim: true },
        rawSku: { type: String, required: false, trim: true },
        quantity: {
          value: { type: Number, required: true, min: 0.001 },
          unit: { type: String, required: true, enum: ['KG', 'GRAM', 'PIECE', 'TRAY'] },
        },
        /** Frozen at APPROVAL — the transfer price the partner was approved at. */
        ratePaisePerUnit: { type: Number, required: false, min: 0 },
        lineValuePaise: { type: Number, required: false, min: 0 },
        /** Fulfilment may deliver less than approved; the shortfall is explicit. */
        fulfilledQuantity: { value: { type: Number, required: false }, unit: { type: String, required: false } },
      },
    ],

    neededBy: { type: Date, required: false },
    note: { type: String, required: false, trim: true, maxlength: 500 },

    paymentMode: {
      type: String,
      required: true,
      enum: ['prepaid', 'on_delivery', 'deduct'],
    },
    /** Total value at approval — paise. Frozen; fulfilment shortfall narrows the DEBIT, never this. */
    approvedValuePaise: { type: Number, required: false, min: 0 },

    payment: {
      /** prepaid: 'pending' → 'paid' via a verified gateway callback. */
      status: {
        type: String,
        required: false,
        enum: ['pending', 'paid', 'not_applicable'],
        default: 'pending',
      },
      initiation: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'PaymentInitiation',
        required: false,
      },
      gatewayPaymentId: { type: String, required: false, trim: true },
      paidAt: { type: Date, required: false },
      paidAmountPaise: { type: Number, required: false, min: 0 },
    },

    status: {
      type: String,
      required: true,
      enum: ['requested', 'approved', 'rejected', 'cancelled', 'fulfilled', 'settled'],
      default: 'requested',
      index: true,
    },
    statusReason: { type: String, required: false, trim: true, maxlength: 500 },

    approval: {
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      byName: { type: String, required: false, trim: true },
      at: { type: Date, required: false },
      note: { type: String, required: false, trim: true },
    },

    fulfilment: {
      /** The draft procurement receipt this request became. */
      receipt: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'JhatkaProcurementReceipt',
        required: false,
      },
      receiptNo: { type: String, required: false, trim: true },
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      byName: { type: String, required: false, trim: true },
      at: { type: Date, required: false },
      /** Total actually delivered — paise (may be less than approvedValuePaise). */
      deliveredValuePaise: { type: Number, required: false, min: 0 },
    },

    /** Ledger entries written for this request (prepayment credit, stock debit, refund). */
    ledgerEntries: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'JhatkaPartnerLedger',
      },
    ],

    /** Settled = goods value fully recovered. Set by the ledger/payout sweep. */
    settledAt: { type: Date, required: false },
    settledVia: {
      type: String,
      required: false,
      enum: ['prepaid', 'payout_sweep', 'on_delivery_collection'],
    },

    cancelledBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    cancelledByName: { type: String, required: false, trim: true },
    cancelledAt: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

jhatkaSupplyRequestSchema.plugin(toJSON);

jhatkaSupplyRequestSchema.index({ outlet: 1, status: 1, createdAt: -1 });
jhatkaSupplyRequestSchema.index({ status: 1, neededBy: 1 });
jhatkaSupplyRequestSchema.index({ business: 1, createdAt: -1 });

/** Transitions the service allow-lists a second time (§0.0 convention). */
const SUPPLY_REQUEST_TRANSITIONS = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['fulfilled', 'cancelled'],
  fulfilled: ['settled'],
  settled: [],
  rejected: [],
  cancelled: [],
};

jhatkaSupplyRequestSchema.statics.SUPPLY_REQUEST_TRANSITIONS = SUPPLY_REQUEST_TRANSITIONS;
jhatkaSupplyRequestSchema.statics.canTransition = function (from, to) {
  return (SUPPLY_REQUEST_TRANSITIONS[from] || []).includes(to);
};

/** Value outstanding to LocalWala for THIS request, in paise. Pure. */
jhatkaSupplyRequestSchema.methods.outstandingPaise = function () {
  if (this.status !== 'fulfilled') return 0;
  if (this.paymentMode === 'prepaid' && this.payment?.status === 'paid') return 0;
  if (this.settledAt) return 0;
  const delivered = Number(this.fulfilment?.deliveredValuePaise || 0);
  const prepaidApplied = this.paymentMode === 'prepaid'
    ? Math.min(delivered, Number(this.payment?.paidAmountPaise || 0))
    : 0;
  return Math.max(0, delivered - prepaidApplied);
};

const JhatkaSupplyRequest = mongoose.model(
  'JhatkaSupplyRequest',
  jhatkaSupplyRequestSchema
);

module.exports = JhatkaSupplyRequest;
