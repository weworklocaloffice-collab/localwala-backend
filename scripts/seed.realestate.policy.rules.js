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
const RealEstateHoldPolicy = require('../src/modules/realestate/models/realestate.hold.policy.model');
const RealEstateCommissionRule = require('../src/modules/realestate/models/realestate.commission.rule.model');

// Seeds the versioned business data the money paths require:
// one ACTIVE hold policy (plan §6.4 defaults) and the §5.9 slabs.
// Idempotent: existing ACTIVE rows are never edited (a rate change is
// a new version, never a restate). Re-runs report 0 created.
//
// Amounts are RUPEES here; `moneyField` stores paise.
const HOLD_POLICY = {
  name: 'Default hold terms',
  version: 1,
  status: 'ACTIVE',
  principalAmount: 50000,
  serviceFeePercent: 5.0,
  serviceFeeMin: 500,
  serviceFeeMax: 0,
  durationDays: 15,
  gracePeriodHours: 72,
  cancellationRefundable: true,
  expiryRefundable: true,
  feeRefundableOnListingWithdrawal: true,
  forfeitureRequiresDualControl: true,
  cancellationFeeBorneBy: 'CUSTOMER',
  effectiveFrom: new Date('2026-01-01'),
};

const COMMISSION_RULES = [
  {
    type: 'PROPERTY_SALE',
    name: 'Sale up to 99,99,999',
    rate: 2.0,
    calculationBasis: 'SALE_VALUE',
    slabFrom: 0,
    slabTo: 9999999,
    effectiveFrom: new Date('2026-01-01'),
    version: 1,
    status: 'ACTIVE',
  },
  {
    type: 'PROPERTY_SALE',
    name: 'Sale 1,00,00,000 and above',
    rate: 1.0,
    calculationBasis: 'SALE_VALUE',
    slabFrom: 10000000,
    slabTo: null,
    effectiveFrom: new Date('2026-01-01'),
    version: 1,
    status: 'ACTIVE',
  },
  {
    type: 'CUSTOMER_REFERRAL',
    name: 'Referrer share of LocalWala commission',
    rate: 10.0,
    calculationBasis: 'LOCALWALA_COMMISSION',
    slabFrom: 0,
    slabTo: null,
    effectiveFrom: new Date('2026-01-01'),
    version: 1,
    status: 'ACTIVE',
  },
  {
    type: 'EXECUTIVE',
    name: 'Executive share of LocalWala commission',
    rate: 5.0,
    calculationBasis: 'LOCALWALA_COMMISSION',
    slabFrom: 0,
    slabTo: null,
    effectiveFrom: new Date('2026-01-01'),
    version: 1,
    status: 'ACTIVE',
  },
];

async function seedRealEstatePolicyRules() {
  let created = 0;
  let existing = 0;

  if (!(await RealEstateHoldPolicy.findOne({ version: HOLD_POLICY.version, status: 'ACTIVE' }))) {
    await RealEstateHoldPolicy.create(HOLD_POLICY);
    created += 1;
  } else {
    existing += 1;
  }

  for (const rule of COMMISSION_RULES) {
    // Lookup by plain fields only — money fields store paise inside,
    // so filtering on them invites a rupees/paise mismatch. (type, name)
    // is unique per seed version by construction.
    const found = await RealEstateCommissionRule.findOne({
      type: rule.type,
      name: rule.name,
      status: 'ACTIVE',
    }).lean();
    if (!found) {
      await RealEstateCommissionRule.create(rule);
      created += 1;
    } else {
      existing += 1;
    }
  }

  return { created, existing };
}

module.exports = seedRealEstatePolicyRules;

if (require.main === module) {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/foodbite';
  mongoose
    .connect(uri)
    .then(async () => {
      const r = await seedRealEstatePolicyRules();
      console.log(`seed.realestate.policy.rules: ${r.created} created / ${r.existing} existing`);
      await mongoose.disconnect();
    })
    .catch(async (e) => {
      console.error(e.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
