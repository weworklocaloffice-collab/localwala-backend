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

const RealEstateReferral = require('../models/realestate.referral.model');

/**
 * Referral service — attribute a lead to a referrer code.
 * Payout (if OD-08 wallet credit) is computed in commission
 * service as % of LocalWala commission (BR-16), never sale value.
 */
async function attribute({ lead, referrer, code }) {
  return RealEstateReferral.create({ lead, referrer, code, status: 'PENDING' });
}

const realEstateReferralService = { attribute };

module.exports = realEstateReferralService;
