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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * Seed Real Estate foundation rows: vertical registry, hold policy,
 * commission rules and settings defaults. Idempotent — re-running
 * updates without duplicating (plan §19.1, §15.4–§15.5).
 *
 * Run:  node scripts/seed.realestate.js
 *
 * ## What and why
 *
 * - `Vertical { key: 'realestate' }` — the admin verticals list + the
 *   on/off switch. No model change; `usesSharedDelivery` left alone
 *   (dead field, plan §15.5).
 * - `RealEstateHoldPolicy` v1 ACTIVE — principal ₹50,000, fee 5%,
 *   15 days, 72 h grace (§6.4). Holds cannot exist without one.
 * - `RealEstateCommissionRule` — seeded slabs are data, not code
 *   (plan §5.9): `0 – 99,99,999 → 2.0%`, `1,00,00,000+ → 1.0%`.
 * - `RealEstateSetting` — single settings document with plan §15.7.4
 *   defaults. The admin screen edits it afterwards.
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const Vertical = require('../src/kernel/vertical/models/vertical.model');
const RealEstateHoldPolicy = require('../src/modules/realestate/models/realestate.hold.policy.model');
const RealEstateCommissionRule = require('../src/modules/realestate/models/realestate.commission.rule.model');
const RealEstateSetting = require('../src/modules/realestate/models/realestate.setting.model');

const run = async () => {
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) throw new Error('MONGODB_URL not set');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });

  let created = 0;
  let updated = 0;
  const upsert = async (model, filter, doc) => {
    const r = await model.updateOne(filter, { $setOnInsert: doc, $set: { updatedAt: new Date() } }, { upsert: true });
    if (r.upsertedCount > 0) created += 1;
    else updated += 1;
  };

  await upsert(
    Vertical,
    { key: 'realestate' },
    { key: 'realestate', name: 'Real Estate', description: 'Property listings, holds, loans and settlements', icon: 'tablerBuildingEstate', sortOrder: 4, status: true }
  );

  await upsert(
    RealEstateHoldPolicy,
    { version: 1 },
    {
      name: 'Standard hold terms v1',
      version: 1,
      status: 'ACTIVE',
      principalAmount: 50000,
      serviceFeePercent: 5.0,
      serviceFeeMin: 500,
      durationDays: 15,
      gracePeriodHours: 72,
      cancellationRefundable: true,
      expiryRefundable: true,
      feeRefundableOnListingWithdrawal: true,
      forfeitureRequiresDualControl: true,
      cancellationFeeBorneBy: 'CUSTOMER',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    }
  );

  await upsert(
    RealEstateCommissionRule,
    { type: 'PROPERTY_SALE', slabFrom: 0, status: 'ACTIVE' },
    {
      type: 'PROPERTY_SALE',
      name: 'Standard sale commission ≤ ₹99,99,999',
      rate: 2.0,
      calculationBasis: 'SALE_VALUE',
      slabFrom: 0,
      slabTo: 9999999,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      version: 1,
      status: 'ACTIVE',
    }
  );
  await upsert(
    RealEstateCommissionRule,
    { type: 'PROPERTY_SALE', slabFrom: 10000000, status: 'ACTIVE' },
    {
      type: 'PROPERTY_SALE',
      name: 'Standard sale commission ≥ ₹1,00,00,000',
      rate: 1.0,
      calculationBasis: 'SALE_VALUE',
      slabFrom: 10000000,
      slabTo: null,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      version: 1,
      status: 'ACTIVE',
    }
  );

  await upsert(
    RealEstateSetting,
    {},
    {
      enabled: true,
      enquiryRequiresContactVerified: false,
      autoAssignVisitRequests: true,
      defaultCheckInRadiusMeters: 200,
      defaultHoldDurationDays: 15,
      searchMaxRadiusKm: 50,
      listingMaxImages: 20,
      listingMaxVideos: 3,
      customerCanRequestLoan: true,
      customerCanHoldProperty: true,
      referralCommissionEnabled: false,
      promotionsEnabled: false,
      notificationsEnabled: true,
    }
  );

  console.log(`\nseed.realestate: ${created} created / ${updated} updated`);
  await mongoose.disconnect().catch(() => {});
};

run().catch(async (e) => {
  console.error('SEED FAILED:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
