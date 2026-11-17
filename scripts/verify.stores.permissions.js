/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * This source code is confidential. Unauthorized copying, redistribution,
 * resale, publication, modification, or use of this source code in any
 * public or commercial repository is strictly prohibited.
 */

/**
 * verify.stores.permissions.js - the HTTP-level role enforcement proof.
 * * `verify.stores.roles.js` proves the route-right table and `canRoute()`;
 * `verify.stores.tenancy.js` proves the resolver. Neither drives a request through
 * Express, so neither proves the middleware is actually mounted, the route declares
 * the right it should, or the response reaches the client as a 403.
 *
 * This suite boots the real app and asserts the plan's 17.5 evidence:
 *   - a DISPATCHER cannot accept an order (the API refuses)
 *   - a manager cannot read settlements or the stock valuation
 *   - an INVENTORY_MANAGER cannot change a price, but can change stock-side detail
 *
 * Run: node scripts/verify.stores.permissions.js
 */

/* global fetch */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
require('dotenv').config();

const app = require('../src/app');
const User = require('../src/models/user.model');
const Token = require('../src/models/token.model');
const Business = require('../src/kernel/business/models/business.model');
const StoreChain = require('../src/modules/stores/models/store.chain.model');
const StoreOutlet = require('../src/modules/stores/models/store.outlet.model');
const StoreCategory = require('../src/modules/stores/models/store.category.model');
const ChainProduct = require('../src/modules/stores/models/chain.product.model');
const StoreRoleAssignment = require('../src/modules/stores/models/store.role.assignment.model');
const tokenService = require('../src/services/token.service');

let failures = 0;
let checks = 0;
let server;
let baseUrl;

const check = (label, condition, detail) => {
  checks += 1;
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

const created = {
  users: [],
  chains: [],
  businesses: [],
  outlets: [],
  categories: [],
};

const request = async (method, path, { token, outletId, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (outletId) headers['X-Store-Outlet'] = String(outletId);

  const response = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: response.status, body: payload };
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  console.log('\nLocal Stores HTTP permissions suite against ' + baseUrl);

  const stamp = Date.now().toString().slice(-7);

  const makeUser = async (firstName) => {
    const user = await User.create({
      firstName,
      lastName: 'Perm',
      countryCode: '+91',
      mobile: Number('8' + stamp + Math.floor(Math.random() * 90 + 10)),
      email: 'perm' + stamp + Math.random().toString(36).slice(2, 7) + '@http.local',
      password: 'Test@12345',
      role: 'user',
      status: true,
      locale: 'en',
    });
    const tokens = await tokenService.generateAuthTokens(user, '127.0.0.1', 'stores-permissions');
    created.users.push(user._id);
    return { user, token: tokens.access.token };
  };

  const owner = await makeUser('Owner');
  const manager = await makeUser('Manager');
  const inventoryManager = await makeUser('Inventory');
  const dispatcher = await makeUser('Dispatch');

  const business = await Business.create({
    vertical: 'stores',
    businessModel: 'direct',
    name: 'Permissions Test Business ' + stamp,
    owner: owner.user._id,
    status: true,
  });
  created.businesses.push(business._id);

  const chain = await StoreChain.create({
    business: business._id,
    name: 'Permissions Test Chain ' + stamp,
    categories: [],
    status: 'active',
  });
  created.chains.push(chain._id);

  const outlet = await StoreOutlet.create({
    chain: chain._id,
    outletCode: 'PERM-' + stamp,
    name: 'Permissions Outlet',
    location: { type: 'Point', coordinates: [77.5, 12.9] },
    status: 'active',
    operational: true,
  });
  created.outlets.push(outlet._id);
  await chain.updateOne({ $set: { outlets: [outlet._id], outletCount: 1 } });

  await StoreRoleAssignment.create({
    user: owner.user._id,
    business: business._id,
    chain: chain._id,
    role: 'owner',
    scopeType: 'chain',
    status: 'active',
  });
  await StoreRoleAssignment.create({
    user: manager.user._id,
    business: business._id,
    chain: chain._id,
    role: 'manager',
    scopeType: 'chain',
    status: 'active',
  });
  await StoreRoleAssignment.create({
    user: inventoryManager.user._id,
    business: business._id,
    chain: chain._id,
    role: 'inventory_manager',
    scopeType: 'outlet',
    outlets: [outlet._id],
    status: 'active',
  });
  await StoreRoleAssignment.create({
    user: dispatcher.user._id,
    business: business._id,
    chain: chain._id,
    role: 'dispatcher',
    scopeType: 'outlet',
    outlets: [outlet._id],
    status: 'active',
  });

  const category = await StoreCategory.create({
    key: 'perm_cat_' + stamp,
    name: 'Permissions Cat ' + stamp,
    slug: 'perm-cat-' + stamp,
    status: true,
  });
  created.categories.push(category._id);

  const product = await ChainProduct.create({
    chain: chain._id,
    name: 'Permissions Product ' + stamp,
    slug: 'permissions-product-' + stamp,
    category: category._id,
    basePrice: 100,
    baseMrp: 120,
    status: 'active',
  });

  // -- 1. authentication -----------------------------------------------------
  const anonymous = await request('GET', '/v1/stores/analytics/dashboard', {
    outletId: outlet._id,
  });
  check(
    '1. an unauthenticated dashboard call is refused',
    anonymous.status === httpStatus.UNAUTHORIZED,
    String(anonymous.status)
  );

  // -- 2. dispatcher cannot accept an order ----------------------------------
  const dispatcherAccept = await request(
    'PATCH',
    '/v1/stores/partner/orders/000000000000000000000001/accepted',
    { token: dispatcher.token, outletId: outlet._id, body: {} }
  );
  check(
    '2. dispatcher cannot accept an order',
    dispatcherAccept.status === httpStatus.FORBIDDEN,
    String(dispatcherAccept.status)
  );
  check(
    '2b. the denial names STORE_PERMISSION_DENIED and stores_order_manage',
    dispatcherAccept.body?.extra?.code === 'STORE_PERMISSION_DENIED' &&
      dispatcherAccept.body?.extra?.right === 'stores_order_manage',
    JSON.stringify(dispatcherAccept.body?.extra)
  );

  // -- 3. manager cannot read settlements ------------------------------------
  const managerSettlement = await request('GET', '/v1/stores/settlement', {
    token: manager.token,
    outletId: outlet._id,
  });
  check(
    '3. manager cannot list settlements',
    managerSettlement.status === httpStatus.FORBIDDEN,
    String(managerSettlement.status)
  );
  check(
    '3b. the denial names stores_settlement_read',
    managerSettlement.body?.extra?.code === 'STORE_PERMISSION_DENIED' &&
      managerSettlement.body?.extra?.right === 'stores_settlement_read',
    JSON.stringify(managerSettlement.body?.extra)
  );

  const ownerSettlement = await request('GET', '/v1/stores/settlement', {
    token: owner.token,
    outletId: outlet._id,
  });
  check(
    '3c. the owner reaches the settlement list',
    ownerSettlement.status === httpStatus.OK,
    String(ownerSettlement.status)
  );

  // -- 4. the valuation is owner-only ---------------------------------------
  const managerDashboard = await request('GET', '/v1/stores/analytics/dashboard', {
    token: manager.token,
    outletId: outlet._id,
  });
  check(
    '4. manager dashboard succeeds',
    managerDashboard.status === httpStatus.OK,
    String(managerDashboard.status)
  );
  check(
    '4b. manager dashboard has no inventory.totalValue',
    managerDashboard.body?.inventory !== undefined &&
      !Object.prototype.hasOwnProperty.call(managerDashboard.body.inventory, 'totalValue'),
    JSON.stringify(managerDashboard.body?.inventory)
  );
  check(
    '4c. manager still gets stock counts',
    typeof managerDashboard.body?.inventory?.totalSkus === 'number',
    JSON.stringify(managerDashboard.body?.inventory)
  );

  const ownerDashboard = await request('GET', '/v1/stores/analytics/dashboard', {
    token: owner.token,
    outletId: outlet._id,
  });
  check(
    '5. owner dashboard includes inventory.totalValue',
    ownerDashboard.status === httpStatus.OK &&
      Object.prototype.hasOwnProperty.call(
        ownerDashboard.body?.inventory || {},
        'totalValue'
      ),
    String(ownerDashboard.status)
  );

  // -- 5. inventory_manager cannot reprice -----------------------------------
  const priceAttempt = await request(
    'PATCH',
    '/v1/stores/catalog/products/' + product._id,
    { token: inventoryManager.token, outletId: outlet._id, body: { basePrice: 250 } }
  );
  check(
    '6. inventory_manager cannot change a price',
    priceAttempt.status === httpStatus.FORBIDDEN,
    String(priceAttempt.status)
  );
  check(
    '6b. the denial names STORE_PRICE_ROLE_FORBIDDEN',
    priceAttempt.body?.extra?.code === 'STORE_PRICE_ROLE_FORBIDDEN',
    JSON.stringify(priceAttempt.body?.extra)
  );
  const afterDenial = await ChainProduct.findById(product._id).lean();
  check(
    '6c. the price did not change',
    Number(afterDenial?.basePrice) === 100,
    String(afterDenial?.basePrice)
  );

  const stockDetailAttempt = await request(
    'PATCH',
    '/v1/stores/catalog/products/' + product._id,
    {
      token: inventoryManager.token,
      outletId: outlet._id,
      body: { name: 'Renamed by inventory ' + stamp },
    }
  );
  check(
    '7. inventory_manager may still edit stock-side detail',
    stockDetailAttempt.status === httpStatus.OK,
    String(stockDetailAttempt.status)
  );

  const managerPrice = await request(
    'PATCH',
    '/v1/stores/catalog/products/' + product._id,
    { token: manager.token, outletId: outlet._id, body: { basePrice: 275 } }
  );
  check(
    '8. a manager may change the price',
    managerPrice.status === httpStatus.OK &&
      Number(managerPrice.body?.product?.basePrice) === 275,
    String(managerPrice.status)
  );

  console.log('\n--- summary ---');
  console.log(checks + ' checks run, ' + failures + ' failed');
  if (failures === 0) {
    console.log('ALL STORES PERMISSION CHECKS PASSED');
  } else {
    console.log(failures + ' STORES PERMISSION CHECK(S) FAILED');
  }
};

const cleanup = async () => {
  if (!created.users.length && !created.chains.length) return;
  try {
    await ChainProduct.deleteMany({ chain: { $in: created.chains } });
    await StoreRoleAssignment.deleteMany({ chain: { $in: created.chains } });
    await StoreOutlet.deleteMany({ chain: { $in: created.chains } });
    await StoreChain.deleteMany({ _id: { $in: created.chains } });
    await StoreCategory.deleteMany({ _id: { $in: created.categories } });
    await Business.deleteMany({ _id: { $in: created.businesses } });
    await Token.deleteMany({ user: { $in: created.users } });
    await User.deleteMany({ _id: { $in: created.users } });
  } catch (error) {
    console.error('cleanup failed: ' + error.message);
  }
};

(async () => {
  try {
    await run();
  } catch (error) {
    console.error('\npermissions HTTP suite could not run:', error.message);
    console.error(error.stack);
    failures += 1;
  } finally {
    await cleanup();
    if (server) server.close();
    await mongoose.disconnect();
    process.exit(failures === 0 ? 0 : 1);
  }
})();
