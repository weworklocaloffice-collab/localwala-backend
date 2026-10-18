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
 * verify.stores.onboarding.js — the registration lifecycle, tested against the service.
 *
 * Run: node scripts/verify.stores.onboarding.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { City, Locality, StoreOnboarding } = require('../src/models');
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
  console.log('\n=== onboarding lifecycle ===\n');

  const stamp = Date.now();
  const owner = new mongoose.Types.ObjectId();
  const city = await City.create({ name: 'Onb City ' + stamp, image: 'x.png', location: { type: 'Point', coordinates: [78.4, 17.4] }, slug: 'onb-' + stamp });
  const locality = await Locality.create({ name: 'Onb Locality ' + stamp, city: city._id, location: { type: 'Point', coordinates: [78.41, 17.41] } });

  const completePatch = {
    businessInfo: { legalName: 'Onb Co', businessType: 'proprietorship' },
    storeInfo: { name: 'Onb Store', categories: [new mongoose.Types.ObjectId()] },
    ownerInfo: { name: 'Own', mobile: '9000000000', relation: 'owner' },
    location: {
      city: city._id,
      locality: locality._id,
      geo: { type: 'Point', coordinates: [78.44, 17.44] },
    },
    documents: [new mongoose.Types.ObjectId()],
    deliveryConfig: { radiusKm: 5, minimumOrder: 150, deliveryFee: 40 },
  };

  // ---- 1. getOrCreateDraft is resumable --------------------------------------
  const first = await onboardingService.getOrCreateDraft(owner);
  const again = await onboardingService.getOrCreateDraft(owner);
  ck('1. the same draft is returned, not a new empty one', String(first._id) === String(again._id));

  // ---- 2. incomplete submit is refused and names what is missing -------------
  try {
    await onboardingService.submit(owner, { _id: owner });
    ck('2. a blank draft cannot be submitted', false, 'submit succeeded on an empty draft');
  } catch (e) {
    ck('2. a blank draft cannot be submitted', e.statusCode === 422 && /APPLICATION_INCOMPLETE/.test(e.message), `${e.statusCode} ${e.message}`);
  }

  // ---- 3. a draft saved in parts is resumable and stays editable --------------
  await onboardingService.saveDraft(owner, { businessInfo: completePatch.businessInfo });
  const midway = await onboardingService.getOrCreateDraft(owner);
  ck('3. businessInfo persists from a partial save', midway.businessInfo.legalName === 'Onb Co', midway.businessInfo && midway.businessInfo.legalName);
  ck('3b. the partial draft is still incomplete', Array.isArray(midway.incompleteSteps) && midway.incompleteSteps.length > 0, JSON.stringify(midway.incompleteSteps));

  // ---- 4. money in deliveryConfig round-trips rupees <-> paise ---------------
  console.log('--- deliveryConfig money ---');

  const saved = await onboardingService.saveDraft(owner, { deliveryConfig: completePatch.deliveryConfig });
  ck('4. the draft doc reads minimumOrder back as rupees (getter applies)', saved.deliveryConfig.minimumOrder === 150, saved.deliveryConfig.minimumOrder);
  const raw = await StoreOnboarding.findById(saved._id).lean();
  ck('4b. stored raw is paise', raw.deliveryConfig.minimumOrder === 15000, raw.deliveryConfig.minimumOrder);

  // ---- 5. completing every step lets it submit -------------------------------
  const completeDraft = await onboardingService.saveDraft(owner, completePatch);
  ck('5. a complete draft has no incomplete steps', completeDraft.incompleteSteps.length === 0, JSON.stringify(completeDraft.incompleteSteps));

  const submitted = await onboardingService.submit(owner, { _id: owner });
  ck('5b. submit flips the draft to submitted', submitted.status === 'submitted', submitted.status);
  ck('5c. submittedAt is set by the server', !!submitted.submittedAt, String(submitted.submittedAt));

  // ---- 6. edits and re-submits are blocked after submit ----------------------
  try {
    await onboardingService.saveDraft(owner, { businessInfo: { legalName: 'Changed' } });
    ck('6. a submitted application is not editable', false, 'saveDraft succeeded after submit');
  } catch (e) {
    ck('6. a submitted application is not editable', e.statusCode === 409, `${e.statusCode} ${e.message}`);
  }

  // ---- 7. the admin read converts money back to rupees -------------------------
  console.log('--- admin read ---');

  const one = await onboardingService.getApplication(submitted._id);
  ck('7. getApplication returns ONE document by id', !!one._id && String(one._id) === String(submitted._id));
  ck('7b. getApplication deliveryConfig is rupees, not paise', one.deliveryConfig.minimumOrder === 150, one.deliveryConfig.minimumOrder);
  ck('7c. hasLocationGeo reflects a usable pin', one.hasLocationGeo === true, one.hasLocationGeo);

  let badId = 'ok';
  try {
    await onboardingService.getApplication(new mongoose.Types.ObjectId());
    badId = 'returned';
  } catch (e) {
    badId = e.statusCode === 404 ? '404' : String(e.message);
  }
  ck('7d. an unknown id is a 404, not a wrong applicant', badId === '404', badId);

  // ---- 8. approve refuses anything that is not under_review ------------------
  try {
    await onboardingService.approveAndCommit(submitted._id, { _id: owner });
    ck('8. approved cannot skip under_review', false, 'approved a submitted application');
  } catch (e) {
    ck('8. approve is gated on under_review', e.statusCode === 409, `${e.statusCode} ${e.message}`);
  }

  // ---- 9. reviewer move: submitted -> under_review -----------------------------
  const reviewed = await onboardingService.startReview(submitted._id, { _id: owner });
  ck('9. startReview moves submitted to under_review', reviewed.status === 'under_review', reviewed.status);
  try {
    await onboardingService.saveDraft(owner, { businessInfo: { legalName: 'Backdoor' } });
    ck('9b. under_review is not editable either', false, 'saveDraft succeeded after review');
  } catch (e) {
    ck('9b. under_review is not editable either', e.statusCode === 409, `${e.statusCode}`);
  }

  // ---- cleanup -----------------------------------------------------------------
  await StoreOnboarding.deleteMany({ owner });
  await Locality.deleteOne({ _id: locality._id });
  await City.deleteOne({ _id: city._id });

  console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
  if (failures === 0) {
    console.log('ALL ONBOARDING CHECKS PASSED');
  } else {
    console.log(failures + ' ONBOARDING CHECK(S) FAILED');
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('onboarding suite could not run:', error.message);
    process.exit(1);
  }
})();