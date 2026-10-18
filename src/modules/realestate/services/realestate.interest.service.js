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

const RealEstateInterest = require('../models/realestate.interest.model');

/**
 * Interest service — structured interest only (BR-09).
 * Closed level + reason enums; `reason` required for NOT_INTERESTED
 * and MAYBE_FOLLOW_UP; OTHER requires `reasonText`. A change after
 * completion creates a new row with `supersedes`, never an edit.
 */
function validateInterest({ level, reason, reasonText }) {
  if (!level) throw new Error('Interest level is required (BR-09).');
  if ((level === 'NOT_INTERESTED' || level === 'MAYBE_FOLLOW_UP') && !reason) {
    throw new Error(`Reason is required for ${level} (BR-09).`);
  }
  if (reason === 'OTHER' && !reasonText) throw new Error('reasonText is required when reason is OTHER.');
}

async function record({ visit, lead, customer, executive, level, reason, reasonText = '', supersedes = null }) {
  validateInterest({ level, reason, reasonText });
  const doc = { visit, lead, customer, executive, level, recordedAt: new Date() };
  if (reason) doc.reason = reason;
  if (reasonText) doc.reasonText = reasonText;
  if (supersedes) doc.supersedes = supersedes;
  return RealEstateInterest.create(doc);
}

const realEstateInterestService = { validateInterest, record };

module.exports = realEstateInterestService;
