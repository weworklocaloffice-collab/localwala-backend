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

const { GuestUserInfo } = require('../models');

const checkRegister = async (ip, agent) => {
  const data = await GuestUserInfo.findOne({ ipAddress: ip, userAgent: agent });
  return data;
};

const saveGuestMeta = async (body) => {
  const gestMeta = new GuestUserInfo({
    user: body.uid,
    ipAddress: body.ip,
    userAgent: body.agent,
  });
  return GuestUserInfo.create(gestMeta);
};

module.exports = {
  checkRegister,
  saveGuestMeta,
};

