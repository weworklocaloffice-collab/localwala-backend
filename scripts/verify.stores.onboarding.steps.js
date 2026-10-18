/**
 * LocalWala — Local Commerce & Delivery Platform
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
 * verify.stores.onboarding.steps.js
 *
 * Guards the ONE invariant that three separate files depend on: the number of wizard
 * steps, and the bound the model enforces on `currentStep`.
 *
 * ## The bug this exists to prevent
 *
 * `StoreOnboarding.currentStep` declared `max: 8` while `STEPS` held six entries. The
 * model accepted `currentStep: 7`, the service had no step 7, and the Flutter wizard had
 * nothing to render for it. Nothing threw. The failure was a wizard that silently stops
 * advancing on a step nobody can see.
 *
 * A hand-written number in a schema, with the real count living in another file, is
 * exactly the shape of defect that survives code review and reaches production. So the
 * count now lives in `constants/onboarding.steps.js`, both sides import it, and this
 * suite asserts the two still agree.
 *
 * Run: node scripts/verify.stores.onboarding.steps.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const {
  STEPS,
  STEP_KEYS,
  LAST_STEP_INDEX,
  findStep,
  labelForStep,
} = require('../src/modules/stores/constants/onboarding.steps');

const { StoreOnboarding } = require('../src/models');
const onboardingService = require('../src/modules/stores/services/stores.onboarding.service');

let pass = 0;
let failures = 0;

const ck = (label, condition, detail) => {
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const run = async () => {
  console.log('\n=== onboarding step count invariants ===\n');

  // ---- 1. the count ----------------------------------------------------------
  console.log('--- the step count ---');

  ck('1. there are six wizard screens', STEPS.length === 6, STEPS.length + ' steps');
  ck('1b. LAST_STEP_INDEX is derived, not hand-written', LAST_STEP_INDEX === STEPS.length - 1, LAST_STEP_INDEX);

  // ---- 2. the model bound must equal the count -------------------------------
  console.log('--- the model bound agrees with the count ---');

  const path = StoreOnboarding.schema.path('currentStep');
  const modelMax = path.options.max;
  const modelMin = path.options.min;

  ck('2. currentStep.max === LAST_STEP_INDEX', modelMax === LAST_STEP_INDEX, `max=${modelMax} steps=${STEPS.length}`);
  ck('2b. currentStep.min is 0', modelMin === 0, modelMin);
  ck(
    '2c. THE REGRESSION: max is not a stale hard-coded 8',
    modelMax !== 8 || STEPS.length === 9,
    'max is still 8, so the original bug is back'
  );

  // A cursor inside the range must NOT be rejected.
  //
  // Asserted per-path, not per-document: `user` is required, so a bare
  // `new StoreOnboarding({ currentStep: 5 })` legitimately fails validation for an
  // unrelated reason and `!err` would be the wrong question to ask.
  const inside = new StoreOnboarding({ currentStep: LAST_STEP_INDEX });
  const insideErr = inside.validateSync();
  ck(
    '2d. the last legal cursor is accepted',
    !(insideErr && insideErr.errors.currentStep),
    insideErr && insideErr.errors.currentStep && insideErr.errors.currentStep.message
  );

  // A cursor past the end must be REJECTED, which is exactly what `max: 8` failed to do.
  const past = new StoreOnboarding({ currentStep: LAST_STEP_INDEX + 1 });
  const pastErr = past.validateSync();
  ck(
    '2e. a cursor past the last screen is REJECTED',
    !!(pastErr && pastErr.errors.currentStep),
    'accepted an out-of-range cursor'
  );

  const farPast = new StoreOnboarding({ currentStep: 8 });
  const farErr = farPast.validateSync();
  ck('2f. currentStep: 8 is rejected (the original defect)', !!(farErr && farErr.errors.currentStep));

  const negative = new StoreOnboarding({ currentStep: -1 });
  const negErr = negative.validateSync();
  ck('2g. a negative cursor is rejected', !!(negErr && negErr.errors.currentStep));

  // ---- 3. shape of each step -------------------------------------------------
  console.log('--- step shape ---');

  ck('3. every step has a key', STEPS.every((s) => typeof s.key === 'string' && s.key.length));
  ck('3b. every step has a label', STEPS.every((s) => typeof s.label === 'string' && s.label.length));
  ck('3c. every step declares its compliance sections', STEPS.every((s) => Array.isArray(s.sections) && s.sections.length));

  const keys = STEPS.map((s) => s.key);
  ck('3d. step keys are unique', new Set(keys).size === keys.length, keys.join(','));
  ck('3e. STEP_KEYS mirrors STEPS', STEP_KEYS.length === STEPS.length && STEP_KEYS.every((k, i) => k === keys[i]));

  // ---- 4. every step maps to a REAL field group on the model -----------------
  //
  // A step whose key is not a schema path is a screen that can never be completed: the
  // completeness check reads a field that does not exist, and the wizard loops forever on
  // a step the applicant can fill in but the server never marks done.
  console.log('--- every step maps to a real schema path ---');

  // A step whose key is not a field group on the model is a screen the applicant can fill
  // in but the server never marks complete, so the wizard loops forever on it.
  //
  // Field groups are declared two ways in this schema, and both must pass:
  //   - nested objects (businessInfo, location, ...) are FLATTENED into dotted paths
  //     like 'businessInfo.legalName', so there is no top-level path for the group
  //   - documents is a real top-level Array path
  const allPaths = Object.keys(StoreOnboarding.schema.paths);

  for (const key of keys) {
    const isTopLevel = !!StoreOnboarding.schema.path(key);
    const hasNested = allPaths.some((p) => p.startsWith(key + '.'));

    ck(
      '4. StoreOnboarding.' + key + ' exists as a field group',
      isTopLevel || hasNested,
      'neither a top-level path nor any nested subpath'
    );
  }

  // ---- 5. the service uses the SAME array ------------------------------------
  console.log('--- the service reads the shared constant ---');

  ck('5. the service exports the shared STEPS', Array.isArray(onboardingService.STEPS));
  ck(
    '5b. the service STEPS are the same objects as the constants file',
    onboardingService.STEPS === STEPS,
    'the service still declares its own copy'
  );

  // ---- 6. lookups ------------------------------------------------------------
  console.log('--- lookups ---');

  ck('6. findStep returns a step by key', findStep('location') && findStep('location').label === 'Location');
  ck('6b. findStep returns null for an unknown key', findStep('nonsense') === null);
  ck('6c. labelForStep resolves index 0', labelForStep(0) === STEPS[0].label);
  ck('6d. labelForStep resolves the last index', labelForStep(LAST_STEP_INDEX) === STEPS[LAST_STEP_INDEX].label);
  ck(
    '6e. labelForStep returns NULL out of range, not a wrong label',
    labelForStep(LAST_STEP_INDEX + 1) === null,
    String(labelForStep(LAST_STEP_INDEX + 1))
  );

  // ---- 7. the compliance sections cover the nine regulatory sections ---------
  //
  // Six screens exist because the partner fills in one form. The PAPERWORK they
  // produce is still nine sections, and the admin review screen quotes them. If a
  // section is dropped here it silently disappears from the review record.
  console.log('--- compliance section coverage ---');

  const allSections = STEPS.flatMap((s) => s.sections);
  ck('7. the six screens cover nine compliance sections', allSections.length === 9, allSections.length + ' sections');
  ck('7b. no section is claimed by two screens', new Set(allSections).size === allSections.length, allSections.join(','));

  console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
  if (failures === 0) {
    console.log('ONBOARDING STEP COUNT IS CONSISTENT');
  } else {
    console.log(failures + ' STEP-COUNT CHECK(S) FAILED');
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('steps suite could not run:', error.message);
    process.exit(1);
  }
})();