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

const RealEstatePropertyPromotion = require('../models/realestate.property.promotion.model');
const RealEstatePropertyDailyStat = require('../models/realestate.property.daily.stat.model');

/**
 * Promotion + stats service (F-20, F-19).
 * Promotions are a deferred revenue line — schema now, launch later.
 * Daily stats are rolled up by cron; this is the write path it uses.
 */
async function createPromotion({ property, vendor, amount, startsAt, endsAt }) {
  return RealEstatePropertyPromotion.create({ property, vendor, amount, startsAt, endsAt, status: 'PENDING_PAYMENT' });
}

async function upsertDailyStat({ property, day, views = 0, enquiries = 0, leads = 0, visits = 0 }) {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  return RealEstatePropertyDailyStat.findOneAndUpdate(
    { property, day: dayStart },
    { $inc: { views, enquiries, leads, visits } },
    { upsert: true, new: true, runValidators: true }
  );
}

const realEstatePromotionService = { createPromotion, upsertDailyStat };

module.exports = realEstatePromotionService;
