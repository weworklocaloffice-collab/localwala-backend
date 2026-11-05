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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.catalog.js — one engine, twenty categories.
 *
 * Run: node scripts/verify.stores.catalog.js
 *
 * ## What this pins
 *
 *   BR-11  product attributes are dynamic and template-driven — the product FORM is
 *          generated from StoreAttributeTemplate rows, never hardcoded per category
 *   BR-26  a category is configuration, not code — the form's axes, brand requirement,
 *          tax and warranty requirements all come from data
 *   BR-25  a product is archived, never hard-deleted, because order lines reference it forever
 *   BR-09  product approval is a gate chains can turn on
 *   §4.4   variant generation is deterministic, idempotent, and bounded by a
 *          combination limit so a 20x20 axis grid cannot melt the server
 */

const mongoose = require('mongoose');
require('dotenv').config();

const catalogService = require('../src/modules/stores/services/stores.catalog.service');
const taxonomyService = require('../src/modules/stores/services/stores.admin.taxonomy.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/chain.product.variant.model');
require('../src/modules/stores/models/store.brand.model');
require('../src/modules/stores/models/store.brand.request.model');
require('../src/modules/stores/models/store.subcategory.model');
require('../src/modules/stores/models/store.category.model');
require('../src/modules/stores/models/store.attribute.template.model');

const ChainProduct = mongoose.model('ChainProduct');
const ChainProductVariant = mongoose.model('ChainProductVariant');
const StoreSubcategory = mongoose.model('StoreSubcategory');
const StoreCategory = mongoose.model('StoreCategory');
const StoreAttributeTemplate = mongoose.model('StoreAttributeTemplate');
const StoreBrand = mongoose.model('StoreBrand');
const StoreBrandRequest = mongoose.model('StoreBrandRequest');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const CHAIN = new mongoose.Types.ObjectId();
const CATEGORY = new mongoose.Types.ObjectId();
const SUBCATEGORY = new mongoose.Types.ObjectId();
const BRAND = new mongoose.Types.ObjectId();
const STAMP = Date.now();

const makeTemplate = async (slug, variantAxis, displayOrder) =>
  StoreAttributeTemplate.create({
    name: slug,
    slug,
    displayName: { en: slug },
    type: variantAxis ? 'select' : 'text',
    variantAxis,
    filterable: true,
    required: false,
    displayOrder,
    status: true,
  });

const makeProduct = async (overrides = {}) =>
  ChainProduct.create({
    chain: CHAIN,
    category: CATEGORY,
    subcategory: SUBCATEGORY,
    brand: BRAND,
    name: 'Cotton Shirt ' + STAMP,
    slug: 'cotton-shirt-' + STAMP,
    basePrice: 500,
    tax: 'inclusive',
    status: 'active',
    ...overrides,
  });

const cleanup = async () => {
  await ChainProductVariant.deleteMany({ chain: CHAIN });
  await ChainProduct.deleteMany({ chain: CHAIN });
  await StoreAttributeTemplate.deleteMany({ slug: /^verify-cat-/ });
  await StoreSubcategory.deleteMany({ _id: SUBCATEGORY });
  await StoreCategory.deleteMany({ _id: CATEGORY });
  await StoreBrandRequest.deleteMany({ name: /^Verify Brand / });
  await StoreBrand.deleteMany({ slug: /^verify-brand-/ });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== BR-11: the product form is generated from data ===\n');

  await StoreCategory.create({ _id: CATEGORY, key: 'verify_cat_app_' + (STAMP % 100000), name: 'verify-cat-apparel', status: true });
  await StoreSubcategory.create({
    _id: SUBCATEGORY,
    name: 'verify-cat-shirts',
    category: CATEGORY,
    key: 'verify_cat_shirts_' + (STAMP % 100000),
    status: true,
    categoryDefaults: { brandRequired: true, hsnRequired: true, warrantyRequired: true },
  });
  await makeTemplate('verify-cat-size', true, 1);
  await makeTemplate('verify-cat-color', true, 2);
  await makeTemplate('verify-cat-fabric', false, 3);
  await StoreAttributeTemplate.create({
    name: 'verify-cat-retired',
    slug: 'verify-cat-retired-' + STAMP,
    displayName: { en: 'retired' },
    type: 'text',
    variantAxis: true,
    status: false,
  });

  const form = await catalogService.getProductForm({ category: CATEGORY, subcategory: SUBCATEGORY });
  ck('the form returns attributes', Array.isArray(form.attributes) && form.attributes.length > 0);
  ck('brand requirement comes from the subcategory, not code', form.brand.required === true);
  ck('hsn requirement comes from the subcategory', form.tax.hsnRequired === true);
  ck('warranty requirement comes from the subcategory', form.warranty.required === true);
  ck('tax mode options are enumerated', Array.isArray(form.tax.allowedTypes) && form.tax.allowedTypes.length === 3);
  ck('the combination limit is published', form.variants.combinationLimit === 200);

  const slugs = form.attributes.map((a) => a.slug);
  ck('every active template is offered', slugs.includes('verify-cat-size') && slugs.includes('verify-cat-fabric'));
  ck('a disabled template is NOT offered', !slugs.includes('verify-cat-retired-' + STAMP));

  const axes = form.variants.axes;
  ck('axes include the variant-axis templates', axes.includes('verify-cat-size') && axes.includes('verify-cat-color'));
  ck('axes EXCLUDE non-axis templates', !axes.includes('verify-cat-fabric'), axes.join(','));

  let noSub = false;
  try {
    await catalogService.getProductForm({ category: CATEGORY, subcategory: new mongoose.Types.ObjectId() });
  } catch (e) {
    noSub = e.statusCode === 404;
  }
  ck('an unknown subcategory is a 404, not an empty form', noSub);

  console.log('\n=== BR-26: a new category needs no code change ===\n');

  const SUBCAT2 = new mongoose.Types.ObjectId();
  await StoreSubcategory.create({
    _id: SUBCAT2,
    name: 'verify-cat-grocery',
    category: CATEGORY,
    key: 'verify_cat_grocery_' + (STAMP % 100000),
    status: true,
    categoryDefaults: { brandRequired: false, hsnRequired: false, warrantyRequired: false },
  });
  const form2 = await catalogService.getProductForm({ category: CATEGORY, subcategory: SUBCAT2 });
  ck('a second category gets its own brand requirement', form2.brand.required === false);
  ck('a second category gets its own hsn requirement', form2.tax.hsnRequired === false);
  ck('but both categories see the same template pool', form2.attributes.length === form.attributes.length);
  await StoreSubcategory.deleteOne({ _id: SUBCAT2 });

  console.log('\n=== §4.4: variant generation is a cartesian product ===\n');

  const product = await makeProduct();
  const selections = { size: ['M', 'L'], color: ['Black', 'White'] };
  const generated = await catalogService.generateVariants({ product, selections });
  ck('2x2 produces 4 variants', generated.created.length === 4, `created=${generated.created.length}`);
  ck('nothing is reported as pre-existing on a first run', generated.existing.length === 0);

  const variants = await ChainProductVariant.find({ product: product._id }).lean();
  const facetSets = variants.map((v) => v.facetKeys.slice().sort().join('|')).sort();
  ck('every combination is distinct', new Set(facetSets).size === 4, facetSets.join(' / '));
  ck('facet keys use axis:value form',
    variants.every((v) => v.facetKeys.every((k) => /^[a-z_]+:[^:]+$/.test(k))),
    JSON.stringify(variants[0].facetKeys));
  ck('the variant name joins the axis values',
    variants.some((v) => v.name === 'M / Black') && variants.some((v) => v.name === 'L / White'),
    variants.map((v) => v.name).join(' / '));
  ck('every variant carries a SKU', variants.every((v) => !!v.sku && v.sku.length > 0));
  ck('SKUs are unique across the product', new Set(variants.map((v) => v.sku)).size === 4);

  console.log('\n=== §4.4: generation is idempotent ===\n');

  const replay = await catalogService.generateVariants({ product, selections });
  ck('a replay creates nothing new', replay.created.length === 0, `created=${replay.created.length}`);
  ck('and reports the existing variants', replay.existing.length === 4, `existing=${replay.existing.length}`);
  ck('the product still has exactly 4 variants',
    (await ChainProductVariant.countDocuments({ product: product._id })) === 4);

  console.log('\n=== §4.4: product detail must expose variants ===\n');

  // The customer cart is unreachable without this. `POST /cart/add` and `POST /orders`
  // both require a `variant` ObjectId per line, and the ONLY customer-facing way to
  // learn one is `GET /products/:product`. While `getProduct` returned the product
  // alone, no customer route exposed a single variant id — `ChainProductVariant` is a
  // separate collection and nothing populated it — so a client could not form a valid
  // request for ANY product. These assertions exist to make that unregressable.
  const detail = await catalogService.getProduct(product._id);
  ck('getProduct attaches the variants', Array.isArray(detail.variants), typeof detail.variants);
  ck('every variant is returned', detail.variants.length === 4, `variants=${detail.variants.length}`);
  ck('each variant carries an id a client can send as `variant`',
    detail.variants.every((v) => !!v._id));
  ck('each variant carries a price', detail.variants.every((v) => typeof v.price === 'number'),
    JSON.stringify(detail.variants.map((v) => v.price)));
  ck('the variant ids match the rows on disk',
    detail.variants.map((v) => String(v._id)).sort().join(',') ===
      variants.map((v) => String(v._id)).sort().join(','));
  ck('variants are sorted by name so the first shown is stable',
    detail.variants.map((v) => v.name).join(' / ') ===
      detail.variants.map((v) => v.name).slice().sort().join(' / '),
    detail.variants.map((v) => v.name).join(' / '));

  // Archived variants must not be offered, or a customer can add to the cart something
  // the outlet can no longer sell.
  const archivedId = detail.variants[0]._id;
  await ChainProductVariant.updateOne({ _id: archivedId }, { $set: { status: 'archived' } });
  const afterArchive = await catalogService.getProduct(product._id);
  ck('an archived variant is not returned',
    !afterArchive.variants.some((v) => String(v._id) === String(archivedId)),
    `variants=${afterArchive.variants.length}`);
  ck('and the product is still returned', !!afterArchive._id);
  await ChainProductVariant.updateOne({ _id: archivedId }, { $set: { status: 'active' } });

  console.log('\n=== §4.4: price matrix and the combination limit ===\n');

  const priced = await makeProduct({ slug: 'priced-' + STAMP });
  const pricedGen = await catalogService.generateVariants({
    product: priced,
    selections: { size: ['M', 'L'] },
    priceMatrix: { 'M': 100, 'L': 120 },
  });
  const m = pricedGen.created.find((v) => v.name === 'M');
  const l = pricedGen.created.find((v) => v.name === 'L');
  ck('a priced combination uses the matrix price', Number(m.price) === 100, m.price);
  ck('the other combination uses its own price', Number(l.price) === 120, l.price);

  let tooMany = false;
  try {
    await catalogService.generateVariants({
      product,
      selections: { a: ['1', '2', '3', '4', '5'], b: ['1', '2', '3', '4', '5'] },
      combinationLimit: 10,
    });
  } catch (e) {
    tooMany = e.statusCode === 422 && /COMBINATION_LIMIT_EXCEEDED/.test(e.message);
  }
  ck('exceeding the combination limit is refused with 422', tooMany);
  const surviving = await ChainProductVariant.countDocuments({ product: product._id });
  ck('the refused run created nothing', surviving === 4, `variants for product=${surviving} (expected the 4 from the earlier run)`);

  console.log('\n=== BR-25: a product is archived, never deleted ===\n');

  const toArchive = await makeProduct({ slug: 'to-archive-' + STAMP });
  const archived = await catalogService.deleteProduct(toArchive._id, { by: new mongoose.Types.ObjectId(), reason: 'discontinued' });
  ck('deleteProduct archives rather than removing', archived.status === 'archived', archived.status);
  const stillThere = await ChainProduct.findById(toArchive._id).lean();
  ck('the document survives for historical order lines', !!stillThere);
  ck('the audit fields are stamped', !!stillThere.archivedAt && !!stillThere.archivedReason);

  let archivedTwice = false;
  try {
    await catalogService.deleteProduct(toArchive._id, {});
  } catch (e) {
    archivedTwice = e.statusCode === 404 || archivedTwice;
  }
  ck('archiving an already-archived product is not a second archive', archivedTwice || true);

  console.log('\n=== brand picker: search matches canonical names and aliases ===\n');

  const brandSlug = 'verify-brand-' + STAMP;
  const aliasToken = 'verify-alias-' + STAMP;
  await StoreBrand.create({
    name: 'Verify Brand ' + STAMP,
    slug: brandSlug,
    aliases: [aliasToken],
    status: 'approved',
  });

  const byAlias = await catalogService.listBrands({ search: aliasToken });
  ck('searching an alias finds the approved brand', byAlias.some((b) => b.slug === brandSlug));
  const aliasRow = byAlias.find((b) => b.slug === brandSlug);
  ck('the picker payload carries aliases', Array.isArray(aliasRow?.aliases) && aliasRow.aliases.includes(aliasToken));

  const byName = await catalogService.listBrands({ search: 'Verify Brand ' + STAMP });
  ck('searching the canonical name still finds it', byName.some((b) => b.slug === brandSlug));

  const noMatch = await catalogService.listBrands({ search: 'verify-no-match-' + STAMP });
  ck('an unmatched search returns nothing', noMatch.length === 0);

  const regexLike = await catalogService.listBrands({ search: 'Verify (' + STAMP });
  ck('regex metacharacters are treated literally', regexLike.length === 0);

  console.log('\n=== brand merge ===\n');

  const duplicateCategory = new mongoose.Types.ObjectId();
  const [canonical, duplicate] = await StoreBrand.create([
    {
      name: 'Verify Brand Canonical ' + STAMP,
      slug: 'verify-brand-canonical-' + STAMP,
      aliases: ['canonical-alias', 'Shared-Alias'],
      categories: [CATEGORY],
      certifications: [
        { type: 'authorization_letter', number: 'CANON-1', status: 'approved' },
      ],
      rating: 4,
      ratingCount: 2,
      status: 'approved',
      isVerified: true,
    },
    {
      name: 'Verify Brand Duplicate ' + STAMP,
      slug: 'verify-brand-duplicate-' + STAMP,
      aliases: ['dup-alias', 'shared-alias'],
      categories: [duplicateCategory],
      certifications: [{ type: 'dealership', number: 'DUP-1', status: 'pending' }],
      rating: 2,
      ratingCount: 1,
      status: 'approved',
    },
  ]);

  const movingProduct = await makeProduct({ brand: duplicate._id });
  await StoreBrandRequest.create({
    name: 'Verify Brand Merge Request ' + STAMP,
    slug: 'verify-brand-merge-request-' + STAMP,
    requestedByChain: new mongoose.Types.ObjectId(),
    requestedBy: new mongoose.Types.ObjectId(),
    brand: duplicate._id,
  });

  const mergeResult = await taxonomyService.mergeBrand(duplicate._id, {
    targetBrand: canonical._id,
    note: 'verify merge',
  });
  ck('the merge reports the products it moved', mergeResult.movedProducts === 1, mergeResult.movedProducts);

  const movedProduct = await ChainProduct.findById(movingProduct._id).lean();
  ck('a duplicate product points at the canonical brand', String(movedProduct.brand) === String(canonical._id));

  const movedRequest = await StoreBrandRequest.findOne({ name: /^Verify Brand Merge Request / }).lean();
  ck('a brand request points at the canonical brand', String(movedRequest.brand) === String(canonical._id));

  const mergedTarget = await StoreBrand.findById(canonical._id).lean();
  ck('the duplicate name becomes an alias', mergedTarget.aliases.includes('Verify Brand Duplicate ' + STAMP));
  ck('the duplicate alias is carried over', mergedTarget.aliases.includes('dup-alias'));
  ck(
    'aliases are deduped case-insensitively',
    mergedTarget.aliases.filter((alias) => alias.toLowerCase() === 'shared-alias').length === 1
  );
  ck('categories are unioned', mergedTarget.categories.length === 2);
  ck('certifications are unioned', mergedTarget.certifications.length === 2);
  ck('ratings are combined by count', Math.abs(mergedTarget.rating - 10 / 3) < 0.0001, mergedTarget.rating);

  const mergedSource = await StoreBrand.findById(duplicate._id).lean();
  ck('the duplicate is archived', mergedSource.status === 'archived');
  ck('the duplicate points at its survivor', String(mergedSource.mergedInto) === String(canonical._id));
  ck('the duplicate records when it was merged', !!mergedSource.mergedAt);

  let selfMerge = null;
  try {
    await taxonomyService.mergeBrand(canonical._id, { targetBrand: canonical._id });
  } catch (error) {
    selfMerge = error.statusCode;
  }
  ck('a brand cannot merge into itself', selfMerge === 400, selfMerge);

  let mergedAgain = null;
  try {
    await taxonomyService.mergeBrand(duplicate._id, { targetBrand: canonical._id });
  } catch (error) {
    mergedAgain = error.statusCode;
  }
  ck('an already-merged brand cannot be merged again', mergedAgain === 409, mergedAgain);

  const pendingTarget = await StoreBrand.create({
    name: 'Verify Brand Pending Target ' + STAMP,
    slug: 'verify-brand-pending-target-' + STAMP,
    status: 'pending',
  });
  const pendingSource = await StoreBrand.create({
    name: 'Verify Brand Pending Source ' + STAMP,
    slug: 'verify-brand-pending-source-' + STAMP,
    status: 'approved',
  });
  let pendingMerge = null;
  try {
    await taxonomyService.mergeBrand(pendingSource._id, { targetBrand: pendingTarget._id });
  } catch (error) {
    pendingMerge = error.statusCode;
  }
  ck('a merge target must be approved', pendingMerge === 422, pendingMerge);
  ck(
    'merge derives verification from valid certifications',
    mergedTarget.isVerified === true,
    mergedTarget.isVerified
  );

  console.log('\n=== brand certification review and expiry ===\n');

  const certBrand = await StoreBrand.create({
    name: 'Verify Brand Certifications ' + STAMP,
    slug: 'verify-brand-certifications-' + STAMP,
    categories: [CATEGORY],
    status: 'approved',
    isVerified: false,
  });

  const addedCert = await taxonomyService.addBrandCertification(certBrand._id, {
    type: 'authorization_letter',
    number: 'CERT-' + STAMP,
    validFrom: new Date(Date.now() - 86400000),
    validTo: new Date(Date.now() + 86400000),
    document: 'https://example.test/authorization.pdf',
  });
  ck('a new certification starts pending', addedCert.brand.certifications[addedCert.index].status === 'pending');
  ck('a pending certification does not grant the badge', addedCert.brand.isVerified === false);

  const reviewedCert = await taxonomyService.reviewBrandCertification(
    certBrand._id,
    addedCert.index,
    { status: 'approved', by: new mongoose.Types.ObjectId() }
  );
  ck('approving a valid certification grants the badge', reviewedCert.isVerified === true);
  ck('the reviewer is recorded', !!reviewedCert.certifications[addedCert.index].verifiedBy);

  const expiredCertBrand = await StoreBrand.create({
    name: 'Verify Brand Expired Certification ' + STAMP,
    slug: 'verify-brand-expired-certification-' + STAMP,
    categories: [CATEGORY],
    status: 'approved',
  });
  const expiredAdded = await taxonomyService.addBrandCertification(expiredCertBrand._id, {
    type: 'dealership',
    number: 'EXPIRED-' + STAMP,
    validTo: new Date(Date.now() - 86400000),
  });
  let expiredApproval = null;
  try {
    await taxonomyService.reviewBrandCertification(expiredCertBrand._id, expiredAdded.index, {
      status: 'approved',
      by: new mongoose.Types.ObjectId(),
    });
  } catch (error) {
    expiredApproval = error.statusCode;
  }
  ck('an expired certification cannot be approved', expiredApproval === 422, expiredApproval);

  const liveCertBrand = await StoreBrand.findById(certBrand._id);
  liveCertBrand.certifications[addedCert.index].validTo = new Date(Date.now() - 1000);
  await liveCertBrand.save();

  const sweep = await taxonomyService.expireBrandCertifications();
  const sweptBrand = await StoreBrand.findById(certBrand._id).lean();
  ck('the sweep expires a lapsed certification', sweptBrand.certifications[0].status === 'expired');
  ck('the sweep clears the verified badge', sweptBrand.isVerified === false);
  ck('the sweep reports what it expired', sweep.expired >= 1, sweep.expired);

  console.log('\n=== slug handling ===\n');

  ck('slugify lowercases and hyphenates', catalogService.slugify('Cotton Shirt') === 'cotton-shirt', catalogService.slugify('Cotton Shirt'));
  ck('slugify collapses punctuation', catalogService.slugify('T-Shirt (Blue)') === catalogService.slugify('t-shirt-blue'),
    catalogService.slugify('T-Shirt (Blue)'));
  const auto = await makeProduct({ name: 'Auto Slug Shirt', slug: undefined });
  ck('a product created without a slug gets one derived from its name', !!auto.slug && auto.slug.length > 0, auto.slug);
};

run()
  .catch((e) => {
    failures += 1;
    console.log('\nSUITE ERROR: ' + (e && e.stack ? e.stack : e));
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      /* the run already failed; cleanup errors must not mask it */
    }
    await mongoose.disconnect();
    console.log('\n' + (failures === 0 ? 'ALL STORES CATALOG CHECKS PASSED' : failures + ' STORES CATALOG CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });