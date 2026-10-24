/**
 * verify.realestate.customer.purchases.js — the customer's purchase history gate.
 *
 * A purchase is a recorded sale (plan A6.5). It is created by the hold
 * conversion or by an operator — never by the customer — so this surface
 * is strictly read-only. What the gate protects:
 *
 *   - 2 routes on `/v1/realestate/customer` behind `appAuth()`
 *   - the tenant comes from the token: no customer id in the path, query
 *     or body, and no `status` the customer could set
 *   - the list and the detail are both scoped to `customer: customerId`,
 *     and a foreign sale is a 404, not a 403 (no id oracle)
 *   - the money edges: `saleValue` / `holdPrincipalApplied` are read from
 *     a hydrated document, never `.lean()` (a lean read ships paise)
 *   - the customer app calls the routes it was given, and the verification
 *     summary it renders carries document TYPES only — never a file url
 *
 * Run: node scripts/verify.realestate.customer.purchases.js
 */

const fs = require('fs');
const path = require('path');

const API_ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.resolve(API_ROOT, '..', 'Customer_app');

const ROUTE = path.join(API_ROOT, 'src/modules/realestate/routes/realestate.customer.route.js');
const VALIDATION = path.join(API_ROOT, 'src/modules/realestate/validations/realestate.customer.validation.js');
const CONTROLLER = path.join(API_ROOT, 'src/modules/realestate/controllers/realestate.customer.controller.js');
const SALE_SERVICE = path.join(API_ROOT, 'src/modules/realestate/services/realestate.sale.service.js');
const DOCUMENT_ACCESS = path.join(API_ROOT, 'src/modules/realestate/middlewares/realestate.document.access.js');
const SEARCH_SERVICE = path.join(API_ROOT, 'src/modules/realestate/services/realestate.property.search.service.js');

const APP_ENDPOINTS = path.join(APP_ROOT, 'lib/app/core/config/api_endpoints.dart');
const APP_REPO = path.join(APP_ROOT, 'lib/app/core/repositories/real_estate_repository.dart');
const APP_MODELS = path.join(APP_ROOT, 'lib/app/core/models/real_estate_property_model.dart');
const APP_PURCHASES = path.join(APP_ROOT, 'lib/app/presentation/pages/real_estate/purchases.dart');
const APP_HOLD_DETAIL = path.join(APP_ROOT, 'lib/app/presentation/pages/real_estate/hold_detail.dart');
const APP_HOME = path.join(APP_ROOT, 'lib/app/presentation/pages/real_estate/real_estate_home.dart');
const APP_PROPERTY_DETAIL = path.join(APP_ROOT, 'lib/app/presentation/pages/real_estate/property_detail.dart');

const V = require(VALIDATION);
const router = require(ROUTE);

const routeText = fs.readFileSync(ROUTE, 'utf8');
const validationText = fs.readFileSync(VALIDATION, 'utf8');
const controllerText = fs.readFileSync(CONTROLLER, 'utf8');
const saleText = fs.readFileSync(SALE_SERVICE, 'utf8');
const documentAccessText = fs.readFileSync(DOCUMENT_ACCESS, 'utf8');
const searchServiceText = fs.readFileSync(SEARCH_SERVICE, 'utf8');

const appEndpointsText = fs.readFileSync(APP_ENDPOINTS, 'utf8');
const appRepoText = fs.readFileSync(APP_REPO, 'utf8');
const appModelsText = fs.readFileSync(APP_MODELS, 'utf8');
const appPurchasesText = fs.readFileSync(APP_PURCHASES, 'utf8');
const appHomeText = fs.readFileSync(APP_HOME, 'utf8');
const appPropertyDetailText = fs.readFileSync(APP_PROPERTY_DETAIL, 'utf8');

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ---------------------------------------------------------------- [1] routes

const wired = router.stack
  .filter((l) => l.route)
  .map((l) => ({
    method: Object.keys(l.route.methods)[0].toUpperCase(),
    path: l.route.path,
  }));
const expected = [
  { method: 'GET', path: '/purchases' },
  { method: 'GET', path: '/purchases/:id' },
];
const missing = expected.filter(
  (e) => !wired.some((w) => w.method === e.method && w.path === e.path)
);
assert(
  '[1a] GET /purchases and GET /purchases/:id wired on the customer router',
  missing.length === 0,
  missing.length
    ? `missing: ${missing.map((m) => m.method + ' ' + m.path).join(', ')}`
    : 'both wired'
);

const purchaseRouteBlocks = routeText
  .split('router.')
  .filter((block) => block.includes("'/purchases"));
assert(
  '[1b] every purchase route declares appAuth()',
  purchaseRouteBlocks.length === 2 &&
    purchaseRouteBlocks.every((block) => block.includes('appAuth()')),
  `${purchaseRouteBlocks.length} purchase route block(s)`
);

const listIndex = routeText.indexOf("'/purchases'");
const detailIndex = routeText.indexOf("'/purchases/:id'");
assert(
  '[1c] /purchases is declared before /purchases/:id (the literal is never read as an id)',
  listIndex > -1 && detailIndex > listIndex,
  `list@${listIndex} detail@${detailIndex}`
);

assert(
  '[1d] no customer id appears in any purchase path',
  !/\/purchases\/:customer/.test(routeText)
);

// ------------------------------------------------------- [2] validation shape

assert(
  '[2a] purchaseParams exported in the { params } wrapper',
  !!(V.purchaseParams && V.purchaseParams.params) &&
    /purchaseParams: \{ params: purchaseIdParam \}/.test(validationText)
);
assert(
  '[2b] purchaseList exported in the { query } wrapper',
  !!(V.purchaseList && V.purchaseList.query) &&
    /purchaseList: \{ query: purchaseListQuery \}/.test(validationText)
);

{
  const good = V.purchaseParams.params.validate({ id: '64b0000000000000000000aa' });
  assert('[2c] a valid purchase id passes', !good.error, good.error ? good.error.message : 'ok');

  const bad = V.purchaseParams.params.validate({ id: 'not-an-object-id' });
  assert('[2d] a malformed purchase id is rejected', !!bad.error);
}

{
  const list = V.purchaseList.query.validate({ page: 1, limit: 20 });
  assert(
    '[2e] the purchase list accepts page/limit and defaults them',
    !list.error && list.value.page === 1 && list.value.limit === 20,
    list.error ? list.error.message : `page=${list.value.page} limit=${list.value.limit}`
  );
}

// The read-only rule: a customer cannot filter, narrow or widen the list
// with a query field, because the list query carries page/limit only.
const purchaseListQueryMatch = validationText.match(
  /const purchaseListQuery = Joi\.object\(\{[\s\S]*?\}\)\.unknown\(true\);/
);
assert(
  '[2f] the purchase list query carries page/limit only (no customer, no status)',
  !!purchaseListQueryMatch &&
    !/customer/.test(purchaseListQueryMatch[0]) &&
    !/status/.test(purchaseListQueryMatch[0]),
  purchaseListQueryMatch ? 'page/limit only' : 'purchaseListQuery not found'
);

// --------------------------------------------------------- [3] controller

const handlerOk = (name) => {
  const m = controllerText.match(
    new RegExp(`const ${name} = catchAsync\\(async \\(req, res\\) => \\{[\\s\\S]+?\\n\\}\\);`)
  );
  return m && m[0].includes('requireCustomer(req)');
};
assert('[3a] listMyPurchases handler scopes to requireCustomer', !!handlerOk('listMyPurchases'));
assert('[3b] getMyPurchase handler scopes to requireCustomer', !!handlerOk('getMyPurchase'));
assert(
  '[3c] getMyPurchase 404s (a foreign sale is indistinguishable from a missing one)',
  /getMyPurchase[\s\S]+?NOT_FOUND/.test(controllerText)
);
assert(
  '[3d] the purchase handlers never read a customer id from the request',
  !/listMyPurchases[\s\S]{0,400}?(req\.(body|query|params)\.customer)/.test(controllerText) &&
    !/getMyPurchase[\s\S]{0,400}?(req\.(body|query|params)\.customer)/.test(controllerText)
);

// ------------------------------------------------------------ [4] sale service

assert(
  '[4a] listForCustomer filters { customer: customerId } and sorts newest first',
  /async function listForCustomer[\s\S]+?const filter = \{ customer: customerId \}[\s\S]+?find\(filter\)[\s\S]+?sort\(\{ createdAt: -1 \}\)/.test(
    saleText
  )
);
assert(
  '[4b] findByIdForCustomer scopes findOne to { _id, customer }',
  /async function findByIdForCustomer[\s\S]+?findOne\(\s*\{\s*_id:\s*saleId,\s*customer:\s*customerId\s*\}\)/.test(
    saleText
  )
);
assert(
  '[4c] the purchase reads are hydrated, not lean (money stays in rupees at the edge)',
  /async function listForCustomer[\s\S]+?toObject\(\{ getters: true \}\)/.test(saleText) &&
    /async function findByIdForCustomer[\s\S]+?toObject\(\{ getters: true \}\)/.test(saleText)
);
const customerSaleBlock = saleText.slice(
  saleText.indexOf('async function listForCustomer'),
  saleText.indexOf('async function listForExecutive')
);
assert(
  '[4d] no .lean() in the customer purchase reads',
  customerSaleBlock.length > 0 && !customerSaleBlock.includes('.lean()'),
  customerSaleBlock.length > 0 ? 'no lean() in the purchase block' : 'purchase block not found'
);
assert(
  '[4e] the customer purchase list populates the property for the card',
  /populate\('property'/.test(customerSaleBlock)
);

// ------------------------------------------------------- [5] BR-18 verification

assert(
  '[5a] the customer app reads the verification summary from the public endpoint',
  /rePropertyVerification\(String id\)[\s\S]+?properties\/\$id\/verification/.test(appEndpointsText)
);
assert(
  '[5b] the verification summary carries document TYPES only',
  /documentsCleared/.test(searchServiceText) &&
    /Types only\. No ids, no urls, no filenames\./.test(searchServiceText)
);
assert(
  '[5c] the customer actor never receives a file url',
  /customer: \['CUSTOMER_VISIBLE'\]/.test(documentAccessText) &&
    /ACTORS_WHO_MAY_DOWNLOAD = \['vendor', 'bank', 'admin'\]/.test(documentAccessText)
);
assert(
  '[5d] the property detail screen renders the cleared document types',
  /_VerifiedDocumentsCard/.test(appPropertyDetailText) &&
    /verification\.documentsCleared/.test(appPropertyDetailText)
);
assert(
  '[5e] the property detail screen never renders a document file url',
  !/fileUrl/.test(appPropertyDetailText) && !/fileName/.test(appPropertyDetailText)
);

// ------------------------------------------------------ [6] customer app wiring

assert(
  '[6a] the customer app declares both purchase endpoints',
  /reMyPurchases => 'v1\/realestate\/customer\/purchases'/.test(appEndpointsText) &&
    /reMyPurchaseById\(String id\)[\s\S]+?v1\/realestate\/customer\/purchases\/\$id/.test(
      appEndpointsText
    )
);
assert(
  '[6b] the repository reads the purchase list and the purchase detail',
  /Future<List<PurchaseModel>> myPurchases/.test(appRepoText) &&
    /Future<PurchaseModel> purchaseById/.test(appRepoText)
);
assert(
  '[6c] the repository reads the verification summary',
  /Future<PropertyVerificationModel> propertyVerification/.test(appRepoText)
);
assert(
  '[6d] the purchases model parses the sale, the property and the money',
  /class PurchaseModel/.test(appModelsText) &&
    /holdPrincipalApplied/.test(appModelsText) &&
    /class PropertyVerificationModel/.test(appModelsText)
);
assert(
  '[6e] the purchases screen exists and renders the sale value',
  /class PurchasesScreen/.test(appPurchasesText) &&
    /class PurchaseDetailScreen/.test(appPurchasesText) &&
    /formatIndianPrice\(p\.saleValue\)/.test(appPurchasesText)
);
assert(
  '[6f] the Real Estate home links the purchases screen',
  /re_purchases_title/.test(appHomeText) && /PurchasesScreen/.test(appHomeText)
);
assert(
  '[6g] a converted hold opens the purchase it became',
  /convertedSale/.test(appModelsText) &&
    /h\.convertedSale/.test(fs.readFileSync(APP_HOLD_DETAIL, 'utf8'))
);

// ------------------------------------------------------------------- report

let failed = 0;
console.log('Customer purchases (sale history) — gate');
console.log('====================================');
for (const c of checks) {
  const mark = c.ok ? 'OK  ' : 'FAIL';
  console.log(`  [${mark}] ${c.label}${c.detail ? '  — ' + c.detail : ''}`);
  if (!c.ok) failed += 1;
}
console.log('');
if (failed) {
  console.log(`${failed} of ${checks.length} checks FAILED`);
  process.exit(1);
}
console.log(`ALL ${checks.length} CUSTOMER PURCHASE CHECKS PASSED`);
