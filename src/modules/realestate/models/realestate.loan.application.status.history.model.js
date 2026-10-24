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
 * RealEstateLoanApplicationStatusHistory — one row per loan transition.
 *
 * ## Why this exists
 *
 * The loan application model keeps only the LATEST state: `status`,
 * `sanctionedAt`, `disbursedAt`, `rejectedAt`, `rejectionReason`. That
 * answers "where is this application now?" and nothing else.
 *
 * The bank portal is a desk job (plan §13.1): a loan officer opening an
 * application has to answer "what happened to this file, and when?" —
 * was it rejected and re-created, was it moved to review and left there,
 * who moved it and why. Without a history the portal can only show the
 * current status, and the `dialog-application-status` screen has nothing
 * to render.
 *
 * ## Why it is a collection and not an array on the application
 *
 * An embedded array would grow inside the application document and be
 * rewritten on every transition. A separate append-only collection is
 * indexed on `{ application, createdAt }`, so the timeline is one indexed
 * range scan and the application document stays small.
 *
 * ## The actor
 *
 * `actorType` mirrors the actor vocabulary used by the loan service
 * (`customer` / `bank` / `admin` / `system`). `actor` is the User behind
 * the session - a bank member for a bank action, the customer for the
 * offer acceptance.
 */
const realEstateLoanApplicationStatusHistorySchema = mongoose.Schema(
  {
    application: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLoanApplication',
      required: true,
    },

    /** The state the application left. Absent for the first row. */
    from: { type: String, required: false, trim: true },

    /** The state the application entered. */
    to: { type: String, required: true, trim: true },

    actorType: {
      type: String,
      required: false,
      enum: ['CUSTOMER', 'VENDOR', 'EXECUTIVE', 'BANK', 'ADMIN', 'SYSTEM'],
    },

    /** The User behind the session that moved the application. */
    actor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },

    /** Why the application moved - a rejection reason, a document note. */
    reason: { type: String, required: false, trim: true },

    /** Free-text detail the actor attached to the transition. */
    note: { type: String, required: false, trim: true },

    /** Money attached to a money-bearing transition (sanction / disbursement). */
    amount: { type: Number, required: false, default: undefined },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

realEstateLoanApplicationStatusHistorySchema.plugin(toJSON);
realEstateLoanApplicationStatusHistorySchema.plugin(paginate);

realEstateLoanApplicationStatusHistorySchema.index({ application: 1, createdAt: 1 });

/**
 * @typedef RealEstateLoanApplicationStatusHistory
 */
const RealEstateLoanApplicationStatusHistory = mongoose.model(
  'RealEstateLoanApplicationStatusHistory',
  realEstateLoanApplicationStatusHistorySchema
);

module.exports = RealEstateLoanApplicationStatusHistory;
