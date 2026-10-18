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

/**
 * seed.localservices.revenue.js — idempotent seed for the revenue engine.
 *
 * Creates (if missing):
 *  - Vertical { key: 'local_services' }
 *  - Platform default rule (COMBINED, fee+commission toggles ON, LABOUR_ONLY)
 *  - Home Services category rule (₹60 fee + 5% labour, parts excluded) as DRAFT
 *    — stays DRAFT until explicitly approved + activated per spec (proposed defaults).
 *
 * Run: node scripts/seed.localservices.revenue.js
 * Requires: MONGO_URL / MONGODB_URL env (same as app config). Dry-run with --dry.
 */

const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');

async function main() {
  const uri = process.env.MONGO_URL || process.env.MONGODB_URL || process.env.MONGO_URI;
  if (!uri && !DRY) {
    console.log('Set MONGO_URL to seed. Use --dry to print without writing.');
    process.exit(1);
  }
  const platformRule = {
    code: 'LS-PLATFORM-DEFAULT',
    name: 'Local Services platform default',
    revenueModel: 'COMBINED',
    vertical: 'local_services',
    categoryKey: null,
    payer: 'customer',
    bookingFeeEnabled: true,
    bookingFee: 60,
    commissionEnabled: true,
    commissionType: 'percentage',
    commissionRatePercent: 5,
    calculationBasis: 'LABOUR_ONLY',
    qualifyingEvent: 'COMPLETION_VERIFIED',
    partsCommissionable: false,
    version: 1,
    status: 'draft',
    effectiveFrom: new Date('2026-01-01'),
  };
  const homeRule = {
    ...platformRule,
    code: 'LS-HOME-STD',
    name: 'Home Services standard (proposed)',
    categoryKey: 'home',
  };
  if (DRY) {
    console.log(JSON.stringify({ vertical: { key: 'local_services' }, rules: [platformRule, homeRule] }, null, 2));
    return;
  }
  await mongoose.connect(uri);
  const Vertical = require('../src/kernel/vertical/models/vertical.model');
  const Rule = require('../src/modules/local-services/models/localservice.revenue.rule.model');
  await Vertical.updateOne(
    { key: 'local_services' },
    { $setOnInsert: { key: 'local_services', name: 'Local Services', status: true } },
    { upsert: true }
  );
  for (const r of [platformRule, homeRule]) {
    await Rule.updateOne({ code: r.code, version: r.version }, { $setOnInsert: r }, { upsert: true });
  }
  console.log('seeded: vertical + 2 draft rules (approve + activate in Admin to go live)');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
