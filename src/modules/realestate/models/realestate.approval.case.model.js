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
 * RealEstateApprovalCase — the evidence trail for OD-01/OD-04 governance.
 *
 * A status flip on a config document is an *effect*, never the decision
 * itself. The decision lives here: who requested what change (diff),
 * who approved or rejected it and why, which documents evidenced it,
 * and when the SLA expired it. Segregation of duties is enforced in
 * the service, not in comments:
 *   requester ≠ approver, approver ≠ activator, requester ≠ activator.
 * Three distinct people from request to activation.
 *
 * v1 covers HOLD_POLICY versions (custody + tax travel on the policy).
 * The target is generic (targetModel/targetId/detail) so bank
 * agreements and commission rules can mount later without a migration.
 */
const approvalCommentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const realEstateApprovalCaseSchema = mongoose.Schema(
  {
    caseNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    category: {
      type: String,
      required: true,
      enum: ['HOLD_POLICY', 'BANK_AGREEMENT', 'COMMISSION_RULE', 'TAX_CONFIG', 'CUSTODY_CONFIG'],
    },

    targetModel: { type: String, required: true, trim: true },
    targetId: { type: mongoose.SchemaTypes.ObjectId, required: true },
    // Free-form qualifier, e.g. tax supply key or policy version.
    detail: { type: String, required: false, trim: true },

    // Frozen before/after at request time — the approver reviews the
    // diff, never the live document (which may have moved since).
    diffBefore: { type: mongoose.SchemaTypes.Mixed, required: false, default: {} },
    diffAfter: { type: mongoose.SchemaTypes.Mixed, required: false, default: {} },

    requester: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, default: Date.now },
    changeReason: { type: String, required: false, trim: true },
    supportingDocuments: { type: [String], default: [] },

    approver: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    decidedAt: { type: Date, required: false },
    decisionNote: { type: String, required: false, trim: true },
    approvalReference: { type: String, required: false, trim: true },

    status: {
      type: String,
      required: true,
      default: 'REQUESTED',
      enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'ACTIVATED'],
    },

    slaDue: { type: Date, required: false },

    comments: { type: [approvalCommentSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateApprovalCaseSchema.plugin(toJSON);
realEstateApprovalCaseSchema.plugin(paginate);

realEstateApprovalCaseSchema.index({ caseNo: 1 }, { unique: true });
// One open case per target — a second request while one is pending is
// a duplicate, not a queue. `detail` is part of the key so the four
// per-supply TAX_CONFIG cases (detail `tax:<supplyKey>`) on one policy
// do not block each other; each supply still gets at most one open case.
realEstateApprovalCaseSchema.index(
  { category: 1, targetId: 1, detail: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['REQUESTED'] } },
    name: 'one_open_case_per_target',
  }
);
realEstateApprovalCaseSchema.index({ status: 1, slaDue: 1 });
realEstateApprovalCaseSchema.index({ requester: 1, createdAt: -1 });

/**
 * @typedef RealEstateApprovalCase
 */
const RealEstateApprovalCase = mongoose.model('RealEstateApprovalCase', realEstateApprovalCaseSchema);

module.exports = RealEstateApprovalCase;
