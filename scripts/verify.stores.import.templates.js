/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright c 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential. Unauthorized copying, redistribution, resale,
 * publication, modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.import.templates.js - the stores taxonomy import contract.
 *
 * Run: node scripts/verify.stores.import.templates.js
 *
 * ## What this pins
 *
 *   1. TEMPLATE PARITY - every CSV/XLSX template's header is exactly the array the
 *      importer checks. A template with an extra column is rejected by the importer,
 *      which is correct; a template that teaches the wrong columns is the bug.
 *   2. IDEMPOTENCE - importing the same file twice creates nothing the second time.
 *      The importer upserts by stable key, so re-running an export/import round-trip
 *      cannot duplicate the taxonomy.
 *   3. CROSS-REFERENCES - a category parent that appears later in the file resolves,
 *      a subcategory needs a real category, and a brand cannot point at a category or
 *      subcategory that does not exist. Unknown tokens are errors, never auto-created:
 *      the product importer creates a brand request, but taxonomy import must not.
 *   4. APPROVAL GATE - an approved brand needs at least one category (5.7.4).
 *   5. ALL-OR-NOTHING - a bad row stops the file before any write.
 *
 * Every record is prefixed and deleted on exit; this suite is safe against a seeded
 * or shared development database.
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const mongoose = require('mongoose');
require('dotenv').config();

require('../src/modules/stores/models/store.category.model');
require('../src/modules/stores/models/store.subcategory.model');
require('../src/modules/stores/models/store.brand.model');
require('../src/modules/stores/models/store.chain.model');
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/store.brand.request.model');

const importService = require('../src/modules/stores/services/stores.admin.taxonomy.import.service');
const productImportService = require('../src/modules/stores/services/stores.catalog.import.service');
const brandRequestService = require('../src/modules/stores/services/stores.brand.request.service');
const schema = require('../src/utils/importCollectionSchema');

const StoreCategory = mongoose.model('StoreCategory');
const StoreSubcategory = mongoose.model('StoreSubcategory');
const StoreBrand = mongoose.model('StoreBrand');
const StoreChain = mongoose.model('StoreChain');
const ChainProduct = mongoose.model('ChainProduct');
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

const sameKeys = (actual, expected) =>
  actual.length === expected.length && expected.every((key) => actual.includes(key));

const TEMPLATE_ROOT = path.join(__dirname, '..', 'src', 'templates', 'import_collection');

const readCsv = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8');
  return Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
};

const readXlsx = async (filePath) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  const headers = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    headers.push(String(worksheet.getRow(1).getCell(column).value || '').trim());
  }
  const firstRow = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    firstRow.push(worksheet.getRow(2).getCell(column).value);
  }
  return { headers, firstRow };
};

const TEMPLATES = [
  ['store_category', schema.storeCategorySchemaKeys],
  ['store_subcategory', schema.storeSubcategorySchemaKeys],
  ['store_brand', schema.storeBrandSchemaKeys],
  ['chain_product', schema.chainProductSchemaKeys],
];

const checkTemplates = async () => {
  console.log('\n-- template header parity');
  for (const [name, keys] of TEMPLATES) {
    const emptyCsv = path.join(TEMPLATE_ROOT, 'csv', `${name}_empty.csv`);
    const sampleCsv = path.join(TEMPLATE_ROOT, 'csv', `${name}_sample.csv`);
    const emptyXlsx = path.join(TEMPLATE_ROOT, 'xlsx', `${name}_empty.xlsx`);
    const sampleXlsx = path.join(TEMPLATE_ROOT, 'xlsx', `${name}_sample.xlsx`);

    ck(`${name}: csv empty template exists`, fs.existsSync(emptyCsv));
    ck(`${name}: csv sample template exists`, fs.existsSync(sampleCsv));
    ck(`${name}: xlsx empty template exists`, fs.existsSync(emptyXlsx));
    ck(`${name}: xlsx sample template exists`, fs.existsSync(sampleXlsx));
    if (!fs.existsSync(emptyCsv) || !fs.existsSync(sampleCsv)) continue;

    const emptyParsed = readCsv(emptyCsv);
    ck(
      `${name}: csv empty header matches schema`,
      sameKeys(emptyParsed.meta.fields || [], keys),
      JSON.stringify(emptyParsed.meta.fields)
    );

    const sampleParsed = readCsv(sampleCsv);
    ck(
      `${name}: csv sample header matches schema`,
      sameKeys(sampleParsed.meta.fields || [], keys),
      JSON.stringify(sampleParsed.meta.fields)
    );
    ck(`${name}: csv sample has a data row`, sampleParsed.data.length > 0);
    ck(
      `${name}: csv sample row carries every column`,
      sampleParsed.data.length > 0 &&
        keys.every((key) => Object.prototype.hasOwnProperty.call(sampleParsed.data[0], key))
    );

    if (fs.existsSync(sampleXlsx)) {
      const xlsx = await readXlsx(sampleXlsx);
      ck(
        `${name}: xlsx sample header matches schema`,
        sameKeys(xlsx.headers.filter(Boolean), keys),
        JSON.stringify(xlsx.headers)
      );
      ck(`${name}: xlsx sample has a data row`, xlsx.firstRow.some((value) => value !== null && value !== ''));
    }

    if (fs.existsSync(emptyXlsx)) {
      const xlsx = await readXlsx(emptyXlsx);
      ck(
        `${name}: xlsx empty header matches schema`,
        sameKeys(xlsx.headers.filter(Boolean), keys),
        JSON.stringify(xlsx.headers)
      );
    }
  }
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const suffix = Date.now().toString(36);
  const parentKey = `verify_parent_${suffix}`;
  const childKey = `verify_child_${suffix}`;
  const subKey = `verify_sub_${suffix}`;
  const brandName = `Verify Brand ${suffix}`;
  const badBrandName = `Verify Bad Brand ${suffix}`;
  const categoryKeys = schema.storeCategorySchemaKeys;
  const subcategoryKeys = schema.storeSubcategorySchemaKeys;

  await checkTemplates();

  console.log('\n-- import validation and upsert');
  const categories = [
    {
      key: parentKey,
      name: `Verify Parent ${suffix}`,
      description: 'verification parent',
      icon: 'tablerTestPipe',
      sortOrder: 1,
      parent: '',
      status: 'true',
    },
    {
      key: childKey,
      name: `Verify Child ${suffix}`,
      description: 'verification child',
      icon: 'tablerTestPipe',
      sortOrder: 2,
      parent: parentKey,
      status: 'true',
    },
  ];

  const firstCategoryImport = await importService.importCollection(
    'store_category',
    categories,
    categoryKeys
  );
  ck('first category import creates both rows', firstCategoryImport.created === 2);
  ck('first category import updates nothing', firstCategoryImport.updated === 0);

  const parent = await StoreCategory.findOne({ key: parentKey }).lean();
  const child = await StoreCategory.findOne({ key: childKey }).lean();
  ck('category parent resolves within the file', !!parent && !!child);
  ck(
    'category parent id is written',
    !!child && !!child.parent && String(child.parent) === String(parent._id)
  );

  const secondCategoryImport = await importService.importCollection(
    'store_category',
    categories,
    categoryKeys
  );
  ck('second category import creates nothing', secondCategoryImport.created === 0);
  ck('second category import updates both rows', secondCategoryImport.updated === 2);
  ck(
    'category count is unchanged by re-import',
    (await StoreCategory.countDocuments({ key: { $in: [parentKey, childKey] } })) === 2
  );

  const categoryExport = await importService.exportCollection('store_category');
  ck('category export header matches schema', sameKeys(categoryExport.keys, categoryKeys));
  const exportedChild = categoryExport.rows.find((row) => row.key === childKey);
  ck('category export emits the parent key', !!exportedChild && exportedChild.parent === parentKey);

  const subcategories = [
    {
      category: childKey,
      key: subKey,
      name: `Verify Sub ${suffix}`,
      description: 'verification subcategory',
      icon: 'tablerTestPipe',
      image: '',
      sortOrder: 1,
      status: 'true',
    },
  ];
  const firstSubImport = await importService.importCollection(
    'store_subcategory',
    subcategories,
    subcategoryKeys
  );
  ck('subcategory import resolves the category key', firstSubImport.created === 1);
  const sub = await StoreSubcategory.findOne({ key: subKey }).lean();
  ck(
    'subcategory points at the child category',
    !!sub && String(sub.category) === String(child._id)
  );

  const badCategoryImport = await importService
    .importCollection(
      'store_subcategory',
      [{ ...subcategories[0], category: 'does_not_exist' }],
      subcategoryKeys
    )
    .then(() => null)
    .catch((error) => error);
  ck('unknown subcategory category is rejected', !!badCategoryImport && badCategoryImport.statusCode === 400);
  ck(
    'unknown subcategory category writes nothing',
    (await StoreSubcategory.countDocuments({ key: subKey })) === 1
  );

  const brands = [
    {
      name: brandName,
      aliases: 'VERIFY|Verify Brand Alias',
      categories: childKey,
      subcategories: subKey,
      originCountry: 'India',
      website: 'https://example.com',
      description: 'verification brand',
      logo: '',
      banner: '',
      status: 'approved',
    },
  ];
  const firstBrandImport = await importService.importCollection(
    'store_brand',
    brands,
    schema.storeBrandSchemaKeys
  );
  ck('approved brand with category is imported', firstBrandImport.created === 1);
  const brand = await StoreBrand.findOne({ name: brandName }).lean();
  ck('approved brand is verified', !!brand && brand.isVerified === true);
  ck(
    'brand category and subcategory tokens resolve',
    !!brand &&
      brand.categories.length === 1 &&
      String(brand.categories[0]) === String(child._id) &&
      brand.subcategories.length === 1 &&
      String(brand.subcategories[0]) === String(sub._id)
  );

  const secondBrandImport = await importService.importCollection(
    'store_brand',
    brands,
    schema.storeBrandSchemaKeys
  );
  ck('second brand import creates nothing', secondBrandImport.created === 0);
  ck('second brand import updates the row', secondBrandImport.updated === 1);
  ck(
    'brand count is unchanged by re-import',
    (await StoreBrand.countDocuments({ name: brandName })) === 1
  );

  const brandExport = await importService.exportCollection('store_brand');
  const exportedBrand = brandExport.rows.find((row) => row.name === brandName);
  ck('brand export includes the category key', !!exportedBrand && exportedBrand.categories === childKey);
  ck('brand export includes the subcategory key', !!exportedBrand && exportedBrand.subcategories === subKey);
  ck('brand export keeps the status', !!exportedBrand && exportedBrand.status === 'approved');

  const badBrand = await importService
    .importCollection(
      'store_brand',
      [{ ...brands[0], name: badBrandName, categories: 'does_not_exist' }],
      schema.storeBrandSchemaKeys
    )
    .then(() => null)
    .catch((error) => error);
  ck('unknown brand category is rejected', !!badBrand && badBrand.statusCode === 400);
  ck(
    'unknown brand category writes no brand',
    (await StoreBrand.countDocuments({ name: badBrandName })) === 0
  );

  const approvalWithoutCategory = await importService
    .importCollection(
      'store_brand',
      [{ ...brands[0], name: badBrandName, categories: '', subcategories: '', status: 'approved' }],
      schema.storeBrandSchemaKeys
    )
    .then(() => null)
    .catch((error) => error);
  ck(
    'approved brand without a category is rejected',
    !!approvalWithoutCategory && approvalWithoutCategory.statusCode === 400
  );

  const badHeader = await importService
    .importCollection('store_category', categories, ['name', 'status'])
    .then(() => null)
    .catch((error) => error);
  ck('a template with the wrong columns is rejected', !!badHeader && badHeader.statusCode === 400);

  const badStatus = await importService
    .importCollection(
      'store_category',
      [{ ...categories[0], key: `verify_bad_status_${suffix}`, status: 'maybe' }],
      categoryKeys
    )
    .then(() => null)
    .catch((error) => error);
  ck('an invalid boolean status is rejected', !!badStatus && badStatus.statusCode === 400);
  ck(
    'a rejected row writes nothing',
    (await StoreCategory.countDocuments({ key: `verify_bad_status_${suffix}` })) === 0
  );

  console.log('\n-- product import');

  let chain = await StoreChain.findOne({}).sort({ createdAt: 1 });
  if (!chain) {
    chain = await StoreChain.create({
      business: new mongoose.Types.ObjectId(),
      name: `Verify Chain ${suffix}`,
      status: 'active',
    });
  }

  const productKeys = schema.chainProductSchemaKeys;
  const productName = `Verify Product ${suffix}`;
  const productRecord = {
    name: productName,
    category: childKey,
    subcategory: subKey,
    brand: brandName,
    description: 'verification product',
    images: 'https://example.com/product.jpg',
    videoUrl: '',
    basePrice: '2499',
    baseMrp: '2999',
    tax: 'inclusive',
    taxPercentage: '18',
    hsn: '85183000',
    tags: 'verify|product',
    searchTerms: 'verify product',
    isOrganic: 'false',
    warrantyMonths: '12',
    warrantyProvider: 'Verify',
    warrantyType: 'manufacturer',
    status: 'active',
  };

  const firstProductImport = await productImportService.importProducts({
    chain,
    by: new mongoose.Types.ObjectId(),
    records: [productRecord],
    headers: productKeys,
  });
  ck('product import creates a product', firstProductImport.created === 1);
  const product = await ChainProduct.findOne({ chain: chain._id, name: productName }).lean();
  ck(
    'product import resolves category, subcategory and approved brand',
    !!product &&
      String(product.category) === String(child._id) &&
      String(product.subcategory) === String(sub._id) &&
      String(product.brand) === String(brand._id)
  );
  ck(
    'product import stores price, tax and warranty',
    !!product &&
      product.basePrice === 2499 &&
      product.baseMrp === 2999 &&
      product.taxPercentage === 18 &&
      product.warranty.months === 12
  );

  const secondProductImport = await productImportService.importProducts({
    chain,
    by: new mongoose.Types.ObjectId(),
    records: [productRecord],
    headers: productKeys,
  });
  ck('second product import creates nothing', secondProductImport.created === 0);
  ck('second product import updates the row', secondProductImport.updated === 1);
  ck(
    'product count is unchanged by re-import',
    (await ChainProduct.countDocuments({ chain: chain._id, name: productName })) === 1
  );

  const goodProductName = `Verify Product Good ${suffix}`;
  const badProductName = `Verify Product Bad ${suffix}`;
  const allOrNothing = await productImportService
    .importProducts({
      chain,
      by: new mongoose.Types.ObjectId(),
      records: [
        { ...productRecord, name: goodProductName },
        { ...productRecord, name: badProductName, baseMrp: '1' },
      ],
      headers: productKeys,
    })
    .then(() => null)
    .catch((error) => error);
  ck('a bad product row rejects the file', !!allOrNothing && allOrNothing.statusCode === 400);
  ck(
    'a rejected product file writes no product',
    (await ChainProduct.countDocuments({
      chain: chain._id,
      name: { $in: [goodProductName, badProductName] },
    })) === 0
  );

  const requestedBrandName = `Verify Requested Brand ${suffix}`;
  const requestedProductName = `Verify Product Request ${suffix}`;
  const unknownBrandImport = await productImportService
    .importProducts({
      chain,
      by: new mongoose.Types.ObjectId(),
      records: [{ ...productRecord, name: requestedProductName, brand: requestedBrandName }],
      headers: productKeys,
    })
    .then(() => null)
    .catch((error) => error);
  ck('an unknown brand rejects the product row', !!unknownBrandImport && unknownBrandImport.statusCode === 400);
  ck(
    'an unknown brand creates a brand request, not a brand',
    (await StoreBrandRequest.countDocuments({ name: requestedBrandName, status: 'pending' })) === 1 &&
      (await StoreBrand.countDocuments({ name: requestedBrandName })) === 0
  );
  ck(
    'an unknown brand writes no product',
    (await ChainProduct.countDocuments({ chain: chain._id, name: requestedProductName })) === 0
  );

  await productImportService
    .importProducts({
      chain,
      by: new mongoose.Types.ObjectId(),
      records: [{ ...productRecord, name: requestedProductName, brand: requestedBrandName }],
      headers: productKeys,
    })
    .catch(() => {});
  ck(
    'a pending brand request is not duplicated',
    (await StoreBrandRequest.countDocuments({ name: requestedBrandName })) === 1
  );

  const request = await StoreBrandRequest.findOne({ name: requestedBrandName });
  const reviewed = await brandRequestService.reviewRequest({
    requestId: request._id,
    status: 'approved',
    note: 'verification approval',
    by: new mongoose.Types.ObjectId(),
  });
  const reviewedBrand = await StoreBrand.findOne({ name: requestedBrandName }).lean();
  ck(
    'approving a request creates the approved brand',
    !!reviewedBrand && reviewedBrand.status === 'approved'
  );
  ck(
    'approving a request does not certify the brand',
    !!reviewedBrand && reviewedBrand.isVerified === false
  );
  ck(
    'the request records the approval and the brand',
    reviewed.status === 'approved' &&
      String(reviewed.brand) === String(reviewedBrand._id)
  );

  return async () => {
    await ChainProduct.deleteMany({
      chain: chain._id,
      name: { $regex: /^Verify Product / },
    });
    await StoreBrandRequest.deleteMany({
      name: { $regex: /^Verify Requested Brand / },
    });
    await StoreBrand.deleteMany({
      name: { $in: [brandName, badBrandName, requestedBrandName] },
    });
    await StoreSubcategory.deleteMany({ key: subKey });
    await StoreCategory.deleteMany({ key: { $in: [parentKey, childKey] } });
    await StoreChain.deleteOne({ name: `Verify Chain ${suffix}` });
  };
};

const cleanup = async () => {
  await ChainProduct.deleteMany({ name: { $regex: /^Verify Product / } });
  await StoreBrandRequest.deleteMany({ name: { $regex: /^Verify Requested Brand / } });
  await StoreBrand.deleteMany({ name: { $regex: /^Verify (Bad |Requested )?Brand / } });
  await StoreSubcategory.deleteMany({ key: { $regex: /^verify_(sub|bad_status)_/ } });
  await StoreCategory.deleteMany({ key: { $regex: /^verify_(parent|child|bad_status)_/ } });
  await StoreChain.deleteMany({ name: { $regex: /^Verify Chain / } });
};

run()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      failures += 1;
      console.error('cleanup failed', error);
    }
    await mongoose.disconnect();
    console.log('\n' + (failures === 0 ? 'ALL IMPORT TEMPLATE CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
