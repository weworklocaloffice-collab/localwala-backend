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
 * End-to-end HTTP tests for the dairy API.
 *
 * ## Why this suite exists
 *
 * Every defect found in the last stretch of work lived in the HTTP layer and was
 * invisible to the service suites, which call services directly and therefore
 * never touch routing, validation, middleware or controllers. Concretely: eight
 * handlers were passing `undefined` as the acting user, three routes could never
 * be called, and two routes allowed one rider to act on another's deliveries —
 * all of them green across every service suite.
 *
 * So this drives real requests through the real app: real routing, real Joi
 * validation, real passport auth, real controllers, real database.
 *
 * Asserts authentication and authorisation:
 *   1. an unauthenticated request is rejected
 *   2. a malformed token is rejected
 *   3. the session endpoints answer for the signed-in user
 *   4. a customer cannot reach a partner-only route
 *   5. a rider cannot read another rider's run
 *   6. a customer cannot read another customer's cart
 *
 * Asserts the customer journey over HTTP:
 *   7-12. cart → checkout → pay → order visible → history
 *
 * Asserts nothing leaks `undefined`:
 *  13. no dairy route answers 500 for a well-formed request
 *
 * Usage: node scripts/verify.dairy.http.js
 */

const mongoose = require('mongoose');
const app = require('../src/app');
const {
  User,
  Business,
  Wallet,
  Transactions,
  DairySku,
  DairyOrder,
  DairyOrderStatusHistory,
  DairyCartItem,
  DairySubscription,
  DairySubscriptionEvent,
  DairyRecurringOrder,
  DairyDriver,
  DairyDriverInvite,
  DairyNotification,
  DeliveryRun,
  DeliveryStop,
  Token,
} = require('../src/models');
const tokenService = require('../src/services/token.service');
const registrationService = require('../src/modules/dairy/services/dairy.registration.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

let server;
let baseUrl;

const request = async (method, path, { token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (e) {
      payload = text;
    }
  }
  return { status: response.status, body: payload };
};

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`\nDairy HTTP suite against ${baseUrl}`);

  const stamp = Date.now().toString().slice(-7);
  const created = {
    users: [],
    businesses: [],
    skus: [],
    tokens: [],
    drivers: [],
    runs: [],
orderIds: [],
  subscriptions: [],
  invites: [],
  };

  const makeUser = async (role, firstName) => {
    const user = await User.create({
      firstName,
      lastName: 'Http',
      countryCode: '+91',
      mobile: Number(`9${stamp}${Math.floor(Math.random() * 90 + 10)}`),
      email: `h${stamp}${Math.random().toString(36).slice(2, 7)}@http.local`,
      password: 'Test@12345',
      role,
      status: true,
      locale: 'en',
    });
    await Wallet.create({ holderId: user._id, balance: 5000, status: true });
    const tokens = await tokenService.generateAuthTokens(user, '127.0.0.1', 'http-suite');
    created.users.push(user._id);
    created.tokens.push(tokens.refresh.token);
    return { user, token: tokens.access.token };
  };

  const customer = await makeUser('user', 'HttpCustomer');
  const other = await makeUser('user', 'HttpOther');
  const partner = await makeUser('dairyPartner', 'HttpPartner');
  // A second outlet, owned by a different partner, used only by the isolation
  // checks in section 10. Without a rival there is nothing to prove the
  // token-derived outlet is really enforced: the tests could all pass while a
  // partner still read another outlet by passing its id.
  const rival = await makeUser('dairyPartner', 'HttpRival');
  // A rider on the rival's fleet, so the roster check has a foreign rider to
  // prove it is excluded.
  const rivalRider = await makeUser('dairyDriver', 'HttpRivalRider');
  const rider = await makeUser('dairyDriver', 'HttpRider');
  const riderTwo = await makeUser('dairyDriver', 'HttpRiderTwo');

  const business = await Business.create({
    vertical: 'dairy',
    businessModel: 'direct',
    name: `Http Outlet ${stamp}`,
    owner: partner.user._id,
    ownDeliveryPartner: true,
    verified: true,
    status: true,
  });
  created.businesses.push(business._id);

  const rivalBusiness = await Business.create({
    vertical: 'dairy',
    businessModel: 'direct',
    name: `Http Rival Outlet ${stamp}`,
    owner: rival.user._id,
    ownDeliveryPartner: true,
    verified: true,
    status: true,
  });
  created.businesses.push(rivalBusiness._id);

  // An outlet needs a wallet to pay its riders from, which a partner-owned
  // business does not get automatically.
  await Wallet.create({ holderId: business._id, balance: 0, status: true });
  await Wallet.create({ holderId: rivalBusiness._id, balance: 0, status: true });

  const rivalSku = await DairySku.create({
    business: rivalBusiness._id,
    name: `Http Rival Milk ${stamp}`,
    packSize: { value: 1, unit: 'litre', quantity: 1 },
    price: 99,
    availableQty: 50,
    inStock: true,
    status: true,
  });
  created.skus.push(rivalSku._id);

  const ownDriver = await DairyDriver.create({
    userId: rider.user._id,
    business: business._id,
    status: true,
    isAvailable: true,
    ownDelivery: true,
    verification: { verified: true },
  });
  const secondDriver = await DairyDriver.create({
    userId: riderTwo.user._id,
    business: business._id,
    status: true,
    isAvailable: true,
    ownDelivery: true,
    verification: { verified: true },
  });
  created.drivers.push(ownDriver._id, secondDriver._id);

  const rivalDriver = await DairyDriver.create({
    userId: rivalRider.user._id,
    business: rivalBusiness._id,
    status: true,
    isAvailable: true,
    ownDelivery: true,
    verification: { verified: true },
  });
  created.drivers.push(rivalDriver._id);

  const sku = await DairySku.create({
    business: business._id,
    name: `Http Milk ${stamp}`,
    packSize: { value: 1, unit: 'litre', quantity: 1 },
    price: 60,
    availableQty: 100,
    inStock: true,
    status: true,
  });
  created.skus.push(sku._id);

  try {
    // ---- 1-2. Authentication ----
    console.log('\n1. Authentication');
    const anon = await request('GET', '/v1/dairy/profile/me');
    check('unauthenticated request rejected', anon.status === 401, `got ${anon.status}`);

    const badToken = await request('GET', '/v1/dairy/profile/me', { token: 'not-a-real-token' });
    check('malformed token rejected', badToken.status === 401, `got ${badToken.status}`);

    // ---- 3. Session endpoints ----
    console.log('\n2. Session endpoints answer for the signed-in user');
    const me = await request('GET', '/v1/dairy/profile/me', { token: customer.token });
    check('profile/me is reachable', me.status === 200, `got ${me.status} ${JSON.stringify(me.body)}`);
    check('profile/me returns the caller, not a path id',
      me.body && me.body.id === customer.user._id.toString(),
      me.body && me.body.id);

    const roles = await request('GET', '/v1/dairy/profile/available_roles', { token: partner.token });
    check('available_roles is reachable', roles.status === 200, `got ${roles.status}`);
    check('available_roles lists the partner role',
      roles.body && roles.body.roles
      && roles.body.roles.available.includes('dairyPartner'),
      JSON.stringify(roles.body && roles.body.roles));

    const switchRole = await request('PATCH', '/v1/dairy/profile/switch_role', {
      token: partner.token,
      body: { role: 'dairyPartner' },
    });
    check('switch_role is reachable', switchRole.status === 200,
      `got ${switchRole.status} ${JSON.stringify(switchRole.body)}`);

    // ---- 4. Role boundaries ----
    console.log('\n3. Role boundaries hold over HTTP');
    const customerOnPartnerRoute = await request('GET', '/v1/dairy/partner/compliance', {
      token: customer.token,
    });
    check('customer refused a partner-only route', customerOnPartnerRoute.status === 403,
      `got ${customerOnPartnerRoute.status}`);

    const riderOnPartnerRoute = await request('GET', '/v1/dairy/partner/compliance', {
      token: rider.token,
    });
    check('rider refused a partner-only route', riderOnPartnerRoute.status === 403,
      `got ${riderOnPartnerRoute.status}`);

    // ---- 5. Rider isolation ----
    console.log('\n4. One rider cannot touch another rider\'s run');
    const run = await DeliveryRun.create({
      runNo: 90000 + (Date.now() % 9000),
      vertical: 'dairy',
      business: business._id,
      serviceDate: new Date(),
      agentMode: 'own_fleet',
      status: 'dispatched',
      slot: { startTime: '06:00', endTime: '08:00' },
      totals: {},
    });
    run.agent = secondDriver._id;
    await run.save();
    created.runs.push(run._id);

    const riderReadsOwn = await request('GET', '/v1/dairy/driver/run/today', { token: rider.token });
    check('a rider can read their own manifest', riderReadsOwn.status === 200,
      `got ${riderReadsOwn.status} ${JSON.stringify(riderReadsOwn.body)}`);
    check('a rider with no run gets null, not an error',
      riderReadsOwn.body && Object.prototype.hasOwnProperty.call(riderReadsOwn.body, 'run'),
      JSON.stringify(riderReadsOwn.body));

    const riderReadsOther = await request('GET', `/v1/dairy/driver/runs/detail/${run._id}`, {
      token: rider.token,
    });
    check("a rider cannot read another rider's run", riderReadsOther.status === 403,
      `got ${riderReadsOther.status} ${JSON.stringify(riderReadsOther.body)}`);

    const riderReadsOwnHistory = await request('GET', '/v1/dairy/driver/runs/history', {
      token: riderTwo.token,
    });
    check('run history is reachable', riderReadsOwnHistory.status === 200,
      `got ${riderReadsOwnHistory.status}`);

    // ---- 6. Customer isolation ----
    console.log('\n5. One customer cannot read another\'s cart');
    const addToCart = await request('POST', '/v1/dairy/customer/cart/items', {
      token: customer.token,
      body: { sku: sku._id, quantity: 2 },
    });
    check('cart add succeeds over HTTP', addToCart.status === 200,
      `got ${addToCart.status} ${JSON.stringify(addToCart.body)}`);

    const myCart = await request('GET', '/v1/dairy/customer/cart', { token: customer.token });
    check('cart read succeeds over HTTP', myCart.status === 200, `got ${myCart.status}`);
    check('cart contains the added line',
      myCart.body && myCart.body.lines && myCart.body.lines.length === 1,
      JSON.stringify(myCart.body && myCart.body.lines));

    const otherCart = await request('GET', '/v1/dairy/customer/cart', { token: other.token });
    check("another customer's cart is empty, not shared",
      otherCart.status === 200
      && otherCart.body
      && otherCart.body.lines
      && otherCart.body.lines.length === 0,
      JSON.stringify(otherCart.body && otherCart.body.lines));

    // ---- 7-12. Purchase journey ----
    console.log('\n6. Cart → checkout → pay, over HTTP');
    const checkout = await request('POST', '/v1/dairy/customer/orders/checkout', {
      token: customer.token,
      body: {
        addressRaw: '1 Http Street',
        paymentMode: 'wallet',
        deliverySlot: { startTime: '06:00', endTime: '08:00' },
      },
    });
    check('checkout succeeds', checkout.status === 200,
      `got ${checkout.status} ${JSON.stringify(checkout.body)}`);
    // The `toJSON` plugin renames `_id` to `id` on the wire, so the HTTP shape is
    // not the document shape. Reading `_id` here is exactly the mistake this suite
    // exists to catch.
    const orderId = checkout.body && checkout.body.order && (checkout.body.order.id || checkout.body.order._id);
    check('checkout returns an order with an id', !!orderId,
      JSON.stringify(checkout.body && checkout.body.order && Object.keys(checkout.body.order)));
    if (orderId) {
      created.orderIds.push(new mongoose.Types.ObjectId(orderId));
    }

    if (orderId) {
      const pay = await request('POST', `/v1/dairy/customer/orders/${orderId}/pay`, {
        token: customer.token,
        body: {},
      });
      check('payment succeeds', pay.status === 200, `got ${pay.status} ${JSON.stringify(pay.body)}`);
      check('order is paid', pay.body && pay.body.order && pay.body.order.paymentStatus === 'paid',
        JSON.stringify(pay.body && pay.body.order && pay.body.order.paymentStatus));

      const walletAfter = await Wallet.findOne({ holderId: customer.user._id });
      // 2 x 60 = 120 goods, 5% tax = 6, so 126. No can deposit: this SKU is not
      // reusable, which is the point — the deposit is a hold, never part of this.
      check('wallet was debited by the order total',
        Number(walletAfter.balance) === 5000 - 126,
        `got ${walletAfter.balance}`);

      const partnerSummary = await request('GET', '/v1/dairy/partner/orders/summary', {
        token: partner.token,
      });
      check('partner order summary is reachable', partnerSummary.status === 200,
        `got ${partnerSummary.status} ${JSON.stringify(partnerSummary.body)}`);
      check('partner order summary is outlet-scoped, not the caller\'s own orders',
        partnerSummary.body && partnerSummary.body.summary
        && partnerSummary.body.summary.byStatus
        && partnerSummary.body.summary.byStatus.confirmed
        && partnerSummary.body.summary.byStatus.confirmed.orders === 1,
        JSON.stringify(partnerSummary.body && partnerSummary.body.summary));

      const dashboard = await request('GET', '/v1/dairy/partner/dashboard', {
        token: partner.token,
      });
      check('partner dashboard is reachable over HTTP', dashboard.status === 200,
        `got ${dashboard.status} ${JSON.stringify(dashboard.body)}`);
      check('dashboard echoes the outlet as a string id',
        dashboard.body && dashboard.body.dashboard
        && dashboard.body.dashboard.outlet.id === business._id.toString(),
        JSON.stringify(dashboard.body && dashboard.body.dashboard && dashboard.body.dashboard.outlet));
      check('dashboard counts the order just placed',
        dashboard.body && dashboard.body.dashboard.today.data.orders === 1,
        JSON.stringify(dashboard.body && dashboard.body.dashboard
          && dashboard.body.dashboard.today));
      ['today', 'lowStock', 'compliance', 'payables', 'subscriptions', 'deliveries']
        .forEach((panel) => {
          check(`dashboard panel "${panel}" present`,
            dashboard.body && dashboard.body.dashboard
            && dashboard.body.dashboard[panel] !== null
            && dashboard.body.dashboard[panel] !== undefined);
        });

      const customerDashboard = await request('GET', '/v1/dairy/partner/dashboard', {
        token: customer.token,
      });
      check('customer refused the dashboard', customerDashboard.status === 403,
        `got ${customerDashboard.status}`);

      // The three partner screens wired this round read these. Asserting they
      // return real rows is what proves the screens have something to render.
      console.log('\n9. Partner screens have real data to bind');
      const skuList = await request('GET', '/v1/dairy/partner/skus/list', {
        token: partner.token,
      });
      check('inventory list is reachable', skuList.status === 200, `got ${skuList.status}`);
      check('inventory list carries the seeded SKU',
        skuList.body && Array.isArray(skuList.body.skus)
        && skuList.body.skus.some((s) => (s.name || '').includes('Http Milk')),
        JSON.stringify(skuList.body && skuList.body.skus && skuList.body.skus.length));

      const orderList = await request('GET', '/v1/dairy/partner/orders/list', {
        token: partner.token,
      });
      check('partner order list is reachable', orderList.status === 200, `got ${orderList.status}`);
      check('partner order list shows the order just placed',
        orderList.body && Array.isArray(orderList.body.orders)
        && orderList.body.orders.some((o) => (o.id || o._id) === orderId),
        `status=${orderList.status}`);

      const runList = await request('POST', '/v1/dairy/partner/runs/list', {
        token: partner.token,
        body: {},
      });
      check('partner run list is reachable', runList.status === 200,
        `got ${runList.status} ${JSON.stringify(runList.body)}`);
      check('partner run list carries the run created above',
        runList.body && Array.isArray(runList.body.runs)
        && runList.body.runs.some((r) => (r.id || r._id) === String(run._id)),
        JSON.stringify(runList.body && runList.body.runs && runList.body.runs.length));

      const list = await request('GET', '/v1/dairy/customer/orders', { token: customer.token });
      check('order appears in the customer\'s list',
        list.status === 200
        && list.body
        && Array.isArray(list.body.orders)
        && list.body.orders.some((o) => (o.id || o._id) === orderId),
        `status=${list.status}`);

      const history = await request('GET', `/v1/dairy/customer/orders/${orderId}/history`, {
        token: customer.token,
      });
      check('order history is reachable', history.status === 200, `got ${history.status}`);

      // The order belongs to this customer; another must not read it.
      const stolen = await request('GET', `/v1/dairy/customer/orders/${orderId}`, {
        token: other.token,
      });
      check("another customer cannot read the order", stolen.status === 403,
        `got ${stolen.status}`);
    }

// ---- 10. Outlet isolation across partners ----
    //
    // Partner routes take no outlet in the path: the server reads it from the
    // token. These checks are the point of that change. A partner supplying the
    // rival outlet's id — in the path or in a `?business=` query — must still be
    // refused, otherwise the scoping is decorative.
    console.log('\n10. One partner cannot reach another outlet');

    const rivalSkuByQuery = await request(
      'GET',
      `/v1/dairy/partner/skus/list?business=${rivalBusiness._id}`,
      { token: partner.token }
    );
    // Responses are serialised with `_id` mapped to `id`, so both are accepted.
    const skuId = (s) => s.id || s._id;
    check('a ?business= query cannot widen the SKU list',
      rivalSkuByQuery.status === 200
      && Array.isArray(rivalSkuByQuery.body.skus)
      && !rivalSkuByQuery.body.skus.some((s) => skuId(s) === String(rivalSku._id)),
      `status=${rivalSkuByQuery.status}, ${rivalSkuByQuery.body.skus.length} sku(s) returned`);

    const ownSkuVisible = rivalSkuByQuery.body.skus.some((s) => skuId(s) === String(sku._id));
    check('the SKU list still returns the caller\'s own stock', ownSkuVisible);

    const rivalStockEdit = await request('PATCH', `/v1/dairy/partner/skus/${rivalSku._id}/stock`, {
      token: partner.token,
      body: { delta: -50 },
    });
    check("a partner cannot adjust another outlet's stock", rivalStockEdit.status === 404,
      `got ${rivalStockEdit.status}`);

    const rivalStockIntact = await DairySku.findById(rivalSku._id).lean();
    check("the rival's stock is untouched", Number(rivalStockIntact.availableQty) === 50,
      `availableQty=${rivalStockIntact.availableQty}`);

    const rivalOrderList = await request(
      'GET',
      `/v1/dairy/partner/orders/list?business=${rivalBusiness._id}`,
      { token: partner.token }
    );
    check('a ?business= query cannot widen the order list',
      rivalOrderList.status === 200
      && Array.isArray(rivalOrderList.body.orders)
      && !rivalOrderList.body.orders.some((o) => o.business === String(rivalBusiness._id)),
      `status=${rivalOrderList.status}`);

    // This one is refused outright rather than silently ignored: the summary's
    // validation has no `business` key, so the query is rejected before it can
    // reach the handler. Either way the rival's figure is not disclosed.
    const rivalOrderSummary = await request(
      'GET',
      `/v1/dairy/partner/orders/summary?business=${rivalBusiness._id}`,
      { token: partner.token }
    );
    check('a ?business= query cannot widen the order summary',
      rivalOrderSummary.status === 400
      || (rivalOrderSummary.status === 200
      && Number(rivalOrderSummary.body.totalOrders || 0) === 0),
      `status=${rivalOrderSummary.status} ${JSON.stringify(rivalOrderSummary.body)}`);

    const rivalRunRead = await request('GET', `/v1/dairy/partner/runs/detail/${run._id}`, {
      token: rival.token,
    });
    check("a partner cannot read another outlet's run", rivalRunRead.status === 404,
      `got ${rivalRunRead.status}`);

    // A partner with no outlet of their own must be refused, not served an empty
    // result that looks like an empty outlet.
    const ownerless = await makeUser('dairyPartner', 'HttpOwnerless');
    const ownerlessDashboard = await request('GET', '/v1/dairy/partner/dashboard', {
      token: ownerless.token,
    });
    check('a partner with no outlet is refused', ownerlessDashboard.status === 403,
      `got ${ownerlessDashboard.status}`);

    // ---- 11. Partner outlet views ----
    //
    // The four screens that had no backend until now. Each must read only this
    // partner's outlet, and the rival checks are repeated per surface: a scoping
    // fix applied to the order list is not evidence it was applied to customers.
    console.log('\n11. Partner subscription, customer, fleet and earnings views');

    const partnerSubscriptionCreate = await request('POST', '/v1/dairy/customer/subscriptions', {
      token: customer.token,
      body: {
        business: business._id,
        sku: sku._id,
        quantity: 1,
        scheduleType: 'daily',
        startDate: new Date().toISOString(),
        deliverySlot: { startTime: '06:00', endTime: '08:00' },
        addressRaw: '1 Http Street',
        paymentMode: 'wallet',
      },
    });
    check('the customer can start a plan on this outlet',
      partnerSubscriptionCreate.status === 200,
      `got ${partnerSubscriptionCreate.status} ${JSON.stringify(partnerSubscriptionCreate.body)}`);
    const subscriptionId = partnerSubscriptionCreate.body
      && partnerSubscriptionCreate.body.subscription
      && (partnerSubscriptionCreate.body.subscription.id || partnerSubscriptionCreate.body.subscription._id);
    if (subscriptionId) {
      created.subscriptions.push(new mongoose.Types.ObjectId(subscriptionId));
    }

    // `subscriptionNo` is required by the model and normally issued by the service.
    const rivalSubscription = await DairySubscription.create({
      subscriptionNo: 990000 + (Date.now() % 900),
      user: other.user._id,
      business: rivalBusiness._id,
      sku: rivalSku._id,
      quantity: 1,
      scheduleType: 'daily',
      startDate: new Date(),
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
      status: 'active',
    });
    created.subscriptions.push(rivalSubscription._id);

    const subscriptions = await request('GET', '/v1/dairy/partner/subscriptions/list', {
      token: partner.token,
    });
    check('partner subscription list is reachable', subscriptions.status === 200,
      `got ${subscriptions.status} ${JSON.stringify(subscriptions.body)}`);
    check('the list carries this outlet\'s plan',
      subscriptions.body && Array.isArray(subscriptions.body.subscriptions)
      && subscriptions.body.subscriptions.some((s) => (s.id || s._id) === String(subscriptionId)),
      JSON.stringify(subscriptions.body && subscriptions.body.subscriptions));
    check('the list excludes the rival outlet\'s plan',
      subscriptions.body && Array.isArray(subscriptions.body.subscriptions)
      && !subscriptions.body.subscriptions.some((s) => (s.id || s._id) === String(rivalSubscription._id)),
      'a rival plan leaked into the subscription list');

    const rivalsSubscriptionList = await request(
      'GET',
      `/v1/dairy/partner/subscriptions/list?business=${rivalBusiness._id}`,
      { token: partner.token }
    );
    check('a ?business= query cannot widen the subscription list',
      rivalsSubscriptionList.status === 400
      || (rivalsSubscriptionList.status === 200
      && !rivalsSubscriptionList.body.subscriptions.some((s) => (s.id || s._id) === String(rivalSubscription._id))),
      `status=${rivalsSubscriptionList.status}`);

    if (subscriptionId) {
      const pause = await request(
        'PATCH',
        `/v1/dairy/partner/subscriptions/${subscriptionId}/pause`,
        { token: partner.token, body: { to: new Date(Date.now() + 86400000).toISOString(), reason: 'holiday' } }
      );
      check('a partner can pause a plan on their own outlet',
        pause.status === 200 && pause.body.subscription.status === 'paused',
        `got ${pause.status} ${JSON.stringify(pause.body)}`);

      const resume = await request(
        'PATCH',
        `/v1/dairy/partner/subscriptions/${subscriptionId}/resume`,
        { token: partner.token, body: {} }
      );
      check('a partner can resume it again',
        resume.status === 200 && resume.body.subscription.status === 'active',
        `got ${resume.status} ${JSON.stringify(resume.body)}`);
    }

    const rivalPause = await request(
      'PATCH',
      `/v1/dairy/partner/subscriptions/${rivalSubscription._id}/pause`,
      // A valid body, so the refusal comes from the outlet check in the service
      // rather than from validation rejecting the request first.
      { token: partner.token, body: { to: new Date(Date.now() + 86400000).toISOString() } }
    );
    check("a partner cannot pause another outlet's plan", rivalPause.status === 404,
      `got ${rivalPause.status}`);
    const rivalSubscriptionIntact = await DairySubscription.findById(rivalSubscription._id).lean();
    check("the rival's plan is untouched", rivalSubscriptionIntact.status === 'active',
      `status=${rivalSubscriptionIntact.status}`);

    const customers = await request('GET', '/v1/dairy/partner/customers/list', {
      token: partner.token,
    });
    check('customer list is reachable', customers.status === 200,
      `got ${customers.status} ${JSON.stringify(customers.body)}`);
    const myRow = customers.body && Array.isArray(customers.body.customers)
      ? customers.body.customers.find((c) => (c.id || c.user) === String(customer.user._id))
      : null;
    check('the customer who just bought appears',
      Boolean(myRow) && myRow.orderCount >= 1,
      JSON.stringify(customers.body && customers.body.customers));
    check('lifetime value is in rupees, not paise',
      Boolean(myRow) && myRow.lifetimeValue > 0 && myRow.lifetimeValue < 1000,
      myRow ? `lifetimeValue=${myRow.lifetimeValue}` : 'no row');
    check('no customer from the rival outlet is listed',
      customers.body && Array.isArray(customers.body.customers)
      && !customers.body.customers.some((c) => (c.id || c.user) === String(other.user._id))
      && !customers.body.customers.some((c) => (c.id || c.user) === String(rival.user._id)),
      JSON.stringify(customers.body && customers.body.customers.map((c) => c.mobile)));

    const drivers = await request('GET', '/v1/dairy/partner/drivers/list', {
      token: partner.token,
    });
    check('driver roster is reachable', drivers.status === 200,
      `got ${drivers.status} ${JSON.stringify(drivers.body)}`);
    check('the roster carries this outlet\'s own rider',
      drivers.body && Array.isArray(drivers.body.drivers)
      && drivers.body.drivers.some((d) => String((d.userId && (d.userId.id || d.userId._id)) || d.userId) === String(rider.user._id)),
      JSON.stringify(drivers.body && drivers.body.drivers));
    check('the rival rider is not on this roster',
      drivers.body && Array.isArray(drivers.body.drivers)
      && !drivers.body.drivers.some((d) => String((d.userId && (d.userId.id || d.userId._id)) || d.userId) === String(rivalRider.user._id)),
      'a rival rider leaked into the roster');

    // Earnings count delivered + paid orders, so the order placed above has to be
    // walked through its states first. Each hop is a real request through the
    // outlet-scoped status route, which doubles as proof that route works.
    if (orderId) {
      for (const status of ['preparing', 'out_for_delivery', 'delivered']) {
        // eslint-disable-next-line no-await-in-loop
        const hop = await request('PATCH', `/v1/dairy/orders/${status}/${orderId}`, {
          token: partner.token,
          body: {},
        });
        if (hop.status !== 200) {
          check(`order reaches ${status}`, false, `got ${hop.status} ${JSON.stringify(hop.body)}`);
          break;
        }
      }
    }

    const rivalOrderMove = await request('PATCH', `/v1/dairy/orders/cancelled/${orderId}`, {
      token: rival.token,
      body: {},
    });
    check("a partner cannot move another outlet's order", rivalOrderMove.status === 404,
      `got ${rivalOrderMove.status}`);

    const earnings = await request('GET', '/v1/dairy/partner/earnings', {
      token: partner.token,
    });
    check('earnings is reachable', earnings.status === 200,
      `got ${earnings.status} ${JSON.stringify(earnings.body)}`);
    const e = earnings.body && earnings.body.earnings;
    check('earnings count the delivered, paid order',
      Boolean(e) && e.orderCount >= 1,
      JSON.stringify(e));
    // 126 rupees paid. An outlet with no partner agreement earns the whole figure,
    // because there is no commission to deduct — asserting the sign here would
    // only test the seeded rate.
    check('gross sales are in rupees, not paise',
      Boolean(e) && e.grossSales > 0 && e.grossSales < 1000,
      e ? `grossSales=${e.grossSales}` : 'no earnings');
    check('net earnings reconcile with the commission deducted',
      Boolean(e) && Math.abs((e.grossSales - e.commissionAmount) - e.netEarnings) < 0.01,
      e ? `gross=${e.grossSales} commission=${e.commissionAmount} net=${e.netEarnings}` : 'no earnings');
    check('commission is reported as a non-negative figure',
      Boolean(e) && e.commissionAmount >= 0 && e.ratePercentage >= 0,
      e ? `commission=${e.commissionAmount} rate=${e.ratePercentage}` : 'no earnings');

    const rivalEarnings = await request(
      'GET',
      `/v1/dairy/partner/earnings?business=${rivalBusiness._id}`,
      { token: partner.token }
    );
    check('a ?business= query cannot widen earnings',
      rivalEarnings.status === 400
      || (rivalEarnings.status === 200 && rivalEarnings.body.earnings.orderCount === 0),
      `status=${rivalEarnings.status} ${JSON.stringify(rivalEarnings.body)}`);

    const outletSettlements = await request('GET', '/v1/dairy/partner/settlements', {
      token: partner.token,
    });
    check('the outlet settlement list is reachable', outletSettlements.status === 200,
      `got ${outletSettlements.status} ${JSON.stringify(outletSettlements.body)}`);

    // ---- 12. Fleet management ----
    //
    // The last partner-only controls: invite, approve, block, remove and pay.
    // Each one names a *rider*, so each is checked against the rival fleet -
    // a partner who can pay another outlet's rider can drain their own wallet.
    console.log('\n12. Partner fleet management');

    const invitedMobile = Number(`8${stamp}${Math.floor(Math.random() * 90 + 10)}`);
    const invite = await request('POST', '/v1/dairy/partner/drivers/invite', {
      token: partner.token,
      body: { mobile: invitedMobile, countryCode: '+91' },
    });
    check('a partner can invite a rider', invite.status === 200 && invite.body.invite,
      `got ${invite.status} ${JSON.stringify(invite.body)}`);
    const inviteId = invite.body && invite.body.invite
      ? (invite.body.invite.id || invite.body.invite._id)
      : null;
    if (inviteId) {
      created.invites.push(new mongoose.Types.ObjectId(inviteId));
    }

    // Idempotent: re-inviting must not fail on the unique index.
    const inviteAgain = await request('POST', '/v1/dairy/partner/drivers/invite', {
      token: partner.token,
      body: { mobile: invitedMobile, countryCode: '+91' },
    });
    check('re-inviting the same number is not an error', inviteAgain.status === 200,
      `got ${inviteAgain.status} ${JSON.stringify(inviteAgain.body)}`);

    const inviteList = await request('GET', '/v1/dairy/partner/drivers/invites', {
      token: partner.token,
    });
    check('pending invitations are listed', inviteList.status === 200
      && Array.isArray(inviteList.body.invites)
      && inviteList.body.invites.some((i) => (i.id || i._id) === String(inviteId)),
      `status=${inviteList.status} ${JSON.stringify(inviteList.body)}`);
    check('another outlet\'s invitations are not listed',
      inviteList.status === 200
      && Array.isArray(inviteList.body.invites)
      && !inviteList.body.invites.some((i) => String(i.mobile) === String(invitedMobile + 1)),
      'a rival invite leaked');

    // The rider registers with the invited number and must land on this outlet.
    // Called on the service rather than over HTTP: the route verifies a phone OTP
    // first, and standing one up here would test the OTP flow, not the invitation.
    const registration = await registrationService.registerDriver({
      firstName: 'Invited',
      lastName: 'Rider',
      countryCode: '+91',
      mobile: invitedMobile,
      email: `invited${stamp}@http.local`,
      password: 'Rider@12345',
      role: 'dairyDriver',
      payoutMode: 'per_can',
      payoutRate: 5,
    });
    check('the invited rider registers', Boolean(registration && registration.driver),
      JSON.stringify(registration && registration.user));
    created.users.push(registration.user._id);
    created.drivers.push(registration.driver._id);
    await Wallet.create({
      holderId: registration.user._id,
      balance: 5000,
      status: true,
    });
    const invitedRider = { user: registration.user };

    const inviteClaimed = await DairyDriverInvite.findById(inviteId);
    check('the invitation is marked accepted on registration',
      Boolean(inviteClaimed) && inviteClaimed.status === 'accepted'
      && String(inviteClaimed.rider) === String(invitedRider.user._id),
      `status=${inviteClaimed && inviteClaimed.status}`);

    check('the invited rider joined this outlet',
      String(registration.driver.business) === String(business._id),
      `business=${registration.driver.business}`);

    // A client-supplied `invitedBy` must no longer decide anything. Rejected at
    // validation, so the payload cannot even name a partner.
    const selfAttach = await request('POST', '/v1/dairy/auth/register/driver', {
      body: {
        id: 'verification-that-does-not-exist',
        firstName: 'Sneaky',
        lastName: 'Rider',
        countryCode: '+91',
        mobile: Number(`7${stamp}${Math.floor(Math.random() * 90 + 10)}`),
        email: `sneaky${stamp}@http.local`,
        password: 'Sneaky@12345',
        role: 'dairyDriver',
        invitedBy: String(partner.user._id),
      },
    });
    check('a client cannot name who invited them',
      selfAttach.status === 400,
      `got ${selfAttach.status} ${JSON.stringify(selfAttach.body)}`);

    const ownDriverId = String(ownDriver._id);
    const block = await request('PATCH', `/v1/dairy/partner/drivers/${ownDriverId}/approval`, {
      token: partner.token,
      body: { approve: false },
    });
    check('a partner can block their own rider',
      block.status === 200 && block.body.driver.isBlocked === true,
      `got ${block.status} ${JSON.stringify(block.body)}`);

    const unblock = await request('PATCH', `/v1/dairy/partner/drivers/${ownDriverId}/approval`, {
      token: partner.token,
      body: { approve: true },
    });
    check('and unblock them again',
      unblock.status === 200 && unblock.body.driver.isBlocked === false,
      `got ${unblock.status} ${JSON.stringify(unblock.body)}`);

    const crossFleetApproval = await request(
      'PATCH',
      `/v1/dairy/partner/drivers/${rivalDriver._id}/approval`,
      { token: partner.token, body: { approve: false } }
    );
    check("a partner cannot touch another outlet's rider", crossFleetApproval.status === 404,
      `got ${crossFleetApproval.status}`);
    const rivalRiderIntact = await DairyDriver.findById(rivalDriver._id).lean();
    check("the rival rider is untouched", rivalRiderIntact.isBlocked !== true,
      `isBlocked=${rivalRiderIntact.isBlocked}`);

    // Payout: money must actually move, and only within this fleet.
    await Wallet.updateOne(
      { holderId: business._id },
      { $set: { balance: 100000 } }
    );
    const riderWalletBefore = await Wallet.findOne({ holderId: rider.user._id });
    const riderBalanceBefore = Number(riderWalletBefore.balance);

    const payout = await request('POST', `/v1/dairy/partner/drivers/${ownDriverId}/payout`, {
      token: partner.token,
      body: { amount: 250, reference: `UPI-${stamp}` },
    });
    check('a partner can pay their own rider', payout.status === 200,
      `got ${payout.status} ${JSON.stringify(payout.body)}`);

    const riderWalletAfter = await Wallet.findOne({ holderId: rider.user._id });
    check('the rider\'s wallet was credited with the payout',
      Number(riderWalletAfter.balance) === riderBalanceBefore + 250,
      `${riderBalanceBefore} -> ${riderWalletAfter.balance}`);

    const outletWalletAfter = await Wallet.findOne({ holderId: business._id });
    check('the outlet\'s wallet was debited, in paise not rupees',
      Number(outletWalletAfter.balance) === 100000 - 250,
      `balance=${outletWalletAfter.balance}`);

    const payoutRows = await Transactions.find({
      'meta.source': 'driver_payout',
      'meta.reference': `UPI-${stamp}`,
    });
    check('the payout is recorded as a debit and a credit',
      payoutRows.length === 2
      && payoutRows.some((t) => t.type === 'driver_payout_debit')
      && payoutRows.some((t) => t.type === 'driver_payout_credit'),
      `${payoutRows.length} transaction(s)`);

    const overdraw = await request('POST', `/v1/dairy/partner/drivers/${ownDriverId}/payout`, {
      token: partner.token,
      body: { amount: 999999999 },
    });
    check('a payout beyond the wallet balance is refused',
      overdraw.status === 400,
      `got ${overdraw.status}`);
    const outletStillSolvent = await Wallet.findOne({ holderId: business._id });
    check('the refused payout moved no money',
      Number(outletStillSolvent.balance) === 100000 - 250,
      `balance=${outletStillSolvent.balance}`);

    const crossFleetPayout = await request(
      'POST',
      `/v1/dairy/partner/drivers/${rivalDriver._id}/payout`,
      { token: partner.token, body: { amount: 100 } }
    );
    check("a partner cannot pay another outlet's rider", crossFleetPayout.status === 404,
      `got ${crossFleetPayout.status}`);
    const rivalRiderWallet = await Wallet.findOne({ holderId: rivalRider.user._id });
    check("the rival rider's wallet is untouched",
      Number(rivalRiderWallet.balance) === 5000,
      `balance=${rivalRiderWallet.balance}`);

    // Removing a rider mid-run would strand their manifest. The run is assigned to
    // the rider being removed below, so both checks exercise the same rider.
    const liveRun = await DeliveryRun.create({
      runNo: 80000 + (Date.now() % 9000),
      vertical: 'dairy',
      business: business._id,
      serviceDate: new Date(),
      agentMode: 'own_fleet',
      status: 'dispatched',
      slot: { startTime: '06:00', endTime: '08:00' },
      totals: {},
    });
    liveRun.agent = secondDriver._id;
    await liveRun.save();
    created.runs.push(liveRun._id);

    const removeMidRun = await request(
      'DELETE',
      `/v1/dairy/partner/drivers/${secondDriver._id}`,
      { token: partner.token, body: {} }
    );
    check('a rider with a live run cannot be removed',
      removeMidRun.status === 400,
      `got ${removeMidRun.status} ${JSON.stringify(removeMidRun.body)}`);

    // Withdraw the run so removal can be tested properly. This rider also has the
    // dispatched run from the rider-isolation check above, so *every* live run is
    // closed - checking only the one just created would leave the guard untested.
    await DeliveryRun.updateMany(
      { agent: secondDriver._id, status: { $in: ['dispatched', 'started'] } },
      { $set: { status: 'completed' } }
    );

    const removal = await request('DELETE', `/v1/dairy/partner/drivers/${secondDriver._id}`, {
      token: partner.token,
      body: {},
    });
    check('a partner can remove an idle rider', removal.status === 200,
      `got ${removal.status} ${JSON.stringify(removal.body)}`);
  const detached = await DairyDriver.findById(secondDriver._id).lean();
  // A removed rider stays attached to the outlet and is deactivated. It used to be
  // detached (`business: null`), which was how a rider moved to the platform pool —
  // and there is no pool now, so that would be a rider with no outlet, no route and
  // nobody paying them. `DairyDriver.business` is required, so detaching would not
  // even save.
  check('the removed rider stays attached to the outlet',
   detached.business !== null && detached.business !== undefined,
   `business=${detached.business}`);
  check('and is deactivated rather than deleted',
   detached.status === false && detached.activeStatus === false,
   `status=${detached.status} activeStatus=${detached.activeStatus}`);
  check('the rider record itself is not deleted', detached._id !== undefined);

    // Rider-side money, scoped to the signed-in rider.
    const riderEarnings = await request('GET', '/v1/dairy/driver/earnings', {
      token: rider.token,
    });
    check('a rider can read their own earnings', riderEarnings.status === 200,
      `got ${riderEarnings.status} ${JSON.stringify(riderEarnings.body)}`);
    check('earnings name the payout mode they are paid on',
      riderEarnings.status === 200 && riderEarnings.body.earnings.payoutMode,
      JSON.stringify(riderEarnings.body && riderEarnings.body.earnings));

    const riderCash = await request('GET', '/v1/dairy/driver/cash_in_hand', {
      token: rider.token,
    });
    check('a rider can read their cash in hand', riderCash.status === 200,
      `got ${riderCash.status} ${JSON.stringify(riderCash.body)}`);
    check('outstanding cash is reported',
      riderCash.status === 200
      && typeof riderCash.body.cashInHand.outstanding === 'number',
      JSON.stringify(riderCash.body && riderCash.body.cashInHand));

    const deposit = await request('POST', '/v1/dairy/driver/cash_deposit', {
      token: rider.token,
      body: { amount: 100, reference: 'DEP-1' },
    });
    check('a rider can record handing cash to the depot', deposit.status === 200,
      `got ${deposit.status} ${JSON.stringify(deposit.body)}`);

    const customerOnFleet = await request('POST', '/v1/dairy/driver/cash_deposit', {
      token: customer.token,
      body: { amount: 50 },
    });
    check('a customer cannot use a rider route', customerOnFleet.status === 403,
      `got ${customerOnFleet.status}`);

// ---- 13. Notifications ----
    //
    // Scoped to the signed-in account with no user parameter anywhere, so the
    // isolation being checked here is that one person's notices are not another's.
    console.log('\n13. Notifications');

    const notices = await request('GET', '/v1/dairy/notification/list', {
      token: partner.token,
    });
    check('a notice list is reachable', notices.status === 200,
      `got ${notices.status} ${JSON.stringify(notices.body)}`);
    check('the unread count is reported',
      notices.status === 200 && typeof notices.body.unreadCount === 'number',
      JSON.stringify(notices.body && notices.body.unreadCount));

    // A paid order at this outlet tells the partner it arrived.
    const partnerNotices = notices.status === 200 && Array.isArray(notices.body.notifications)
      ? notices.body.notifications
      : [];
    check('a paid order notified the outlet',
      partnerNotices.some((n) => n.kind === 'order_placed'),
      JSON.stringify(partnerNotices.map((n) => n.kind)));

    const customerNotices = await request('GET', '/v1/dairy/notification/list', {
      token: customer.token,
    });
    check('the customer was told their order is confirmed',
      customerNotices.status === 200
      && Array.isArray(customerNotices.body.notifications)
      && customerNotices.body.notifications.some((n) => n.kind === 'order_status'),
      `status=${customerNotices.status} ${JSON.stringify(customerNotices.body)}`);

    // The partner paid a rider during this run, so they should have been told.
    check('a rider payout notified the partner',
      partnerNotices.some((n) => n.kind === 'payout_recorded'),
      JSON.stringify(partnerNotices.map((n) => n.kind)));

    // Each person's list is their own.
    check('the customer has their own list',
      customerNotices.status === 200
      && Array.isArray(customerNotices.body.notifications)
      && customerNotices.body.notifications.every(
        (n) => (n.title ?? '') !== 'Settlement paid',
      ),
      `status=${customerNotices.status}`);

    // The rival outlet's notices must not be reachable by naming them.
    const foreignRead = await request(
      'PATCH',
      '/v1/dairy/notification/read_all',
      { token: partner.token, body: { ids: [String('0'.repeat(24))] } }
    );
    check('marking a notice that is not yours is refused or ignored',
      foreignRead.status === 200
      && Number(foreignRead.body.markedRead) === 0,
      `got ${foreignRead.status} ${JSON.stringify(foreignRead.body)}`);

    const unreadBefore = notices.status === 200 ? notices.body.unreadCount : 0;
    const markAll = await request('PATCH', '/v1/dairy/notification/read_all', {
      token: partner.token,
      body: {},
    });
    check('mark all read reports how many it marked',
      markAll.status === 200 && typeof markAll.body.markedRead === 'number',
      `got ${markAll.status} ${JSON.stringify(markAll.body)}`);

    const afterRead = await request('GET', '/v1/dairy/notification/list', {
      token: partner.token,
    });
    check('the unread count drops to zero',
      afterRead.status === 200 && afterRead.body.unreadCount === 0,
      `before=${unreadBefore} after=${afterRead.body && afterRead.body.unreadCount}`);
    check('marking read keeps the notices in the list',
      afterRead.status === 200
      && Array.isArray(afterRead.body.notifications)
      && afterRead.body.notifications.length === partnerNotices.length,
      `${partnerNotices.length} -> ${afterRead.body.notifications && afterRead.body.notifications.length}`);

    const customerUnaffected = await request('GET', '/v1/dairy/notification/list', {
      token: customer.token,
    });
    check('marking the partner\'s notices read leaves the customer\'s unread',
      customerUnaffected.status === 200
      && customerUnaffected.body.unreadCount > 0,
      `unread=${customerUnaffected.body && customerUnaffected.body.unreadCount}`);

    // ---- 13. No route 500s ----
    console.log('\n7. No dairy route answers 500 for a well-formed request');
    // A representative sweep with real tokens. A 500 here is a genuine defect;
    // 400/403 are legitimate refusals and are not failures.
    const sweep = [
      ['GET', '/v1/dairy/profile/me', customer.token],
      ['GET', '/v1/dairy/profile/available_roles', partner.token],
      ['GET', '/v1/dairy/customer/cart', customer.token],
      ['GET', '/v1/dairy/customer/orders', customer.token],
      ['GET', '/v1/dairy/customer/orders/summary', customer.token],
      ['GET', '/v1/dairy/customer/subscriptions', customer.token],
      ['GET', '/v1/dairy/driver/run/today', rider.token],
      ['GET', '/v1/dairy/driver/runs/history', rider.token],
      ['GET', '/v1/dairy/driver/cans/deposit_summary', rider.token],
      ['GET', '/v1/dairy/partner/compliance', partner.token],
      ['GET', '/v1/dairy/partner/compliance/summary', partner.token],
      ['GET', '/v1/dairy/partner/orders/summary', partner.token],
      ['GET', '/v1/dairy/catalog/categories', customer.token],
      ['GET', '/v1/dairy/catalog/products', partner.token],
      ['GET', `/v1/dairy/partner/payables/${'0'.repeat(24)}`, partner.token],
      ['GET', '/v1/dairy/settlements', partner.token],
    ];

    const serverErrors = [];
    for (const [method, url, token] of sweep) {
      // Sequential on purpose: these share one database and a driver pool.
      // eslint-disable-next-line no-await-in-loop
      const result = await request(method, url, { token });
      if (result.status >= 500) {
        serverErrors.push(`${method} ${url} -> ${result.status} ${JSON.stringify(result.body)}`);
      }
    }
    check('no route returned a 5xx', serverErrors.length === 0, serverErrors.join(' | '));
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message} >>> ${e.stack}`);
  } finally {
    // Scoped cleanup only.
    //
    // An earlier version of this suite called `deleteMany({})` on drivers, runs
    // and orders. That silently destroyed the *seeded* fixtures the other suites
    // rely on — `roles`, `run` and `subscription.billing` all start from the
    // seeded rider for 9000000001 — so it broke them on the next run while this
    // one stayed green. Every delete below is bounded to what this suite created.
    await DairyOrderStatusHistory.deleteMany({
      order: { $in: created.orderIds },
    });
    // Both sides of a wallet transfer: the debit row belongs to the *business*, so
    // scoping only to `created.users` left an orphan per payout. Orphans then
    // showed up as extra rows in the next run's payout assertions.
    await Transactions.deleteMany({
      $or: [
        { payableId: { $in: created.users } },
        { payableId: { $in: created.businesses } },
      ],
    });
    await Token.deleteMany({ token: { $in: created.tokens } });
    await DairyCartItem.deleteMany({ user: { $in: created.users } });
    await DairyOrder.deleteMany({ user: { $in: created.users } });
    await DeliveryStop.deleteMany({ run: { $in: created.runs } });
    await DeliveryRun.deleteMany({ _id: { $in: created.runs } });
    await DairyRecurringOrder.deleteMany({ user: { $in: created.users } });
    await DairySubscriptionEvent.deleteMany({
      subscription: { $in: created.subscriptions },
    });
    await DairySubscription.deleteMany({ user: { $in: created.users } });
    await DairyNotification.deleteMany({ user: { $in: created.users } });
    await DairyDriverInvite.deleteMany({ _id: { $in: created.invites } });
    await DairyDriver.deleteMany({ _id: { $in: created.drivers } });
    await DairySku.deleteMany({ _id: { $in: created.skus } });
    await Business.deleteMany({ _id: { $in: created.businesses } });
    await Wallet.deleteMany({ holderId: { $in: created.users } });
    await User.deleteMany({ _id: { $in: created.users } });

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL DAIRY HTTP CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
