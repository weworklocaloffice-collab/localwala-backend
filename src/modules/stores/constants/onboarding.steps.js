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
 * ONBOARDING WIZARD STEPS — the single source of truth.
 *
 * ## Why this lives in its own file
 *
 * Three things need to agree on how many steps there are:
 *
 *   1. `StoreOnboarding.currentStep`, which needs an upper bound for its validator
 *   2. `stores.onboarding.service.STEPS`, which drives completeness and the labels
 *   3. the Flutter wizard, which renders one screen per step
 *
 * When the count lived only in the service, the model's bound was hand-written as
 * `max: 8` while the array held six entries. Nothing failed loudly: a client could park
 * `currentStep` at 7, the server would accept it, and the app would render nothing for
 * it. The mismatch survived because there was no test asserting that the bound matches
 * the array length.
 *
 * The model cannot simply import the service to read `STEPS.length` — the service
 * imports the models, so that is a require cycle. This file is the shared leaf both sides
 * depend on, which breaks the cycle and gives one place to change the count.
 *
 * `verify.stores.onboarding.steps.js` asserts the model's bound equals
 * `STEPS.length - 1`, so this cannot drift again.
 *
 * ## Six screens, nine compliance sections
 *
 * The application is a nine-section regulatory document. The partner fills in six
 * SCREENS, because a nine-screen wizard for a shop owner is a nine-screen wizard they
 * abandon. The grouping is one-to-one below.
 *
 * `sections` is present for the review screen and the admin record, which quote the
 * section names the paperwork uses. `steps` — the wizard index — is what `currentStep`
 * indexes. Keeping both explicit is what stops someone later from renumbering the
 * screens and silently changing which regulatory section each one means.
 */

/**
 * The wizard, in order. Index === `currentStep`.
 *
 * `key` names the top-level field group on StoreOnboarding that this screen collects, so
 * `STEP_REQUIREMENTS` in the service can be written as a flat map keyed by these.
 */
const STEPS = [
  {
    key: 'businessInfo',
    label: 'Business information',
    sections: ['business_registration', 'gst_registration'],
  },
  {
    key: 'storeInfo',
    label: 'Store information',
    sections: ['trade_name', 'trade_licence'],
  },
  {
    key: 'ownerInfo',
    label: 'Owner information',
    // Identity and contact are ONE section on the paperwork. Splitting them would make
    // ten sections, which is not the document a partner is signing.
    sections: ['owner_details'],
  },
  {
    key: 'location',
    label: 'Location',
    sections: ['registered_address', 'service_area'],
  },
  {
    key: 'documents',
    label: 'Documents',
    sections: ['supporting_documents'],
  },
  {
    key: 'deliveryConfig',
    label: 'Delivery configuration',
    sections: ['delivery_terms'],
  },
];

/** The highest legal value of `currentStep`. Derived, never hand-written. */
const LAST_STEP_INDEX = STEPS.length - 1;

/** Every `key`, for building the STEP_REQUIREMENTS completeness map. */
const STEP_KEYS = STEPS.map((step) => step.key);

/** Look a step up by its key. Returns null for an unknown key. */
const findStep = (key) => STEPS.find((step) => step.key === key) || null;

/**
 * The label for a cursor, or null when the cursor is out of range.
 *
 * Out-of-range returns null rather than a fallback label on purpose: a caller rendering
 * "Step 7 of 6" tells the applicant the record is corrupt, which is true and better
 * than silently showing the last step as if it were the seventh.
 */
const labelForStep = (index) => {
  const step = STEPS[index];
  return step ? step.label : null;
};

module.exports = {
  STEPS,
  STEP_KEYS,
  LAST_STEP_INDEX,
  findStep,
  labelForStep,
};