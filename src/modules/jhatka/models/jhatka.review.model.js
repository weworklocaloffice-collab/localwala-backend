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
 * JhatkaReview — a customer rating after completion. §46.
 *
 * ## Two ratings, not one
 *
 * The blueprint's §46 says "rate outlet, rate product". They are different signals
 * and averaging them loses both: a customer who loved the cut and hated the delay
 * means one thing about the butcher and another about the rider, and an outlet
 * score that blends them tells the operator nothing actionable.
 *
 * ## Moderation does NOT delete
 *
 * `status: 'hidden'` with a reason, never removal. A review is a published
 * statement by a named customer; removing it because it is inconvenient is a
 * different business from the one this platform is.
 *
 * ## The freshness signal nobody records
 *
 * A review 40 minutes after delivery and one three weeks later are not the same
 * evidence. `elapsedMinutes` is stored so the outlet's rating can be weighted
 * toward recent experience without discarding the history.
 */
const REVIEW_STATUSES = ['published', 'hidden', 'flagged'];
const MODERATION_REASONS = [
  'abusive_language',
  'personal_information',
  'competitor_spam',
  'not_a_real_order',
  'duplicate',
  'irrelevant',
  'other',
];

const jhatkaReviewSchema = mongoose.Schema(
  {
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    /**
     * ONE review per order per customer. A customer cannot review the same
     * delivery twice, and the partial index below is what enforces it rather than
     * a service check that races.
     */
    outletRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    /**
     * The product rating, kept SEPARATE. See the header note.
     */
    productRating: {
      type: Number,
      required: false,
      min: 1,
      max: 5,
    },
    /**
     * Delivery quality, also separate. A complaint about arrival time is a
     * complaint about delivery, not about the meat.
     */
    deliveryRating: {
      type: Number,
      required: false,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator: (v) => v === undefined || typeof v === 'string' && v.length <= 2000,
        message: 'a review comment is capped at 2000 characters',
      },
    },
    /**
     * Minutes between delivery and review.
     *
     * A review forty minutes after the door and one three weeks later are not the
     * same evidence. Stored so the outlet's rating can lean on recent experience
     * without discarding history.
     */
    elapsedMinutes: {
      type: Number,
      required: false,
      min: 0,
    },
    /** Per-line ratings, for product analytics. */
    itemRatings: [
      {
        _id: false,
        orderItem: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaOrderItem',
          required: true,
        },
        variant: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaVariant',
          required: false,
          default: undefined,
        },
        rating: { type: Number, required: true, min: 1, max: 5 },
        comment: { type: String, required: false, trim: true },
      },
    ],
    /** The weight variance, copied. A complaint about weight belongs with the rating. */
    weightVariancePct: {
      type: Number,
      required: false,
      default: undefined,
    },
    status: {
      type: String,
      required: false,
      enum: REVIEW_STATUSES,
      default: 'published',
    },
    moderationReason: {
      type: String,
      required: false,
      enum: MODERATION_REASONS,
    },
    moderationNote: { type: String, required: false, trim: true },
    moderatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    moderatedByName: { type: String, required: false, trim: true },
    moderatedAt: { type: Date, required: false },
    helpfulCount: { type: Number, required: false, default: 0, min: 0 },
    /** The outlet's reply. One, not a thread. */
    reply: {
      text: { type: String, required: false, trim: true },
      repliedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      repliedByName: { type: String, required: false, trim: true },
      repliedAt: { type: Date, required: false },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaReviewSchema.plugin(toJSON);
jhatkaReviewSchema.plugin(paginate);
/**
 * ONE REVIEW PER ORDER. Partial-unique on `{order, customer}` where
 * `status: 'published'`.
 *
 * Partial because a hidden review that is later restored should not collide with a
 * fresh one, and because a moderator hiding a duplicate must not be blocked by the
 * original still existing.
 */
jhatkaReviewSchema.index(
  { order: 1, customer: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'published' },
    name: 'one_published_review_per_order_and_customer',
  }
);
// The outlet's review feed.
jhatkaReviewSchema.index({ outlet: 1, status: 1, createdAt: -1 });
// The moderation queue.
jhatkaReviewSchema.index({ status: 1, createdAt: -1 });
// The customer's history.
jhatkaReviewSchema.index({ customer: 1, createdAt: -1 });
// Product analytics.
jhatkaReviewSchema.index({ 'itemRatings.variant': 1, status: 1 });

jhatkaReviewSchema.statics.STATUSES = REVIEW_STATUSES;
jhatkaReviewSchema.statics.MODERATION_REASONS = MODERATION_REASONS;

/**
 * Is this review published to other customers?
 */
jhatkaReviewSchema.methods.isVisible = function () {
  return this.status === 'published';
};

/**
 * Was this written soon after the delivery?
 *
 * Under two hours, say. Not a filter — a signal the outlet's dashboard can show,
 * because a four-week-old review of a bad batch is history and a two-hour-old one is
 * a fact about today.
 */
jhatkaReviewSchema.methods.isFresh = function () {
  return this.elapsedMinutes !== undefined && this.elapsedMinutes <= 120;
};

/**
 * Does this review complain about the weight?
 *
 * A weight complaint on a review is a second channel for BR-21. The auto-refund
 * already happened; this says whether the customer noticed.
 */
jhatkaReviewSchema.methods.mentionsWeight = function () {
  if (this.weightVariancePct !== undefined && Math.abs(this.weightVariancePct) > 5) return true;
  const c = (this.comment || '').toLowerCase();
  return /\b(weight|heavy|light|short|less|more|quantity|qty|weigh)/.test(c);
};

/**
 * @typedef JhatkaReview
 */
const JhatkaReview = mongoose.model('JhatkaReview', jhatkaReviewSchema);

module.exports = JhatkaReview;