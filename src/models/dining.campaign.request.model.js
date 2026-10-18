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

const diningCampaignRequestSchema = mongoose.Schema(
  {
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    campaign: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DiningCampaign',
      required: true,
    },
    status: {
      type: String,
      default: 'requested',
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
diningCampaignRequestSchema.plugin(toJSON);
diningCampaignRequestSchema.plugin(paginate);

/**
 * @typedef DiningCampaignRequest
 */
const DiningCampaignRequest = mongoose.model('DiningCampaignRequest', diningCampaignRequestSchema);

module.exports = DiningCampaignRequest;

