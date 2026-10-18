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

const RealEstateBankMember = require('../models/realestate.bank.member.model');

/**
 * Bank auth — resolves the bank member from the token user.
 *
 * Sets `req.bankId` (RealEstateBank) and `req.bankMemberId`. Any
 * signed-in user without an ACTIVE bank membership gets 403 — not
 * an empty object. No bank id ever comes from the URL (plan §7.1).
 */
async function bankAuth(req, res, next) {
  try {
    const userId = req.user ? req.user.id || req.user._id : null;
    if (!userId) return res.status(401).send({ message: 'Authentication required' });
    const member = await RealEstateBankMember.findOne({ user: userId, status: 'ACTIVE' });
    if (!member) return res.status(403).send({ message: 'Bank membership required' });
    req.bankId = member.bank;
    req.bankMemberId = member._id;
    req.actorType = 'bank';
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = bankAuth;
