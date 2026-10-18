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
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * DairyProviderPayable — what the platform owes one milk provider for a period.
 *
 * ## Why this exists when `DairyMilkCollection` already tracks `payableStatus`
 *
 * Because a live aggregate cannot be a statement. Recomputing "what do we owe this
 * provider" from the collections means the answer changes underneath you: a rate
 * change, a late QC decision, or a shrinkage entry recorded after the fact all
 * silently restate a figure the provider has already been shown, or already paid.
 *
 * This document **freezes** the collections it covers and the amount they came to.
 * Once generated, the number is a fact about the past rather than a function of
 * the present, and the collections it covers are marked settled so they cannot be
 * claimed by a second statement.
 *
 * ## Sign convention
 *
 * `netAmount` is **positive when the platform owes the provider** — the same way a
 * commission partner's statement is positive when the platform owes them. Money
 * flowing out of the platform is positive on both documents, which keeps a reader
 * from having to remember which side of each statement they are on.
 *
 * ## Lifecycle
 *
 *   draft → approved → paid
 *     ↘ disputed → approved
 *     ↘ void
 *
 * `paid` is terminal. Paying is what settles the underlying collections, so a
 * second payment would be a real double payment rather than a bookkeeping slip.
 */
const dairyProviderPayableSchema = mongoose.Schema(
  {
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    provider: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyMilkProvider',
      required: true,
    },
    /** Human-facing reference, e.g. `PP-2026-0007`. */
    payableNo: {
      type: String,
      required: false,
    },
    period: {
      from: {
        type: Date,
        required: true,
      },
      to: {
        type: Date,
        required: true,
      },
      label: {
        type: String,
        required: false,
      },
    },
    totals: {
      /** Collections covered by this statement. */
      collectionCount: {
        type: Number,
        required: false,
        default: 0,
      },
      litres: {
        type: Number,
        required: false,
        default: 0,
      },
      grossAmount: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      /** Deductions, positive numbers. See `adjustments`. */
      adjustmentsTotal: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      /** `grossAmount - adjustmentsTotal`. Positive: the platform owes this. */
      netAmount: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      amountPaid: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
    },
    /**
     * The collections this statement covers, frozen at generation.
     *
     * Keeping the refs is what makes the statement auditable — a provider disputing
     * a figure can be shown exactly which intakes it was built from — and it is
     * what stops those collections being claimed again.
     */
    collections: [
      {
        /**
         * Named `intake`, not `collection`: Mongoose reserves `collection` as a
         * schema pathname and warns that it may break functionality. The warning
         * is not cosmetic — the field is read by aggregation and by the settle
         * query, so it is renamed rather than suppressed.
         */
        intake: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'DairyMilkCollection',
          required: true,
        },
        /** Snapshot of the intake's own reference, for the statement's audit trail. */
        collectionNo: {
          type: Number,
          required: false,
        },
        collectedAt: {
          type: Date,
          required: false,
        },
        quantityL: {
          type: Number,
          required: false,
          default: 0,
        },
        /** Rate applied to this intake at the time of the statement. */
        ratePerLitre: {
          type: Number,
          required: false,
          get: (v) => Number((v / 100).toFixed(2)),
          set: (v) => Math.round(v * 100),
          default: 0,
        },
        amount: {
          type: Number,
          required: false,
          get: (v) => Number((v / 100).toFixed(2)),
          set: (v) => Math.round(v * 100),
          default: 0,
        },
      },
    ],
    /**
     * Deductions applied to this statement, with a reason each.
     *
     * Deductions live here rather than being silently netted off, because a
     * provider is entitled to see what was taken off and why.
     */
    adjustments: [
      {
        amount: {
          type: Number,
          required: true,
          get: (v) => Number((v / 100).toFixed(2)),
          set: (v) => Math.round(v * 100),
        },
        reason: {
          type: String,
          required: true,
          trim: true,
        },
        recordedBy: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'User',
          required: false,
        },
        recordedAt: {
          type: Date,
          required: false,
          default: Date.now,
        },
      },
    ],
    status: {
      type: String,
      required: false,
      default: 'draft', // draft | approved | paid | disputed | void
    },
    statusReason: {
      type: String,
      required: false,
    },
    approvedAt: {
      type: Date,
      required: false,
    },
    approvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    paidAt: {
      type: Date,
      required: false,
    },
    /** Bank or cash reference for the payment. */
    paymentReference: {
      type: String,
      required: false,
    },
    payoutMethod: {
      type: String,
      required: false,
      default: 'bank', // bank | cash
    },
    notes: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

dairyProviderPayableSchema.plugin(toJSON);
dairyProviderPayableSchema.plugin(paginate);
// One statement per provider per period start, so a retried generation cannot
// produce two statements for the same money.
dairyProviderPayableSchema.index({ provider: 1, 'period.from': 1 }, { unique: true });
dairyProviderPayableSchema.index({ business: 1, status: 1, 'period.from': -1 });
// The payment run queue.
dairyProviderPayableSchema.index({ status: 1, 'period.to': 1 });

/**
 * @typedef DairyProviderPayable
 */
const DairyProviderPayable = mongoose.model(
  'DairyProviderPayable',
  dairyProviderPayableSchema
);

module.exports = DairyProviderPayable;
