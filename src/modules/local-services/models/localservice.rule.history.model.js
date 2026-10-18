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
 * LocalServiceRuleHistory — every revenue-rule transition audited.
 * Who moved what, when, with what note. Append-only.
 */
const localServiceRuleHistorySchema = mongoose.Schema(
  {
    rule: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceRevenueRule', required: true },
    from: { type: String, required: false },
    to: { type: String, required: true },
    actor: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    note: { type: String, required: false, trim: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceRuleHistorySchema.plugin(toJSON);
localServiceRuleHistorySchema.plugin(paginate);
localServiceRuleHistorySchema.index({ rule: 1, createdAt: 1 });

const LocalServiceRuleHistory = mongoose.model('LocalServiceRuleHistory', localServiceRuleHistorySchema);

module.exports = LocalServiceRuleHistory;
