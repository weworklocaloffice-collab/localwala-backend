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
 * verify.localservices.policyconfig.units.js — policy resolution units.
 * Run: node scripts/verify.localservices.policyconfig.units.js
 */

const policyConfig = require('../src/modules/local-services/services/localservice.policy.config.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` – ${detail}` : ''}`);
  }
};

const NOW = new Date('2026-11-02T10:00:00Z');
const policy = (over = {}) => ({
  _id: over.code || 'p1',
  code: 'DEFAULT',
  status: 'active',
  version: 1,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  cancellationCutoffHours: 24,
  cancellationFee: 0,
  rescheduleCutoffHours: 24,
  quoteExpiryHours: 72,
  quoteMaxExpiryHours: 168,
  advanceBookingDays: 60,
  minNoticeHours: 0,
  depositPercent: 0,
  taxPercent: 0,
  ...over,
});

// ---- 1. Scope precedence mirrors revenue rules ---------------------------
const platform = policy({ code: 'PLATFORM' });
const category = policy({ code: 'CATEGORY', categoryKey: 'home' });
const subcategory = policy({ code: 'SUBCATEGORY', categoryKey: 'home', subcategoryKey: 'plumbing' });
const service = policy({ code: 'SERVICE', categoryKey: 'home', subcategoryKey: 'plumbing', serviceKey: 'repair' });
const provider = policy({ code: 'PROVIDER', categoryKey: 'home', subcategoryKey: 'plumbing', serviceKey: 'repair', provider: 'pr1' });
const scope = { categoryKey: 'home', subcategoryKey: 'plumbing', serviceKey: 'repair', provider: 'pr1' };

ok(
  'a provider policy wins over everything',
  policyConfig.resolvePolicy([platform, category, subcategory, service, provider], scope, NOW).code === 'PROVIDER'
);
ok(
  'a service policy wins over a category policy',
  policyConfig.resolvePolicy([platform, category, service], scope, NOW).code === 'SERVICE'
);
ok(
  'a subcategory policy wins over a category policy',
  policyConfig.resolvePolicy([platform, category, subcategory], scope, NOW).code === 'SUBCATEGORY'
);
ok(
  'a category policy wins over the platform policy',
  policyConfig.resolvePolicy([platform, category], scope, NOW).code === 'CATEGORY'
);
ok(
  'a policy for another category does not apply',
  policyConfig.resolvePolicy([policy({ code: 'OTHER', categoryKey: 'beauty' })], scope, NOW) === null
);
ok(
  'a provider policy does not apply to another provider',
  policyConfig.resolvePolicy([provider], { ...scope, provider: 'pr2' }, NOW) === null
);

// ---- 2. Only active, in-force policies apply ------------------------------
ok(
  'a draft policy does not apply',
  policyConfig.resolvePolicy([policy({ status: 'draft' })], scope, NOW) === null
);
ok(
  'an inactive policy does not apply',
  policyConfig.resolvePolicy([policy({ status: 'inactive' })], scope, NOW) === null
);
ok(
  'a future policy does not apply yet',
  policyConfig.resolvePolicy(
    [policy({ effectiveFrom: new Date('2027-01-01T00:00:00Z') })],
    scope,
    NOW
  ) === null
);
ok(
  'an expired policy does not apply',
  policyConfig.resolvePolicy(
    [policy({ effectiveTo: new Date('2026-06-01T00:00:00Z') })],
    scope,
    NOW
  ) === null
);

// ---- 3. Defaults when no policy exists ------------------------------------
const defaults = policyConfig.buildEffectivePolicy(null, {});
ok('default cancellation cutoff is 24h', defaults.cancellationCutoffHours === 24);
ok('default quote expiry is 72h', defaults.quoteExpiryHours === 72);
ok('default tax is zero', defaults.taxPercent === 0);

// ---- 4. The catalogue wins over a category policy ------------------------
const withCatalogue = policyConfig.buildEffectivePolicy(category, {
  depositPercent: 25,
  allowedPaymentModes: ['cod'],
});
ok('the catalogue deposit wins', withCatalogue.depositPercent === 25);
ok('the catalogue payment modes win', withCatalogue.allowedPaymentModes.join(',') === 'cod');
const withoutCatalogue = policyConfig.buildEffectivePolicy(category, {});
ok('the policy deposit applies when the catalogue has none', withoutCatalogue.depositPercent === 0);

// ---- 5. Quote expiry is bounded by policy --------------------------------
const effective = policyConfig.buildEffectivePolicy(policy({ quoteMaxExpiryHours: 48 }), {});
let threw = false;
try {
  policyConfig.assertQuoteExpiryWithinPolicy({
    expiresAt: new Date(NOW.getTime() + 72 * 3600000),
    effectivePolicy: effective,
    now: NOW,
  });
} catch (e) {
  threw = e.statusCode === 400;
}
ok('a quote cannot outlive the policy ceiling', threw);
let accepted = null;
try {
  accepted = policyConfig.assertQuoteExpiryWithinPolicy({
    expiresAt: new Date(NOW.getTime() + 24 * 3600000),
    effectivePolicy: effective,
    now: NOW,
  });
} catch (e) {
  accepted = null;
}
ok('a shorter quote expiry is accepted', accepted !== null);
let pastThrew = false;
try {
  policyConfig.assertQuoteExpiryWithinPolicy({
    expiresAt: new Date(NOW.getTime() - 3600000),
    effectivePolicy: effective,
    now: NOW,
  });
} catch (e) {
  pastThrew = e.statusCode === 400;
}
ok('a past quote expiry is refused', pastThrew);

// ---- 6. Booking window ---------------------------------------------------
let windowThrew = false;
try {
  policyConfig.assertWithinBookingWindow({
    scheduledAt: new Date(NOW.getTime() + 2 * 3600000),
    effectivePolicy: policyConfig.buildEffectivePolicy(policy({ minNoticeHours: 24 }), {}),
    now: NOW,
  });
} catch (e) {
  windowThrew = e.statusCode === 400;
}
ok('a booking inside the minimum notice is refused', windowThrew);
let advanceThrew = false;
try {
  policyConfig.assertWithinBookingWindow({
    scheduledAt: new Date(NOW.getTime() + 90 * 86400000),
    effectivePolicy: policyConfig.buildEffectivePolicy(policy({ advanceBookingDays: 60 }), {}),
    now: NOW,
  });
} catch (e) {
  advanceThrew = e.statusCode === 400;
}
ok('a booking beyond the advance window is refused', advanceThrew);
let okWindow = null;
try {
  okWindow = policyConfig.assertWithinBookingWindow({
    scheduledAt: new Date(NOW.getTime() + 3 * 86400000),
    effectivePolicy: policyConfig.buildEffectivePolicy(policy({ advanceBookingDays: 60, minNoticeHours: 1 }), {}),
    now: NOW,
  });
} catch (e) {
  okWindow = null;
}
ok('a booking inside the window is accepted', okWindow !== null);

console.log(failures === 0 ? '\nAll local-services policy-config units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
