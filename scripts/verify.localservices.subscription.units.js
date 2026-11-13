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
 * verify.localservices.subscription.units.js — paid plan purchase + activation.
 * Run: node scripts/verify.localservices.subscription.units.js
 */

const subscriptionPayment = require('../src/modules/local-services/services/localservice.subscription.payment.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const makeDeps = ({ price = 299 } = {}) => {
  const store = [];
  const initiations = [];
  const expiries = [];
  const entries = [];

  const PlanModel = {
    findById: async () => ({
      _id: 'plan1',
      code: 'PRO',
      name: 'Pro plan',
      price,
      interval: 'monthly',
      entitlements: ['featured', 'analytics'],
      status: 'active',
    }),
  };

  const ProviderModel = {
    findOne: async () => ({ _id: 'p1', owner: 'u1', status: 'ACTIVE' }),
    findById: () => ({
      select: () => ({ lean: async () => ({ _id: 'p1', owner: 'u1' }) }),
    }),
  };

  const SubscriptionModel = {
    create: async (payload) => {
      const doc = {
        _id: `sub${store.length + 1}`,
        ...payload,
        async save() {
          return this;
        },
      };
      store.push(doc);
      return doc;
    },
    findOne: async () => store[store.length - 1] || null,
    findById: async (id) => store.find((s) => s._id === id) || null,
    updateMany: async (filter, update) => {
      if (filter.status === 'active' && update.$set.status === 'expired') {
        expiries.push(filter);
        return { modifiedCount: 2 };
      }
      if (filter.status === 'pending_payment') return { modifiedCount: 1 };
      return { modifiedCount: 0 };
    },
  };

  const PaymentInitiationModel = {
    findOne: () => ({ sort: async () => null }),
    create: async (payload) => {
      const doc = { _id: `pay${initiations.length + 1}`, ...payload };
      initiations.push(doc);
      return doc;
    },
  };

  const PaymentConfigModel = {
    findOne: async () => ({ _id: 'cfg1', status: true, isDefault: true }),
    findById: async () => ({ _id: 'cfg1', status: true, isDefault: true }),
  };

  const rule = { _id: 'rule1', toSnapshot: () => ({ code: 'SYSTEM_SUBSCRIPTION' }) };
  const RevenueRuleModel = {
    findOne: async () => rule,
    create: async () => rule,
  };
  const RevenueEntryModel = {
    create: async (payload) => {
      entries.push(payload);
      return payload;
    },
  };

  return {
    deps: {
      PlanModel,
      ProviderModel,
      SubscriptionModel,
      PaymentInitiationModel,
      PaymentConfigModel,
      RevenueRuleModel,
      RevenueEntryModel,
    },
    store,
    initiations,
    expiries,
    entries,
  };
};

const run = async () => {
  const paid = makeDeps({ price: 299 });
  const bought = await subscriptionPayment.subscribe(
    { ownerId: 'u1', planId: 'plan1' },
    paid.deps
  );
  ok('paid plan starts pending', bought.subscription.status === 'pending_payment');
  ok('paid plan awaits payment', bought.subscription.paymentStatus === 'initiated');
  ok('paid plan stores price', Number(bought.subscription.amount) === 299);
  ok('paid plan snapshots entitlements', bought.subscription.planSnapshot.entitlements.length === 2);
  ok('paid plan opens one initiation', paid.initiations.length === 1);
  ok('initiation uses subscription subject', paid.initiations[0].paymentFrom === 'localServiceSubscription');
  ok('subscription marked initiated', bought.subscription.paymentStatus === 'initiated');
  ok('payLink is the initiation id', bought.initiation && bought.initiation._id === 'pay1');

  const activated = await subscriptionPayment.activateSubscription(
    { subscriptionId: 'sub1', paymentId: 'pay1', amount: 299 },
    paid.deps
  );
  ok('activation is not deduped', activated.deduped === false);
  ok('activation marks paid', bought.subscription.paymentStatus === 'paid');
  ok('activation makes plan active', bought.subscription.status === 'active');
  ok('activation sets paidAt', bought.subscription.paidAt instanceof Date);
  ok('activation advances renewal', bought.subscription.renewAt > bought.subscription.startedAt);
  ok('activation expires the previous plan', paid.expiries.length === 1);
  ok('previous plan expiry scopes provider', paid.expiries[0] && paid.expiries[0].provider === 'p1');
  ok('activation posts one revenue entry', paid.entries.length === 1);
  ok(
    'subscription revenue idempotency key',
    paid.entries[0] && paid.entries[0].idempotencyKey === 'lssub:subscription:sub1:paid'
  );
  ok('subscription revenue amount', paid.entries[0] && paid.entries[0].serviceValue === 299);
  ok('subscription revenue is provider-paid', paid.entries[0] && paid.entries[0].payer === 'provider');

  const replay = await subscriptionPayment.activateSubscription(
    { subscriptionId: 'sub1', paymentId: 'pay1', amount: 299 },
    paid.deps
  );
  ok('activation replay is deduped', replay.deduped === true);
  ok('activation replay writes no extra entry', paid.entries.length === 1);

  const free = makeDeps({ price: 0 });
  const freeBought = await subscriptionPayment.subscribe(
    { ownerId: 'u1', planId: 'plan1' },
    free.deps
  );
  ok('free plan activates immediately', freeBought.subscription.status === 'active');
  ok('free plan is paid', freeBought.subscription.paymentStatus === 'paid');
  ok('free plan opens no initiation', free.initiations.length === 0);
  ok('free plan posts no revenue', free.entries.length === 0);

  const sweep = makeDeps();
  const swept = await subscriptionPayment.expireSubscriptions(new Date('2026-06-01T00:00:00Z'), sweep.deps);
  ok('expired plans are swept', swept.expired === 2);
  ok('abandoned checkouts are cancelled', swept.abandoned === 1);

  ok(
    'subscription subject recognized',
    subscriptionPayment.isLsSubscriptionSubject('localServiceSubscription') === true
  );
  ok(
    'campaign subject is not a subscription',
    subscriptionPayment.isLsSubscriptionSubject('localServiceCampaign') === false
  );

  console.log(failures === 0 ? '\nAll local-services subscription units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
