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
const { toJSON, paginate } = require('./plugins');

/**
 * A supervisor's quality review of one handled ticket.
 *
 * Kept in its own collection rather than embedded in the room: a team needs
 * hundreds of reviews per agent over a quarter, and embedding them would make
 * every ticket read drag a QA history it never uses.
 *
 * One review per (ticket, reviewer). Re-reviewing is allowed after deletion, so
 * the unique index is not on all three fields.
 */
const CRITERIA = ['accuracy', 'empathy', 'resolution', 'compliance'];

const supportQaReviewSchema = mongoose.Schema(
  {
    roomId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'SupportChatRoom',
      required: true,
    },
    // The agent being reviewed. Denormalised onto the review so per-agent
    // aggregation never has to join through the room, which may later be
    // reassigned or merged.
    agentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewerId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    // Each criterion is 1..5. A missing criterion is not a zero - it means the
    // reviewer did not assess it, and averaging a zero in would silently punish
    // the agent for a skipped question.
    scores: {
      accuracy: { type: Number, min: 1, max: 5, required: false },
      empathy: { type: Number, min: 1, max: 5, required: false },
      resolution: { type: Number, min: 1, max: 5, required: false },
      compliance: { type: Number, min: 1, max: 5, required: false },
    },
    // Overall is derived from `scores` rather than typed, so a reviewer cannot
    // contradict their own rubric.
    overall: {
      type: Number,
      min: 1,
      max: 5,
      required: false,
    },
    comment: { type: String, required: false, trim: true },
    // Why this ticket was sampled. Storing it keeps the sampling honest: a
    // team can see whether QA is actually reviewing hard cases or just the
    // easy ones.
    sampleReason: { type: String, required: false },
    // Snapshot of the ticket's CSAT at review time, so later changes to the
    // ticket do not rewrite history.
    csatAtReview: { type: Number, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

supportQaReviewSchema.plugin(toJSON);
supportQaReviewSchema.plugin(paginate);
supportQaReviewSchema.index({ roomId: 1, reviewerId: 1 }, { unique: true });
supportQaReviewSchema.index({ agentId: 1, createdAt: -1 });
// Backs the per-agent aggregation and the "who is behind on reviews" view.
supportQaReviewSchema.index({ agentId: 1, overall: -1 });

/**
 * @typedef SupportQaReview
 */
const SupportQaReview = mongoose.model('SupportQaReview', supportQaReviewSchema);

module.exports = SupportQaReview;
module.exports.CRITERIA = CRITERIA;