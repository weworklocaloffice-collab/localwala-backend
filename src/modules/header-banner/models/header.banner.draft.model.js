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

/**
 * Unpublished working copy of a header banner.
 *
 * Lives in its own collection so a draft can never be served to a customer,
 * even if the same logical banner is live. `headerBanner` is null while the
 * draft has never been published.
 */
const headerBannerDraftSchema = mongoose.Schema(
  {
    headerBanner: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'HeaderBanner',
      required: false,
      default: null,
    },
    campaignName: {
      type: String,
      required: false,
      trim: true,
    },
    // The unvalidated-by-schema working payload. Only `publish` runs it through
    // the Joi schema and the model.
    payload: {
      type: mongoose.SchemaTypes.Mixed,
      default: {},
    },
    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    updatedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

headerBannerDraftSchema.index({ headerBanner: 1 });
headerBannerDraftSchema.index({ updatedAt: -1 });

/**
 * @typedef HeaderBannerDraft
 */
const HeaderBannerDraft = mongoose.models.HeaderBannerDraft || mongoose.model('HeaderBannerDraft', headerBannerDraftSchema);

module.exports = HeaderBannerDraft;