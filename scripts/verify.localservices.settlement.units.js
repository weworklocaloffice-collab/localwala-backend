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
 * verify.localservices.settlement.units.js — settlement + notify pure units.
 * Run: node scripts/verify.localservices.settlement.units.js
 */

const settlement = require('../src/modules/local-services/services/localservice.settlement.service');
const notify = require('../src/modules/local-services/services/localservice.notify.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

(async () => {
  // Summarize: paise in (lean), rupees out. 6000 = ₹60.
  const s = settlement.summarizeEntries([
    { bookingFee: 6000, commissionAmount: 2000, platformRevenue: 8000, providerPayable: 38000, entryType: 'charge' },
    { bookingFee: 6000, commissionAmount: 2000, platformRevenue: 8000, providerPayable: 38000, entryType: 'charge' },
    { bookingFee: -6000, commissionAmount: -2000, platformRevenue: -8000, providerPayable: 0, entryType: 'reversal' },
  ]);
  ok('summary count 2 charges', s.count === 2, JSON.stringify(s));
  ok('summary fees 120', s.fees === 120, JSON.stringify(s));
  ok('summary platform 160', s.platform === 160, JSON.stringify(s));
  ok('summary reversals 80', s.reversals === 80, JSON.stringify(s));
  ok('summary net 80', s.net === 80, JSON.stringify(s));

  // Generate without linked Business => summary-only, no crash.
  const EntryModel = { find: () => ({ lean: async () => [] }) };
  const ProviderModel = { findById: async () => ({ _id: 'p1', business: null }) };
  const r = await settlement.generateSettlement(
    { providerId: 'p1', from: new Date('2026-01-01'), to: new Date('2026-02-01') },
    { EntryModel, ProviderModel }
  );
  ok('no-business summary-only', r.settlement === null && r.summary.count === 0);

  // Generate with linked Business uses the GLOBAL settlementNo and reports
  // customer refunds (provider + platform reversal), not platform-only.
  const entries = [
    { _id: 'e1', bookingFee: 6000, commissionAmount: 2000, platformRevenue: 8000, providerPayable: 38000, entryType: 'charge' },
    { _id: 'e2', bookingFee: -6000, commissionAmount: -2000, platformRevenue: -8000, providerPayable: 0, entryType: 'reversal' },
  ];
  let created;
  let consumed = [];
  const SettlementModel = {
    findOne: () => ({ sort: () => ({ lean: async () => ({ settlementNo: 42 }) }) }),
    create: async (doc) => {
      created = doc;
      return { _id: 's1', ...doc };
    },
  };
  const EntryWithBusiness = {
    find: () => ({ lean: async () => entries }),
    updateMany: async (q, update) => {
      consumed = { q, update };
    },
  };
  const rb = await settlement.generateSettlement(
    { providerId: 'p1', from: new Date('2026-01-01'), to: new Date('2026-02-01') },
    { EntryModel: EntryWithBusiness, ProviderModel: { findById: async () => ({ _id: 'p1', business: 'b1' }) }, SettlementModel }
  );
  ok('global settlementNo 43', created && created.settlementNo === 43, JSON.stringify(created));
  ok('settlement refunds include provider reversal', created && created.totals.refunds === 80, JSON.stringify(created && created.totals));
  ok('settlement net payable 380', created && created.totals.netAmount === 380, JSON.stringify(created && created.totals));
  ok('entries consumed by settlement', consumed.q && consumed.q._id.$in.length === 2 && rb.settlement._id === 's1');

  // Notify never throws, returns null on bad input.
  const n1 = await notify.notifyUser({}, { NotifyModel: { create: async () => { throw new Error('db down'); } } });
  ok('notify swallows errors', n1 === null);
  const n2 = await notify.notifyUser({ userId: 'u1', title: 't', content: 'c' }, { NotifyModel: { create: async (d) => d } });
  ok('notify writes row', n2 && n2.title === 't');

  console.log(failures === 0 ? '\nAll local-services settlement units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
