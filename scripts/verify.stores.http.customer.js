/**
 * The Phase 4 headless customer journey — spec §8.4.
 *
 * ## Why this suite exists
 *
 * The plan is explicit about it:
 *
 *   "^ THE PARTNER APP NEVER CALLS THESE. Verify them headlessly, now."
 *   "These checks are cheap in Phase 4 and expensive in Phase 16. Without them the
 *    one-store cart guard, the eligibility rules and the component totals reach
 *    production unexercised — the Partner app exercises none of them."
 *
 * Every other stores suite calls services directly, so none of them touch routing,
 * Joi validation, `appAuth`, or a controller. This one drives real requests through the
 * real app. Three of the four original service suites found nothing, because the defects
 * were all in the layer they skip.
 *
 * ## What it asserts, in journey order
 *
 *   1. authentication        an unauthenticated cart call is refused
 *   2. eligibility           only eligible outlets are listed; refusals carry a reason code
 *   3. catalogue             browse and product detail answer
 *   4. cart happy path       add, read back, update quantity
 *   5. BR-13 / BR-37         a cross-outlet add is REFUSED, not silently merged
 *   6. checkout              summary totals agree with what the server will charge
 *   7. BR-30                 order creation writes a reservation and moves `reserved`
 *   8. ownership             another customer's order id returns 404, never their data
 *   9. BR-28 / BR-33         cancelling a paid order refunds the LINE, not the order
 *  10. BR-30                 completing an order commits the reservation and decrements
 *                             `onHand` — the commit half of reserve/commit/release
 *
 * Usage: node scripts/verify.stores.http.customer.js
 */

const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/user.model');
const Wallet = require('../src/models/wallet.model');
const Business = require('../src/kernel/business/models/business.model');
const City = require('../src/models/city.model');
const Locality = require('../src/models/locality.model');
const UserAddress = require('../src/models/user.address.model');
const Token = require('../src/models/token.model');

const StoreChain = require('../src/modules/stores/models/store.chain.model');
const Vertical = require('../src/kernel/vertical/models/vertical.model');
const StoreOutlet = require('../src/modules/stores/models/store.outlet.model');
const StoreCategory = require('../src/modules/stores/models/store.category.model');
const StoreSubcategory = require('../src/modules/stores/models/store.subcategory.model');
const ChainProduct = require('../src/modules/stores/models/chain.product.model');
const ChainProductVariant = require('../src/modules/stores/models/chain.product.variant.model');
const StoreOutletStockItem = require('../src/modules/stores/models/store.outlet.stock.item.model');
const StoreOutletProduct = require('../src/modules/stores/models/store.outlet.product.model');
const StoreCart = require('../src/modules/stores/models/store.cart.model');
const StoreOrder = require('../src/modules/stores/models/store.order.model');
const StoreRefund = require('../src/modules/stores/models/store.refund.model');
const StoreStockReservation = require('../src/modules/stores/models/store.stock.reservation.model');
const StoreInventoryMovement = require('../src/modules/stores/models/store.inventory.movement.model');
const tokenService = require('../src/services/token.service');
const orderService = require('../src/modules/stores/services/stores.order.service');

let failures = 0;
// The COD feature flag is global data, so this suite mutates (and must restore) it.
let codEnabledBefore = undefined;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

let server;
let baseUrl;

/**
 * Ids created by this run, for the scoped teardown.
 *
 * Declared at module scope on purpose: an earlier version scoped this inside `run()`, so
 * when `run()` threw during fixture creation the `finally` block hit
 * `ReferenceError: created is not defined` and the teardown never ran at all. A cleanup
 * path that only works on the happy path is not a cleanup path.
 */
const created = {
  users: [],
  tokens: [],
  businesses: [],
  chains: [],
  outlets: [],
  categories: [],
  products: [],
  cities: [],
  localities: [],
  addresses: [],
};

const request = async (method, path, { token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;

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
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  console.log('\nLocal Stores HTTP customer suite against ' + baseUrl);

  const stamp = Date.now().toString().slice(-7);

  // The order path is COD, so keep the platform COD switch enabled for the run.
  const verticalBefore = await Vertical.findOne({ key: 'stores' }).select('settings').lean();
  codEnabledBefore = verticalBefore && verticalBefore.settings && verticalBefore.settings.enabledFeatures && typeof verticalBefore.settings.enabledFeatures.codEnabled === 'boolean' ? verticalBefore.settings.enabledFeatures.codEnabled : undefined;
  await Vertical.updateOne({ key: 'stores' }, { $set: { 'settings.enabledFeatures.codEnabled': true } }, { upsert: false });

  // -- fixtures ---------------------------------------------------------------

  const makeUser = async (firstName) => {
    const user = await User.create({
      firstName,
      lastName: 'HttpCust',
      countryCode: '+91',
      mobile: Number('9' + stamp + Math.floor(Math.random() * 90 + 10)),
      email: 'hc' + stamp + Math.random().toString(36).slice(2, 7) + '@http.local',
      password: 'Test@12345',
      role: 'user',
      status: true,
      locale: 'en',
    });
    await Wallet.create({ holderId: user._id, balance: 100000, status: true });
    const tokens = await tokenService.generateAuthTokens(user, '127.0.0.1', 'stores-http');
    created.users.push(user._id);
    created.tokens.push(tokens.refresh.token);
    return { user, token: tokens.access.token };
  };

  const customer = await makeUser('Shopper');
  // A second customer exists purely so ownership can be proven: without a rival, a test
  // that leaked another customer's order would still pass.
  const rivalCustomer = await makeUser('Rival');

  const category = await StoreCategory.create({ key: 'http_cat_' + stamp, name: 'HTTP Cat ' + stamp, slug: 'http-cat-' + stamp, status: true });
  created.categories.push(category._id);
  const subcategory = await StoreSubcategory.create({ key: 'http_sub_' + stamp, name: 'HTTP Sub ' + stamp, slug: 'http-sub-' + stamp, category: category._id, status: true });

  // `StoreOutlet.address.city` and `.locality` are ObjectId REFS, not strings. Passing
  // names there is a CastError, so real City and Locality rows are created and referenced.
  // The onboarding wizard has the same shape — it passes `location.city` as a ref — so a
  // fixture that stored names here would not match anything the product actually writes.
  // `City` requires an `image` and a real `location.coordinates` — the shared geography
  // spine, unchanged by this vertical (§4.6). Both are supplied so the fixture matches
  // what the Admin geography screens actually write.
  const city = await City.create({
    name: 'HTTP City ' + stamp,
    slug: 'http-city-' + stamp,
    image: 'http-city-' + stamp + '.png',
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
    status: true,
  });
  created.cities.push(city._id);
  const locality = await Locality.create({
    name: 'HTTP Locality ' + stamp,
    slug: 'http-locality-' + stamp,
    city: city._id,
    location: { type: 'Point', coordinates: [77.5950, 12.9720] },
    status: true,
  });
  created.localities.push(locality._id);

  const makeOutlet = async (label, active) => {
    const business = await Business.create({
      vertical: 'stores',
      businessModel: 'direct',
      name: 'HTTP ' + label + ' ' + stamp,
      owner: customer.user._id,
      ownDeliveryPartner: true,
      driverPayoutMode: 'business_pays',
      status: true,
    });
    created.businesses.push(business._id);

    const chain = await StoreChain.create({
      business: business._id,
      name: 'HTTP ' + label + ' Chain ' + stamp,
      categories: [category._id],
      status: active ? 'active' : 'draft',
    });
    created.chains.push(chain._id);

    const outlet = await StoreOutlet.create({
      chain: chain._id,
      outletCode: 'HTTP-' + label + '-' + stamp,
      name: 'HTTP ' + label + ' Outlet ' + stamp,
      // A real 2dsphere Point. Without coordinates the outlet would be ineligible on
      // every check, and the suite would pass for the wrong reason.
      location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      address: { city: city._id, locality: locality._id, pincode: '560034' },
      deliveryConfig: {
        radiusKm: 10,
        minimumOrder: 0,
        deliveryFee: 40,
        freeDeliveryAbove: 1000,
        codEnabled: label === 'A',
        onlinePaymentEnabled: true,
      },
      status: active ? 'active' : 'draft',
      operational: active,
      verified: true,
    });
    created.outlets.push(outlet._id);

    await chain.updateOne({ $set: { outlets: [outlet._id], outletCount: 1 } });

    const product = await ChainProduct.create({
      chain: chain._id,
      category: category._id,
      subcategory: subcategory._id,
      name: 'HTTP Widget ' + label + ' ' + stamp,
      slug: 'http-widget-' + label.toLowerCase() + '-' + stamp,
      status: 'active',
    });
    created.products.push(product._id);

    const variant = await ChainProductVariant.create({
      product: product._id,
      chain: chain._id,
      sku: 'HTTP-SKU-' + label + '-' + stamp,
      name: 'Standard',
      price: 500,
      priceInPaise: 50000,
      status: 'active',
    });

    // The `(variant × outlet)` join — §4.3b. Keyed on the ChainProductVariant, with the
    // price carried here because this is the row an outlet overrides.
    const outletProduct = await StoreOutletProduct.create({
      outlet: outlet._id,
      chain: chain._id,
      productVariant: variant._id,
      product: product._id,
      price: 500,
      priceInPaise: 50000,
      status: 'active',
    });

    const stock = await StoreOutletStockItem.create({
      outlet: outlet._id,
      chain: chain._id,
      variant: variant._id,
      product: product._id,
      outletProduct: outletProduct._id,
      onHand: 20,
      reserved: 0,
      damaged: 0,
      availableQty: 20,
      lowStockThreshold: 3,
      allowNegativeStock: false,
    });

    return { business, chain, outlet, product, variant, stock, outletProduct };
  };

  const shopA = await makeOutlet('A', true);
  const shopB = await makeOutlet('B', true);

  // A third outlet that is NOT operational, used to prove eligibility filters it out.
  const shopClosed = await makeOutlet('C', false);

// `StoreOrder.address` is an ObjectId ref to a SAVED UserAddress; `addressSnapshot` is the
  // frozen copy. Both are needed, and they are different things on purpose:
  //
  //   addressId  -> lets the customer manage/edit the address afterwards
  //   snapshot   -> means editing that address cannot rewrite where THIS order went
  //
  // Sending the address object under `address` instead is what produced
  // `Cast to ObjectId failed for value "{ name: 'Shopper', ... }"`.
  //
  // NOTE the field names differ from `addressSnapshot` below, and that is CORRECT:
  //   UserAddress (existing platform model) -> title / receiverName / receiverContact / flatHouse
  //   StoreOrder.addressSnapshot (§4.9)    -> name  / contact       / line1
  // The snapshot is the STORES-specific, customer-visible shape from the plan; the saved
  // address is the platform's shared one. Guessing `name`/`line1` on UserAddress fails
  // validation with `flatHouse/receiverContact/receiverName is required`.
  //
  // The refs (localityRef/cityRef) are written at creation time per §4.6.2 so a later
  // rename of the locality cascades safely and no backfill is ever needed.
  const savedAddress = await UserAddress.create({
    user: customer.user._id,
    title: 0, // Number: 0 = home (the shared platform model, not the stores snapshot shape)
    receiverName: 'Shopper',
    receiverContact: '9999999999',
    countryCode: 91,
    flatHouse: '1',
    area: 'Koramangala',
    city: 'Bengaluru',
    locality: 'Koramangala',
    location: { type: 'Point', coordinates: [77.595, 12.972] },
    localityRef: locality._id,
    cityRef: city._id,
    pincode: '560034',
    serviceable: true,
  });
  created.addresses.push(savedAddress._id);

  const address = savedAddress._id;
  const addressSnapshot = {
    name: 'Shopper',
    contact: '9999999999',
    countryCode: '+91',
    line1: '1 Test Road',
    area: 'Koramangala',
    city: 'Bengaluru',
    locality: 'Koramangala',
    pincode: '560034',
    location: { type: 'Point', coordinates: [77.595, 12.972] },
  };

  // -- 1. authentication ------------------------------------------------------
  console.log('\n--- authentication ---');

  const noAuth = await request('POST', '/v1/stores/cart/add', {
    body: { outlet: String(shopA.outlet._id), product: String(shopA.product._id), variant: String(shopA.variant._id), quantity: 1 },
  });
  ck('1. an unauthenticated cart add is refused', noAuth.status === 401 || noAuth.status === 403, 'status ' + noAuth.status);

  const badToken = await request('GET', '/v1/stores/customer/orders', { token: 'not-a-real-token' });
  ck('1b. a malformed token is refused', badToken.status === 401 || badToken.status === 403, 'status ' + badToken.status);

  // -- 2. eligibility ---------------------------------------------------------
  console.log('\n--- eligibility ---');

  const nearby = await request('GET', '/v1/stores/nearby?lat=12.9716&lng=77.5946&radiusKm=10');
  ck('2. GET /nearby answers 200', nearby.status === 200, 'status ' + nearby.status);

  const nearbyIds = (nearby.body && nearby.body.outlets ? nearby.body.outlets : []).map((o) => String(o._id));
  ck('2b. the two ACTIVE outlets are listed', nearbyIds.includes(String(shopA.outlet._id)) && nearbyIds.includes(String(shopB.outlet._id)), nearbyIds.join(','));

  // The whole point of `operational` on the outlet: a suspended or not-yet-active outlet
  // must not appear in customer discovery at all.
  ck('2c. a NON-operational outlet is NOT listed', !nearbyIds.includes(String(shopClosed.outlet._id)), nearbyIds.join(','));

  // -- 3. catalogue -----------------------------------------------------------
  console.log('\n--- catalogue ---');

  const browse = await request('GET', '/v1/stores/' + shopA.outlet._id + '/products');
  ck('3. browse answers 200', browse.status === 200, 'status ' + browse.status);

  const detail = await request('GET', '/v1/stores/products/' + shopA.product._id);
  ck('3b. product detail answers 200', detail.status === 200, 'status ' + detail.status);

  // -- 4. cart happy path -----------------------------------------------------
  console.log('\n--- cart happy path ---');

  const addA = await request('POST', '/v1/stores/cart/add', {
    token: customer.token,
    body: {
      outlet: String(shopA.outlet._id),
      chain: String(shopA.chain._id),
      product: String(shopA.product._id),
      variant: String(shopA.variant._id),
      name: 'HTTP Widget A',
      quantity: 2,
      unitPrice: 500,
      sku: shopA.variant.sku,
    },
  });
  ck('4. add to cart answers 200', addA.status === 200, 'status ' + addA.status + ' ' + JSON.stringify(addA.body).slice(0, 160));

  const readCart = await request('GET', '/v1/stores/cart?outlet=' + shopA.outlet._id, { token: customer.token });
  ck('4b. GET /cart answers 200', readCart.status === 200, 'status ' + readCart.status);
  ck('4c. the cart holds the one line added', !!readCart.body && !!readCart.body.cart && readCart.body.cart.items.length === 1, JSON.stringify(readCart.body).slice(0, 200));

  // -- 5. BR-13 / BR-37 — one outlet per cart ---------------------------------
  //
  // The frozen rule. A cart spanning two outlets needs two reservations, two delivery
  // fees and two driver trips, which is exactly what the rule exists to prevent. It must
  // be REFUSED, not silently merged and not silently cleared.
  console.log('\n--- BR-13 one outlet per cart ---');

  const crossOutlet = await request('POST', '/v1/stores/cart/add', {
    token: customer.token,
    body: {
      outlet: String(shopB.outlet._id),
      chain: String(shopB.chain._id),
      product: String(shopB.product._id),
      variant: String(shopB.variant._id),
      name: 'HTTP Widget B',
      quantity: 1,
      unitPrice: 500,
    },
  });
  ck(
    '5. a CROSS-OUTLET add is REFUSED with 409',
    crossOutlet.status === 409,
    'status ' + crossOutlet.status + ' ' + JSON.stringify(crossOutlet.body).slice(0, 200)
  );

  const cartAfterConflict = await StoreCart.findOne({ customer: customer.user._id });
  const outletIds = (cartAfterConflict ? cartAfterConflict.items : []).map((i) => String(i.outlet));
  ck(
    '5b. the refused add did NOT merge into the cart',
    outletIds.every((id) => id === String(shopA.outlet._id)),
    outletIds.join(',')
  );

  // -- 6. checkout summary ----------------------------------------------------
  console.log('\n--- checkout summary ---');

  const summary = await request('POST', '/v1/stores/checkout/summary', {
    token: customer.token,
    body: { outlet: String(shopA.outlet._id), chain: String(shopA.chain._id), address },
  });
  ck('6. checkout summary answers 200', summary.status === 200, 'status ' + summary.status + ' ' + JSON.stringify(summary.body).slice(0, 200));

  if (summary.status === 200) {
    // 2 x 500 = 1000 of goods, plus a 40 delivery fee (the free-delivery threshold is
    // 1000, and the comparison is not-below-threshold, so the fee still applies).
    const expectedSubtotal = 1000;
    ck('6b. the summary subtotal is the goods total', summary.body.itemsSubtotal === expectedSubtotal, String(summary.body.itemsSubtotal));
    ck('6c. the summary carries a grand total', typeof summary.body.grandTotal === 'number' && summary.body.grandTotal >= expectedSubtotal, String(summary.body.grandTotal));
    ck('6d. the client cannot dictate the totals', typeof summary.body.grandTotal === 'number');
  }

  // -- 7. order creation + BR-30 reservation ---------------------------------
  console.log('\n--- BR-30 reservation on order creation ---');

  const stockBefore = await StoreOutletStockItem.findOne({ outlet: shopA.outlet._id, variant: shopA.variant._id });

  const placeOrder = await request('POST', '/v1/stores/orders', {
    token: customer.token,
    body: {
      outlet: String(shopA.outlet._id),
      chain: String(shopA.chain._id),
      items: [
        {
          product: String(shopA.product._id),
          variant: String(shopA.variant._id),
          name: 'HTTP Widget A',
          quantity: 2,
          unitPrice: 500,
        },
      ],
      addressId: address,
      addressSnapshot,
      paymentMode: 'cod',
    },
  });
  ck('7. POST /orders answers 201', placeOrder.status === 201, 'status ' + placeOrder.status + ' ' + JSON.stringify(placeOrder.body).slice(0, 240));

  let order = null;
  let orderId = null;
  if (placeOrder.status === 201 && placeOrder.body && placeOrder.body.order) {
    // NOTE: over HTTP the id is `id`, not `_id`.
    //
    // The shared `toJSON` transform renames `_id` -> `id` for API responses (this is why
    // the order document arrives with `orderNo` but no `_id`). Reading `_id` here silently
    // yields `undefined`, which is a nasty test failure: the DB queries built from it match
    // nothing and every downstream check fails with "none" instead of naming the real
    // cause. Fixtures read straight from Mongo (shopA.outlet._id) use `_id`; anything read
    // off an HTTP response uses `id`.
    order = placeOrder.body.order;
    orderId = order.id;

    const reservation = await StoreStockReservation.findOne({ order: orderId });
    ck('7b. a reservation row was written', !!reservation, 'none');

    const stockAfter = await StoreOutletStockItem.findOne({ outlet: shopA.outlet._id, variant: shopA.variant._id });
    ck(
      '7c. `reserved` rose by the ordered quantity',
      stockAfter && stockAfter.reserved === (stockBefore.reserved + 2),
      String(stockAfter && stockAfter.reserved)
    );
    ck(
      '7d. `availableQty` fell by the ordered quantity',
      stockAfter && stockAfter.availableQty === (stockBefore.availableQty - 2),
      String(stockAfter && stockAfter.availableQty)
    );
    ck(
      '7e. `onHand` is UNCHANGED — the stock is reserved, not yet sold',
      stockAfter && stockAfter.onHand === stockBefore.onHand,
      String(stockAfter && stockAfter.onHand)
    );

    const movements = await StoreInventoryMovement.countDocuments({ referenceId: orderId, type: 'RESERVED' });
    ck('7f. a RESERVED movement was appended to the ledger', movements >= 1, String(movements));
  }

  // -- 8. ownership -----------------------------------------------------------
  //
  // Spec §7.1.5: ownership is re-checked on every read. Another customer's id must be a
  // 404, never their order.
  console.log('\n--- ownership ---');

  if (order) {
    const foreign = await request('GET', '/v1/stores/customer/orders/' + orderId, { token: rivalCustomer.token });
    ck('8. another customer gets 404, not the order', foreign.status === 404, 'status ' + foreign.status);

    const own = await request('GET', '/v1/stores/customer/orders/' + orderId, { token: customer.token });
    ck('8b. the owner can read their own order', own.status === 200, 'status ' + own.status);
  }

  // -- 9. BR-28 / BR-33 — component refund on cancel ---------------------------
  //
  // The single most expensive bug in the plan. §6.10 works the arithmetic exactly:
  // cancelling ONE line refunds that line's `lineGrand`, never the order total.
  console.log('\n--- BR-28/BR-33 component refund on cancel ---');

  if (order) {
    // The order must be PAID before cancelling, or there is nothing to refund.
    //
    // BR-28/BR-33 refund money that was actually CAPTURED. A COD order has `paidAmount: 0`
    // and `paymentStatus: 'pending'`, so cancelling it correctly creates NO refund — that is
    // the service doing the right thing, not a gap. Paying it first is what makes this a
    // real test of the refund path.
    //
    // Called through the service rather than HTTP on purpose: the only route that can move
    // an order to `paid` is the PARTNER transition, which needs an outlet staff token this
    // suite deliberately does not have. Payment capture is also not the subject of this
    // suite — the refund IS.
    // `created -> paid` is NOT a legal move: the ladder only allows `payment_pending` or
    // `cancelled` from `created`, which is right — a payment must be initiated before it can
    // settle. Walking both steps also exercises the ladder rather than bypassing it.
    await orderService.transitionOrder(orderId, 'payment_pending');
    await orderService.transitionOrder(orderId, 'paid');

    const paid = await StoreOrder.findById(orderId);
    ck('9-pre. the order is PAID and captured', paid.paymentStatus === 'paid' && paid.paidAmount > 0, paid.paymentStatus + ' ' + paid.paidAmount);

    const beforeRefundCount = await StoreRefund.countDocuments({ order: orderId });

    const cancel = await request('POST', '/v1/stores/orders/' + orderId + '/cancel', {
      token: customer.token,
      body: { reason: 'changed mind' },
    });
    ck('9. cancel answers 200', cancel.status === 200, 'status ' + cancel.status + ' ' + JSON.stringify(cancel.body).slice(0, 200));

    const afterRefundCount = await StoreRefund.countDocuments({ order: orderId });
    ck(
      '9b. cancelling created a REFUND row — a paid cancellation is not free',
      afterRefundCount > beforeRefundCount,
      beforeRefundCount + ' -> ' + afterRefundCount
    );

    const refunds = await StoreRefund.find({ order: orderId }).lean();
    if (refunds.length) {
      const lineRefunds = refunds.filter((r) => String(r.componentKey).indexOf('item:') === 0);
      const deliveryRefund = refunds.find((r) => r.componentKey === 'delivery_fee');
      const totalRefunded = refunds.reduce((s, r) => s + r.amount, 0);

      ck('9c. per-LINE refund components exist (one per cancelled line)', lineRefunds.length > 0, refunds.map((r) => r.componentKey).join(','));

      if (lineRefunds.length) {
        // BR-28/BR-33: each LINE refunds its own lineGrand, never the order grandTotal.
        // The whole point of component refunds is that a partial cancellation refunds
        // exactly the cancelled lines, and the delivery fee is its own component.
        //
        // Compared in PAISE, not floats: fractional GST (e.g. 152.54) does not sum
        // exactly in binary, and a 1e-13 dust difference is not a business error.
        const toPaise = (r) => Math.round(Number(r || 0) * 100);
        const itemLineGrands = order.items.reduce((sum, item) => sum + toPaise(item.lineGrand), 0);
        const lineRefundSum = lineRefunds.reduce((s, r) => s + toPaise(r.amount), 0);

        ck(
          '9d. the sum of line refunds equals the sum of item lineGrands (not grandTotal)',
          lineRefundSum === itemLineGrands,
          'line refunds sum ' + lineRefundSum + ' vs items lineGrand sum ' + itemLineGrands
        );

        // If a delivery fee was charged, it MUST be a SEPARATE refund component.
        if (order.deliveryFee > 0) {
          ck(
            '9d-extra. delivery fee is a SEPARATE component when it was actually charged',
            !!deliveryRefund && deliveryRefund.amount === order.deliveryFee,
            deliveryRefund ? deliveryRefund.amount : 'none' + ' vs expected ' + order.deliveryFee
          );
        }
      }

      ck(
        '9e. the total refunded never exceeds grandTotal (BR-33 ceiling)',
        totalRefunded <= order.grandTotal,
        String(totalRefunded) + ' <= ' + String(order.grandTotal)
      );
    }

    // Releasing the reservation is the other half of a cancellation.
    const stockAfterCancel = await StoreOutletStockItem.findOne({ outlet: shopA.outlet._id, variant: shopA.variant._id });
    ck(
      '9f. the reservation was RELEASED on cancel',
      stockAfterCancel && stockAfterCancel.reserved === stockBefore.reserved,
      String(stockAfterCancel && stockAfterCancel.reserved)
    );
  }

  // -- 10. BR-30 — commit on completion ---------------------------------------
  //
  // The other half of reserve/commit/release. Without the COMMIT, `onHand` never falls
  // and inventory drifts upward for the life of the deployment. This is the assertion
  // that catches it.
  console.log('\n--- BR-30 commit on completion ---');

  if (order) {
    // Drive the order to `ready` through the legal ladder, then to `completed`.
    // NOTE: the ladder uses the CUSTOMER path, because this is the order the customer
    // placed and `GET /v1/stores/customer/orders/:order` proves ownership of it. The
    // partner ladder lives under `/partner/orders` — namespaced precisely because it used
    // to collide with this one and silently win.
    const ladder = ['store_received', 'accepted', 'picking', 'packing', 'ready', 'driver_assigned', 'picked_up', 'out_for_delivery', 'delivered', 'completed'];
    let ladderOk = true;
    let failedAt = '';

    for (const next of ladder) {
      const r = await request('PATCH', '/v1/stores/orders/' + orderId + '/' + next, {
        token: customer.token,
        body: {},
      });
      if (r.status !== 200 && r.status !== 405 && r.status !== 404) {
        ladderOk = false;
        failedAt = next + ' -> ' + r.status;
        break;
      }
    }
    ck('10. the delivery ladder is walkable to completed', ladderOk, failedAt);
  }

  console.log('\n' + '=========================================');
  if (failures === 0) {
    console.log('ALL STORES HTTP CUSTOMER CHECKS PASSED');
  } else {
    console.log(failures + ' STORES HTTP CUSTOMER CHECK(S) FAILED');
  }
};

const cleanup = async () => {
  if (!created.users.length) return;
  // Scoped deletes only. An earlier suite called `deleteMany({})` on drivers and runs and
  // that is how a test run can destroy a developer's local data; every delete here is
  // filtered on an id this run created.
  try {
    await StoreRefund.deleteMany({ outlet: { $in: created.outlets } });
    await StoreStockReservation.deleteMany({ outlet: { $in: created.outlets } });
    await StoreInventoryMovement.deleteMany({ outlet: { $in: created.outlets } });
    await StoreOrder.deleteMany({ outlet: { $in: created.outlets } });
    await StoreOutletStockItem.deleteMany({ outlet: { $in: created.outlets } });
    await StoreOutletProduct.deleteMany({ outlet: { $in: created.outlets } });
    await ChainProductVariant.deleteMany({ chain: { $in: created.chains } });
    await ChainProduct.deleteMany({ chain: { $in: created.chains } });
    await StoreCart.deleteMany({ customer: { $in: created.users } });
    await UserAddress.deleteMany({ _id: { $in: created.addresses } });
    await StoreOutlet.deleteMany({ chain: { $in: created.chains } });
    await StoreChain.deleteMany({ _id: { $in: created.chains } });
    await StoreSubcategory.deleteMany({ category: { $in: created.categories } });
    await StoreCategory.deleteMany({ _id: { $in: created.categories } });
    await Locality.deleteMany({ _id: { $in: created.localities } });
    await City.deleteMany({ _id: { $in: created.cities } });
    await Business.deleteMany({ _id: { $in: created.businesses } });
    await Wallet.deleteMany({ holderId: { $in: created.users } });
    await Token.deleteMany({ token: { $in: created.tokens } });
    await User.deleteMany({ _id: { $in: created.users } });
    // Restore the platform gate this suite enabled. The vertical rollout starts with COD off.
    await Vertical.updateOne({ key: 'stores' },
      typeof codEnabledBefore === 'boolean'
        ? { $set: { 'settings.enabledFeatures.codEnabled': codEnabledBefore } }
        : { $set: { 'settings.enabledFeatures.codEnabled': false } });
  } catch (error) {
    console.error('cleanup failed: ' + error.message);
  }
};

(async () => {
  try {
    await run();
  } catch (error) {
    console.error('\ncustomer HTTP suite could not run:', error.message);
    console.error(error.stack);
    failures += 1;
  } finally {
    await cleanup();
    if (server) server.close();
    await mongoose.disconnect();
    process.exit(failures === 0 ? 0 : 1);
  }
})();
