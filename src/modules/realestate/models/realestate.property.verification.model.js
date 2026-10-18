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
 * RealEstatePropertyVerification — one reviewer's decision on one submission.
 *
 * ## Why a record per review, not a `verifiedAt` on the property
 *
 * Blueprint §47 asks the admin to record reviewer, timestamp, checklist, comments,
 * documents checked and decision. A property can be rejected and resubmitted any
 * number of times, and each attempt needs its own answer.
 *
 * Storing the latest verdict on the property loses the rest. Then the only record of
 * why a listing was rejected three times is the vendor's own memory, and a dispute
 * about whether a document was ever checked becomes unresolvable.
 *
 * So: the property carries `verifiedAt` / `verifiedBy` for fast reads, and every
 * review writes a row here. Nothing in this collection is ever updated except to close
 * an open review.
 *
 * ## The checklist is a snapshot, not a live join
 *
 * `checklist[]` copies the items and their outcome into the review row. If the template
 * gains an item next month, last quarter's review still shows the list that was
 * actually worked through — which is the only version that means anything.
 */
const realEstatePropertyVerificationSchema = mongoose.Schema(
  {
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    /**
     * How many times this property has been through review, 1-based.
     *
     * The reviewer needs to see "3rd attempt" at a glance; a rejected listing that
     * keeps failing the same check is a different conversation from a first attempt.
     */
    attempt: {
      type: Number,
      required: true,
      min: 1,
    },

    /**
     * Blueprint §47's four gates, in order.
     *
     * `DOCUMENT_CHECK`  the paperwork exists, is legible and matches the listing
     * `LOCATION_CHECK`  the pin matches the stated address, and the property is real
     * `DETAILS_CHECK`   the specs match the category schema and are not copy-paste
     * `VENDOR_CHECK`    the vendor is verified and entitled to list
     */
    stage: {
      type: String,
      required: true,
      default: 'DOCUMENT_CHECK',
      enum: ['DOCUMENT_CHECK', 'LOCATION_CHECK', 'DETAILS_CHECK', 'VENDOR_CHECK'],
    },

    /**
     * The item-by-item result. Snapshotted — see the class doc.
     */
    checklist: {
      type: Array,
      default: undefined,
    },

    /**
     * Blueprint §47's three outcomes.
     *
     * `CHANGES_REQUIRED` is the one that needs a comment: telling a vendor "changes
     * required" with no list of what to change guarantees the same submission comes
     * straight back.
     */
    decision: {
      type: String,
      required: false,
      enum: ['APPROVED', 'CHANGES_REQUIRED', 'REJECTED'],
    },

    comments: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * What the reviewer must fix, as a list.
     *
     * Separate from `comments` because this is what the vendor app renders as a
     * checklist, and what the resubmission path compares against to decide whether
     * anything actually changed.
     */
    changeRequests: {
      type: Array,
      default: undefined,
    },

    /** Which document ids were inspected. Blueprint §47 asks for this explicitly. */
    documentsChecked: {
      type: [
        {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'RealEstatePropertyDocument',
        },
      ],
      required: false,
      default: undefined,
    },

    /**
     * The property state as the reviewer saw it.
     *
     * A later edit to the listing must not retroactively change what was approved.
     * Blueprint §48's "documents checked" is meaningless without the subject that was
     * checked.
     */
    subjectSnapshot: {
      type: Object,
      required: false,
    },

    reviewer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    openedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    decidedAt: {
      type: Date,
      required: false,
    },

    /**
     * Whether the review is still open.
     *
     * Explicit rather than inferred from `decision`, so a review opened and abandoned
     * by a reviewer who went on leave is still visible in the queue.
     */
    open: {
      type: Boolean,
      required: false,
      default: true,
    },

    /**
     * The previous attempt, so the chain is walkable.
     *
     * Set when a `CHANGES_REQUIRED` or `REJECTED` review is closed and the vendor
     * resubmits.
     */
    supersedes: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstatePropertyVerification',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstatePropertyVerificationSchema.plugin(toJSON);
realEstatePropertyVerificationSchema.plugin(paginate);

/**
 * The review queue: open reviews, oldest first, so nothing sits at the back.
 */
realEstatePropertyVerificationSchema.index({ open: 1, openedAt: 1 });

/**
 * One open review per property.
 *
 * The same guard as the active-hold index, for the same reason: two reviewers working
 * the same submission concurrently means two conflicting decisions, and whichever
 * writes last wins silently.
 */
realEstatePropertyVerificationSchema.index(
  { property: 1 },
  { unique: true, partialFilterExpression: { open: true }, name: 'one_open_review_per_property' }
);

/**
 * Full history for a property, newest first — what the admin and the vendor both read
 * when a listing has bounced.
 */
realEstatePropertyVerificationSchema.index({ property: 1, attempt: -1 });

/**
 * "Which properties did this reviewer look at", for a workload or quality audit.
 */
realEstatePropertyVerificationSchema.index({ reviewer: 1, decidedAt: -1 });

/**
 * Decision reporting across the queue.
 */
realEstatePropertyVerificationSchema.index({ decision: 1, decidedAt: -1 }, { sparse: true });

/**
 * @typedef RealEstatePropertyVerification
 */
const RealEstatePropertyVerification = mongoose.model(
  'RealEstatePropertyVerification',
  realEstatePropertyVerificationSchema
);

module.exports = RealEstatePropertyVerification;
