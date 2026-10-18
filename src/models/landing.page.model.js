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
const { toJSON } = require('./plugins');

const landingPageSchema = mongoose.Schema(
  {
    heroContent: {
      type: Object,
      required: false,
    },
    appFeatureContent: {
      type: Object,
      required: false,
    },
    featureContent: {
      type: Object,
      required: false,
    },
    serviceContent: {
      type: Object,
      required: false,
    },
    faqContent: {
      type: Object,
      required: false,
    },
    reviewContent: {
      type: Object,
      required: false,
    },
    scanQrContent: {
      type: Object,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
landingPageSchema.plugin(toJSON);

/**
 * @typedef LandingPage
 */
const LandingPage = mongoose.model('LandingPage', landingPageSchema);

module.exports = LandingPage;

