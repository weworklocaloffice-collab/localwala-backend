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
 * verify.localservices.lead.units.js — lead qualification units (stubbed DB).
 * Run: node scripts/verify.localservices.lead.units.js
 */

const leadService = require('../src/modules/local-services/services/localservice.lead.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

(async () => {
  const store = new Map();
  const lead = { _id: 'lead1', categoryKey: 'photo', serviceKey: null, qualified: false, status: 'NEW', save: async () => lead };
  const LeadModel = { findById: async () => lead };
  const RuleModel = {
    find: async () => [
      {
        _id: 'r1',
        code: 'LEAD-PHOTO',
        version: 1,
        revenueModel: 'LEAD_FEE',
        status: 'active',
        bookingFeeEnabled: true,
        bookingFee: 9900,
        commissionEnabled: false,
        commissionType: 'percentage',
        commissionRatePercent: 0,
        calculationBasis: 'QUALIFIED_LEAD',
        qualifyingEvent: 'QUOTE_ACCEPTED',
        payer: 'provider',
        currency: 'INR',
        effectiveFrom: new Date('2026-01-01'),
      },
    ],
  };
  const EntryModel = {
    create: async (d) => {
      if (store.has(d.idempotencyKey)) {
        const e = new Error('dup');
        e.code = 11000;
        throw e;
      }
      store.set(d.idempotencyKey, { ...d, _id: 'e1' });
      return store.get(d.idempotencyKey);
    },
    findOne: async (q) => store.get(q.idempotencyKey) || store.get(q.bookingId) || null,
  };
  const r1 = await leadService.qualifyLead('lead1', {}, { LeadModel, RuleModel, EntryModel });
  ok('lead fee 99 charged once', r1.entry && r1.entry.bookingFee === 99 && r1.deduped === false, JSON.stringify(r1.entry));
  ok('lead marked qualified', lead.qualified === true && lead.status === 'ACCEPTED');
  const r2 = await leadService.qualifyLead('lead1', {}, { LeadModel, RuleModel, EntryModel });
  ok('re-qualify dedupes', r2.deduped === true);
  console.log(failures === 0 ? '\nAll local-services lead units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
