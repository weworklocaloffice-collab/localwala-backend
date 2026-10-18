/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB)
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
 * Verifies the `dairy_settings` tab in Business Setup.
 *
 * The point of this suite is not the CRUD. It is the promise made in the model's
 * comment: every field on that screen does something. Other verticals carry settings
 * that are stored and never read, and the `Vertical.status` switch already cost this
 * codebase one wasted block. A field added to the model without a reader is therefore
 * a test failure here, not a code review comment nobody reads.
 *
 * Asserts the settings service:
 *   1. reads return the model defaults before anything is saved
 *   2. only one settings document can ever exist
 *   3. values are coerced from the urlencoded form the admin panel actually sends
 *   4. an empty or non-numeric value falls back rather than becoming 0
 *   5. out-of-range values are clamped to 1-365
 *   6. `update` creates on first save, so the screen behaves the same either way
 *
 * Asserts the wiring — the reason the setting exists:
 *   7. `fefoWarningDays` changes the derived compliance status
 *   8. it changes the `expiring` boundary, not just the default
 *   9. it reaches `getSummary`, `listExpiring` and `refreshAllStatuses`
 *  10. a real compliance record flips from `valid` to `expiring` when narrowed
 *  11. `deriveStatus` stays pure when called with an explicit window
 *  12. a settings lookup failure falls back to 30 instead of throwing
 *
 * Asserts the no-dead-switches rule:
 *  13. every model field has a reader somewhere in the dairy source
 *  14. no field is both stored and silently unread
 *
 * Usage: node scripts/verify.dairy.settings.js
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  DairyCompliance,
  Business,
  DairySettings,
  User,
  Wallet,
  DairyCategory,
  DairySubCategory,
  DairyProduct,
  DairySku,
  DairySubscription,
} = require('../src/models');
const complianceService = require('../src/modules/dairy/services/dairy.compliance.service');
const subscriptionService = require('../src/modules/dairy/services/dairy.subscription.service');
const { dairySettingsService } = require('../src/services');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const DAY = 86400000;
const inDays = (days) => new Date(Date.now() + days * DAY);

/**
 * Every field declared on the model.
 *
 * Read off the schema rather than hardcoded, so adding a field without updating this
 * suite is what makes the no-dead-switches check fail loudly.
 */
const modelFields = () =>
  Object.keys(DairySettings.schema.paths).filter(
    (key) => !['_id', '__v', 'createdAt', 'updatedAt'].includes(key)
  );

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  console.log('\nDairy settings — defaults and singleton');
  console.log('--------------------------------------------------');

  await DairySettings.deleteMany({});

  // 1. reads before any save fall back to the model defaults, not to null. The
  //    compliance service reads this on dashboards, so a null would be a crash.
  const beforeSave = await dairySettingsService.getSettings();
  check(
    '1. getSettings returns defaults before anything is saved',
    beforeSave && beforeSave.fefoWarningDays === 30,
    `fefoWarningDays=${beforeSave && beforeSave.fefoWarningDays}`
  );

  const created = await dairySettingsService.createSettings({ fefoWarningDays: 45 });
  check('1b. createSettings persists the requested window', created.fefoWarningDays === 45);

  // 2. singleton. A second document would make `getSettings` ambiguous, since it
  //    reads `findOne()` with no sort.
  let duplicateRejected = false;
  try {
    await dairySettingsService.createSettings({ fefoWarningDays: 10 });
  } catch (err) {
    duplicateRejected = true;
  }
  check('2. a second settings document is refused', duplicateRejected);
  check('2b. exactly one document exists', (await DairySettings.countDocuments()) === 1);

  console.log('\nDairy settings — form coercion');
  console.log('--------------------------------------------------');

  // 3. the admin panel posts urlencoded, so numbers arrive as strings and untouched
  //    fields arrive as ''.
  const asString = await dairySettingsService.updateSettings(created.id, {
    fefoWarningDays: '60',
    selfRegistration: 'false',
  });
  check("3. a numeric string '60' is stored as 60", asString.fefoWarningDays === 60, `got ${asString.fefoWarningDays}`);
  check('3b. the string "false" is stored as boolean false', asString.selfRegistration === false);

  // 4. '' means "not supplied". It must NOT become 0, which would classify every
  //    licence as expiring immediately.
  const empty = await dairySettingsService.updateSettings(created.id, { fefoWarningDays: '' });
  check("4. an empty value falls back to 30 rather than becoming 0", empty.fefoWarningDays === 30, `got ${empty.fefoWarningDays}`);

  const garbage = await dairySettingsService.updateSettings(created.id, { fefoWarningDays: 'abc' });
  check("4b. a non-numeric value falls back to 30", garbage.fefoWarningDays === 30, `got ${garbage.fefoWarningDays}`);

  // 5. clamped, not rejected. 0 would make the setting destructive; 10000 days is not
  //    a warning.
  const tooSmall = await dairySettingsService.updateSettings(created.id, { fefoWarningDays: 0 });
  check('5. 0 is clamped up to 1', tooSmall.fefoWarningDays === 1, `got ${tooSmall.fefoWarningDays}`);

  const tooBig = await dairySettingsService.updateSettings(created.id, { fefoWarningDays: 10000 });
  check('5b. 10000 is clamped down to 365', tooBig.fefoWarningDays === 365, `got ${tooBig.fefoWarningDays}`);

  // 6. create-on-update. The screen loads with defaults and the operator presses save;
  //    that must work whether or not anyone opened the tab before.
  await DairySettings.deleteMany({});
  const createdOnUpdate = await dairySettingsService.updateSettings('000000000000000000000000', {
    fefoWarningDays: 21,
  });
  check('6. update on an unsaved document creates it', createdOnUpdate.fefoWarningDays === 21);
  check('6b. and there is still exactly one', (await DairySettings.countDocuments()) === 1);

  console.log('\nDairy settings — the wiring');
  console.log('--------------------------------------------------');

  // 8. the boundary itself moves. `deriveStatus` takes the window explicitly, so this
  //    is checkable without touching the database.
  const in45Days = { fssai: { licenceNumber: 'X', expiresAt: inDays(45) } };
  check(
    '8. a licence 45 days out is valid with a 30 day window',
    complianceService.deriveStatus(in45Days, 30) === 'valid'
  );
  check(
    '8b. and expiring with a 60 day window',
    complianceService.deriveStatus(in45Days, 60) === 'expiring',
    complianceService.deriveStatus(in45Days, 60)
  );

  // 11. purity preserved. Reading the stored status must never influence the result,
  //     which is what lets a stale cache be detected instead of trusted.
  const contradictory = { status: 'expired', fssai: { licenceNumber: 'X', expiresAt: inDays(45) } };
  check(
    '11. deriveStatus ignores any stored status',
    complianceService.deriveStatus(contradictory, 30) === 'valid',
    complianceService.deriveStatus(contradictory, 30)
  );
  check(
    '11b. and still defaults to 30 when no window is passed',
    complianceService.deriveStatus(in45Days) === 'valid'
  );

  // 10. end-to-end against a real record, which is the only way to prove the value
  //     actually reaches the service rather than just the pure function.
  const suffix = Date.now().toString().slice(-6);
  const owner = await User.create({
    firstName: 'DairySettings', lastName: 'Verify', countryCode: '+91',
    mobile: Number(`978${Date.now().toString().slice(-7)}`),
    email: `dsettings${Date.now()}@dairy.local`,
    password: 'Test@12345', role: 'dairyPartner', status: true, locale: 'en',
  });
  await Wallet.create({ holderId: owner._id, balance: 0, status: true });

  // `driverPayoutMode` must be set explicitly. The schema default is `platform_pays`
  // (restaurant still has platform riders), and a dairy outlet left on the default
  // trips `verify.dairy.pool.retirement`, which asserts the whole collection. That
  // suite runs last in the runner, so a fixture left here would surface as a failure
  // in a suite that has nothing to do with settings.
  const business = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Settings Outlet ${suffix}`,
    owner: owner._id, ownDeliveryPartner: true, verified: true, status: true,
    driverPayoutMode: 'business_pays',
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
  });

  const compliance = await complianceService.getOrCreateCompliance(business.id);
  compliance.fssai = { licenceNumber: `FSSAI${suffix}`, issuedAt: inDays(-100), expiresAt: inDays(45) };
  await compliance.save();

  const sixty = await dairySettingsService.updateSettings((await DairySettings.findOne()).id, {
    fefoWarningDays: 60,
  });
  check('10. the setting persisted', sixty.fefoWarningDays === 60);

  const narrowSummary = await complianceService.getSummary(business.id);
  check(
    '10b. getSummary reports expiring once the window covers the licence',
    narrowSummary.status === 'expiring',
    narrowSummary.status
  );
  check(
    '10c. and the summary flags the cached status as stale',
    narrowSummary.cacheFresh === false,
    `cacheFresh=${narrowSummary.cacheFresh}`
  );

  // 9. every surface that used to read the hardcoded constant must now follow the
  //    setting. `listExpiring` with no `days` uses the configured window.
  const expiringList = await complianceService.listExpiring();
  check(
    '9. listExpiring uses the configured window when days is not given',
    expiringList.some((row) => String(row.business && row.business._id) === String(business.id)),
    `${expiringList.length} row(s) returned`
  );
  check(
    '9b. and reports the live status beside the cached one',
    expiringList.every((row) => 'liveStatus' in row && 'cacheFresh' in row)
  );

  await complianceService.refreshAllStatuses();
  const rederived = await DairyCompliance.findById(compliance.id);
  check(
    '9c. refreshAllStatuses rewrote the stale cache to expiring',
    rederived.status === 'expiring',
    rederived.status
  );

  // Widening the window back out must restore `valid`, proving the setting is live in
  // both directions and not cached at module load.
  await dairySettingsService.updateSettings((await DairySettings.findOne()).id, {
    fefoWarningDays: 30,
  });
  const widenedSummary = await complianceService.getSummary(business.id);
  check(
    '9d. widening the window back to 30 restores valid, so the value is not memoised',
    widenedSummary.status === 'valid',
    widenedSummary.status
  );

  // 15. skipDate enforces the configured cutoff ------------------------------
  // The subscription suite proves the schedule logic; this proves the setting
  // actually reaches it. A skip for tomorrow must be rejected while the window
  // is in the cutoff, and accepted once the window is disabled.
  const cat = await DairyCategory.create({ key: `milk_s${suffix}`, name: `Milk ${suffix}`, sortOrder: 1 });
  const subCat = await DairySubCategory.create({ category: cat._id, name: `Toned ${suffix}` });
  const prod = await DairyProduct.create({ business: business._id, category: cat._id, subCategory: subCat._id, name: `Skip Milk ${suffix}` });
  const sku = await DairySku.create({
    business: business._id, product: prod._id, category: cat._id, subCategory: subCat._id,
    name: `Skip Milk ${suffix}`, packSize: { value: '1 Litre', unit: 'litre', quantity: 1 },
    price: 60, availableQty: 1000, inStock: true, status: true,
  });
  const sub = await DairySubscription.create({
    subscriptionNo: 999001, user: owner._id, business: business._id, sku: sku._id,
    quantity: 1, scheduleType: 'daily', startDate: new Date(), deliverySlot: { startTime: '06:00', endTime: '08:00' },
    unitPrice: 60, status: 'active',
  });

  const tomorrow = new Date(Date.now() + DAY);
  await dairySettingsService.updateSettings((await DairySettings.findOne()).id, {
    subscriptionSkipCutoffHours: 24, // big enough that tomorrow's 06:00 is always inside the cutoff
  });

  let rejected = false;
  try {
    await subscriptionService.skipDate(sub._id, tomorrow, { actor: owner._id, reason: 'travelling' });
  } catch (err) {
    rejected = true;
  }
  check('15. skipDate rejects a skip inside the cutoff window', rejected);

  await dairySettingsService.updateSettings((await DairySettings.findOne()).id, {
    subscriptionSkipCutoffHours: 0, // cutoff at the slot itself -> tomorrow is still skippable
  });
  let allowed = true;
  try {
    await subscriptionService.skipDate(sub._id, tomorrow, { actor: owner._id, reason: 'travelling' });
  } catch (err) {
    allowed = false;
  }
  check('15b. and allows the same skip once the cutoff is disabled', allowed);

  await DairySubscription.deleteMany({ _id: sub._id });
  await DairySku.deleteMany({ _id: sku._id });
  await DairyProduct.deleteMany({ _id: prod._id });
  await DairySubCategory.deleteMany({ _id: subCat._id });
  await DairyCategory.deleteMany({ _id: cat._id });
  await dairySettingsService.updateSettings((await DairySettings.findOne()).id, {
    subscriptionSkipCutoffHours: 9,
  });

  console.log('\nDairy settings — failure handling');
  console.log('--------------------------------------------------');

  // 12. compliance sits on dashboard read paths, so a settings failure must not take
  //     the page down. The resolver swallows and falls back.
  const servicePath = path.join(__dirname, '..', 'src', 'services', 'dairy.settings.service.js');
  const original = fs.readFileSync(servicePath, 'utf8');
  fs.writeFileSync(
    servicePath,
    original.replace(
      "const { DairySettings } = require('../models');",
      "const { DairySettings } = require('../models');\nthrow new Error('simulated settings failure');"
    ),
    'utf8'
  );

  // Bust the require cache so the module reloads with the injected throw.
  delete require.cache[require.resolve('../src/services/index.js')];
  delete require.cache[require.resolve('../src/services/dairy.settings.service.js')];

  let swallowed = false;
  try {
    await complianceService.getSummary(business.id);
    swallowed = true;
  } catch (err) {
    swallowed = false;
  }
  fs.writeFileSync(servicePath, original, 'utf8');
  delete require.cache[require.resolve('../src/services/index.js')];
  delete require.cache[require.resolve('../src/services/dairy.settings.service.js')];

  check('12. a broken settings service falls back instead of throwing', swallowed);

  // After restoring, the real service must work again.
  const recovered = await complianceService.getSummary(business.id);
  check('12b. and reads normally once it is restored', typeof recovered.status === 'string');

  console.log('\nDairy settings — no dead switches');
  console.log('--------------------------------------------------');

  // 13/14. The actual promise. `selfRegistration` is stored and deliberately not
  //       enforced, so it is allowlisted with a reason rather than silently passing —
  //       the point is that adding an unread field trips the check.
  const ALLOWED_UNREAD = new Set([
    // Stored for parity with the five other verticals. Dairy outlet registration is
    // always open today; wiring this means changing the partner registration flow,
    // which is its own piece of work.
    'selfRegistration',
  ]);

  const fields = modelFields();
  check('13. the model declares fields', fields.length > 0, `${fields.length} field(s)`);

  // Recursive walk. A non-recursive read would miss everything under
  // `src/modules/dairy/`, which is exactly where the reader lives.
  const collectJs = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectJs(full);
      return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
    });

  // Files that only define or persist the setting. A field is "read" only where it is
  // *consumed*, otherwise every field would trivially match by virtue of being
  // declared in the model or assigned in its own service.
  const isPlumbing = (file) =>
    /dairy\.settings\.(model|service|validation|controller)\.js$/.test(file);

  const consumers = collectJs(path.join(__dirname, '..', 'src'))
    .filter((file) => !isPlumbing(file))
    .map((file) => fs.readFileSync(file, 'utf8'));

  // A field counts as read if a consumer names it, OR names its accessor. The common
  // case is the latter: `dairy.compliance.service` calls `getFefoWarningDays()` rather
  // than touching the field, which is the better shape anyway — the reader should not
  // need to know how the value is stored.
  const isRead = (field, text) =>
    new RegExp(`\\b${field}\\b`).test(text) ||
    new RegExp(`get${field[0].toUpperCase()}${field.slice(1)}\\s*\\(`).test(text);

  const unread = fields.filter(
    (field) => !ALLOWED_UNREAD.has(field) && !consumers.some((text) => isRead(field, text))
  );

  check(
    '14. every field is read by code, or explicitly allowlisted as not-yet-enforced',
    unread.length === 0,
    unread.length ? `unread: ${unread.join(', ')}` : ''
  );

  const stillAllowlisted = [...ALLOWED_UNREAD].filter((field) => !fields.includes(field));
  check(
    '14b. the not-yet-enforced allowlist matches the model (no stale entries)',
    stillAllowlisted.length === 0,
    stillAllowlisted.length ? `stale: ${stillAllowlisted.join(', ')}` : ''
  );

  // Cleanup. This suite's whole purpose is reading one settings document, so unlike
  // the feature suites there is nothing to leave behind: the fixtures are only ever
  // read by `getSummary`, and keeping them would add a dairy outlet per run to a
  // database other suites assert against.
  await DairyCompliance.deleteMany({ business: business._id });
  await Business.deleteMany({ _id: business._id });
  await Wallet.deleteMany({ holderId: owner._id });
  await User.deleteMany({ _id: owner._id });

  const leaked = await Business.countDocuments({ name: /^Settings Outlet / });
  check('15. no fixture outlet is left behind', leaked === 0, `${leaked} left`);

  console.log('\nDairy settings — summary');
  console.log('--------------------------------------------------');
  if (failures > 0) {
    console.log(`  ${failures} check(s) FAILED\n`);
  } else {
    console.log('  all checks passed\n');
  }

  await mongoose.disconnect();
  process.exit(failures > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error('\nverify.dairy.settings.js threw:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});