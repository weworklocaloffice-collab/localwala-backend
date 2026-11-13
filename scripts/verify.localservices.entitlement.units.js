const entitlement = require('../src/modules/local-services/services/localservice.entitlement.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const makeDeps = ({ subscription = null, provider = { _id: 'p1', owner: 'u1' } } = {}) => ({
  ProviderModel: { findOne: async () => provider },
  SubscriptionModel: { findOne: async () => subscription },
});

(async () => {
  const noSubDeps = makeDeps({ subscription: null });
  ok('no active subscription allows the feature', await entitlement.providerHasEntitlement('u1', 'marketing', noSubDeps) === true);

  const withSubDeps = makeDeps({
    subscription: { planSnapshot: { entitlements: ['Marketing', 'analytics'] } },
  });
  ok('matching entitlement is allowed', await entitlement.providerHasEntitlement('u1', 'marketing', withSubDeps) === true);
  ok('missing entitlement is blocked', await entitlement.providerHasEntitlement('u1', 'featured', withSubDeps) === false);
  ok('unknown entitlement string is case-insensitive', await entitlement.providerHasEntitlement('u1', 'ANALYTICS', withSubDeps) === true);

  const noProviderDeps = makeDeps({ provider: null });
  ok('missing provider has no active subscription', (await entitlement.getActiveSubscription('u1', noProviderDeps)) === null);

  let threw = false;
  try {
    await entitlement.requireEntitlement('u1', 'featured', withSubDeps);
  } catch (error) {
    threw = error && error.statusCode === 403;
  }
  ok('requireEntitlement throws 403 for a missing entitlement', threw);

  ok('entitlementsOf normalizes values', JSON.stringify(entitlement.entitlementsOf({ planSnapshot: { entitlements: [' Marketing ', null, 'ANALYTICS'] } })) === JSON.stringify(['marketing', 'analytics']));

  if (failures) {
    console.error(`\n${failures} local-services entitlement unit(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll local-services entitlement units passed.');
})();
