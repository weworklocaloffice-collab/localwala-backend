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
 * verify.localservices.marketing.units.js — campaign lifecycle + payment units.
 * Run: node scripts/verify.localservices.marketing.units.js
 */

const marketing = require('../src/modules/local-services/services/localservice.marketing.service');
const marketingPayment = require('../src/modules/local-services/services/localservice.marketing.payment.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const makeDoc = (overrides = {}) => ({
  _id: 'c1',
  caption: 'Test campaign',
  provider: 'p1',
  createdBy: 'u1',
  amount: 499,
  paymentStatus: 'initiated',
  status: 'approved_unpaid',
  startsAt: new Date(Date.now() - 3600000),
  endsAt: new Date(Date.now() + 3600000),
  packageSnapshot: { code: 'HOME_LOCALITY_24H' },
  paymentInitiation: 'i1',
  save: async function save() {
    this.saved = true;
  },
  ...overrides,
});

const run = async () => {
  const calls = [];
  const FakeCampaign = {
    updateMany: async (filter, update) => {
      calls.push({ filter, update });
      return { modifiedCount: calls.length };
    },
  };
  const swept = await marketing.sweepCampaigns(new Date('2026-06-01T00:00:00Z'), {
    CampaignModel: FakeCampaign,
  });
  ok('sweep activates scheduled campaigns', calls[0].filter.status === 'scheduled');
  ok('sweep completes scheduled/live/paused', calls[1].filter.status.$in[2] === 'paused');
  ok('sweep lapses unpaid approvals', calls[2].filter.status === 'approved_unpaid');
  ok('sweep reports counts', swept.activated === 1 && swept.completed === 2 && swept.lapsed === 3);

  const entries = [];
  const rule = {
    _id: 'rule1',
    toSnapshot: () => ({ code: 'SYSTEM_MARKETING' }),
  };
  const RevenueEntryModel = {
    create: async (payload) => {
      entries.push(payload);
      return payload;
    },
  };
  const RevenueRuleModel = {
    findOne: async () => rule,
    create: async () => rule,
  };

  const doc = makeDoc();
  const paid = await marketingPayment.markCampaignPaid(
    { campaignId: 'c1', paymentId: 'pay1', amount: 499 },
    { CampaignModel: { findById: async () => doc }, RevenueEntryModel, RevenueRuleModel }
  );
  ok('paid campaign records payment', doc.paymentStatus === 'paid');
  ok('paid campaign goes live inside window', doc.status === 'live');
  ok('paid campaign stores payment id', doc.paymentInitiation === 'pay1');
  ok('paid campaign posts one revenue entry', entries.length === 1);
  ok(
    'revenue idempotency key is campaign-scoped',
    entries[0] && entries[0].idempotencyKey === 'lsmkt:campaign:c1:paid'
  );
  ok('revenue amount is the campaign price', entries[0] && entries[0].serviceValue === 499);
  ok('revenue is provider-paid', entries[0] && entries[0].payer === 'provider');
  ok('mark paid reports not deduped', paid.deduped === false);

  const paidDoc = makeDoc({ paymentStatus: 'paid', status: 'live' });
  const replay = await marketingPayment.markCampaignPaid(
    { campaignId: 'c1', paymentId: 'pay1', amount: 499 },
    {
      CampaignModel: { findById: async () => paidDoc },
      RevenueEntryModel,
      RevenueRuleModel,
    }
  );
  ok('paid replay is deduped', replay.deduped === true);
  ok('paid replay writes no extra entry', entries.length === 1);
  ok('paid replay does not resave', paidDoc.saved !== true);

  ok(
    'marketing subject is recognized',
    marketingPayment.isLsMarketingSubject('localServiceCampaign') === true
  );
  ok(
    'booking subject is not marketing',
    marketingPayment.isLsMarketingSubject('localServiceBooking') === false
  );

  console.log(failures === 0 ? '\nAll local-services marketing units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
