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
 * verify.realestate.commission.js — the ₹60L worked example (plan §5.9),
 * the slab boundary, BR-15 snapshot freeze, BR-16 basis and the F-10 guard.
 * Live against MongoDB; cleans up everything it inserts.
 *
 * Run:  node scripts/verify.realestate.commission.js
 *
 * Expected at frozen rates, saleValue ₹60,00,000 × PROPERTY_SALE 2.0%:
 *   localwalaCommission  ₹1,20,000   REVENUE → LOCALWALA
 *   referral @10%         ₹12,000   PAYABLE → REFERRER
 *   executive @5%          ₹6,000   PAYABLE → EXECUTIVE
 */

const mongoose = require('mongoose');
require('dotenv').config();

const RealEstateCommissionRule = require('../src/modules/realestate/models/realestate.commission.rule.model');
const RealEstateCommission = require('../src/modules/realestate/models/realestate.commission.model');
const RealEstateLedgerEntry = require('../src/modules/realestate/models/realestate.ledger.entry.model');
const ruleService = require('../src/modules/realestate/services/realestate.commission.rule.service');
const commissionService = require('../src/modules/realestate/services/realestate.commission.service');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + (e ? '  ->  ' + e : ''));
};

const touched = { rules: [], commissions: [], ledger: [] };

const run = async () => {
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) throw new Error('MONGODB_URL not set');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });

  // Distinctive slabs so the F-8 partial unique never clashes with seed data.
  const now = new Date();
  const mkRule = async (type, rate, slabTo) => {
    const r = await RealEstateCommissionRule.create({
      type,
      name: `verify-${type}-${Date.now()}`,
      rate,
      calculationBasis: 'SALE_VALUE',
      slabFrom: 0,
      slabTo: slabTo === null ? null : slabTo,
      effectiveFrom: now,
      status: 'ACTIVE',
    });
    touched.rules.push(r._id);
    return r;
  };

  console.log('\n[1] ₹60L worked example at frozen rates');
  const saleRule = await mkRule('PROPERTY_SALE', 2.0, 9999999);
  await mkRule('CUSTOMER_REFERRAL', 10.0, null);
  await mkRule('EXECUTIVE', 5.0, null);
  const saleId = new mongoose.Types.ObjectId();
  const referrer = new mongoose.Types.ObjectId();
  const executive = new mongoose.Types.ObjectId();

  const first = await commissionService.computeSaleCommissions({
    saleId,
    saleValue: 6000000,
    referralRate: 10,
    executiveRate: 5,
    referrer,
    executive,
  });
  for (const c of first.rows) {
    touched.commissions.push(c._id);
    const entries = await RealEstateLedgerEntry.find({ sourceModel: 'RealEstateCommission', sourceId: c._id }).lean();
    entries.forEach((e) => touched.ledger.push(e._id));
  }
  const byParty = {
    LOCALWALA: first.localwalaCommission,
    REFERRER: first.referralCommission,
    EXECUTIVE: first.executiveCommission,
  };
  const expect = (label, got, want) => {
    if (Number(got) === want) ok(`${label} ₹${want.toLocaleString('en-IN')}`);
    else bad(label, `expected ${want}, got ${got}`);
  };
  expect('localwalaCommission', byParty.LOCALWALA, 120000);
  expect('referralCommission', byParty.REFERRER, 12000);
  expect('executiveCommission', byParty.EXECUTIVE, 6000);

  console.log('\n[2] slab boundary — a 60L sale resolves the 0–99,99,999 rule');
  const resolved = await ruleService.resolveActiveRule('PROPERTY_SALE', 6000000, new Date());
  if (String(resolved._id) === String(saleRule._id)) ok('slab match on the test rule');
  else bad('slab match', `resolved ${resolved._id}, expected ${saleRule._id}`);

  console.log('\n[3] BR-15 — snapshot survives a rate change');
  await ruleService.retireRule(saleRule._id, new Date());
  const saleRule2 = await mkRule('PROPERTY_SALE', 1.5, 9999999);
  const reread = await RealEstateCommission.find({ sale: saleId }).lean();
  const frozen = reread.find((c) => c.beneficiaryType === 'LOCALWALA');
  // .lean() bypasses moneyField getters, so amount reads in paise.
  if (frozen && frozen.ruleSnapshot && frozen.ruleSnapshot.rate === 2.0 && frozen.amount === 12000000)
    ok('2026 sale still reads 2% / ₹1,20,000 after rule moved to 1.5%');
  else bad('snapshot freeze', JSON.stringify(frozen && { snapshot: frozen.ruleSnapshot, amount: frozen && frozen.amount }));
  void saleRule2;

  console.log('\n[4] BR-16 + F-10 — shares on LocalWala commission, over-share throws');
  try {
    await commissionService.computeSaleCommissions({
      saleId: new mongoose.Types.ObjectId(),
      saleValue: 6000000,
      referralRate: 90,
      executiveRate: 90,
      referrer,
      executive,
    });
    bad('F-10 over-share', 'did not throw');
  } catch (e) {
    ok('referral 90% + executive 90% throws');
  }
};

run()
  .catch((e) => {
    bad('script', e.message);
  })
  .finally(async () => {
    try {
      if (touched.ledger.length) await RealEstateLedgerEntry.deleteMany({ _id: { $in: touched.ledger } });
      if (touched.commissions.length) await RealEstateCommission.deleteMany({ _id: { $in: touched.commissions } });
      if (touched.rules.length) await RealEstateCommissionRule.deleteMany({ _id: { $in: touched.rules } });
      console.log(`\ncleanup: removed ${touched.rules.length} rule(s), ${touched.commissions.length} commission(s), ${touched.ledger.length} ledger row(s)`);
    } catch (e) {
      console.error('CLEANUP FAILED — check for leftover test rows:', e.message);
    }
    await mongoose.disconnect().catch(() => {});
    console.log('');
    if (failed > 0) {
      console.log(`${failed} CHECK(S) FAILED`);
      process.exit(1);
    }
    console.log('ALL COMMISSION CHECKS PASSED');
  });
