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

const { Visitor } = require('../models');

const saveVisitor = async (param) => {
  const visitorData = new Visitor({
    ipAddress: param.ipAddress,
    userAgent: param.userAgent,
  });
  const tracking = await Visitor.create(visitorData);
  return { success: true, id: tracking.id };
};

const getTrackingId = async (param) => {
  const tracking = await Visitor.findOne({
    ipAddress: param.ipAddress,
    userAgent: param.userAgent,
  });
  if (!tracking || tracking.id === null || tracking.id === '') {
    const visitorData = new Visitor({
      ipAddress: param.ipAddress,
      userAgent: param.userAgent,
    });
    const newTracking = await Visitor.create(visitorData);
    return { success: true, id: newTracking.id };
  }
  return { success: true, id: tracking.id };
};

module.exports = {
  saveVisitor,
  getTrackingId,
};

