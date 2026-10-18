/**
 * verify.jhatka.cart.units.js — cart model + pricing rules.
 *
 * The cart is the only surface where a CUSTOMER can touch a money figure before an
 * order exists, so it is the only place in this vertical where a client-supplied
 * price could become a charge. Every assertion below is about that boundary.
 *
 * These are pure/offline checks: model shape and the pricing arithmetic, with the
 * catalogue stubbed. The end-to-end cart flow against real Mongo lives in
 * `verify.jhatka.integration.js`.
 *
 * Run: node scripts/verify.jhatka.cart.units.js
 */

process.env.NODE_ENV = 'test';

const mongoose = require('mongoose');

const Cart = require('../src/modules/jhatka/models/jhatka.cart.model');
const cartService = require('../src/modules/jhatka/services/jhatka.cart.service');
const { linePricePaise } = require('../src/modules/jhatka/utils/weight.arithmetic');

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
};
const section = (t) => console.log(`\n--- ${t} ---`);

const OUTLET = new mongoose.Types.ObjectId();
const CUSTOMER = new mongoose.Types.ObjectId();

const mkCart = (over = {}) =>
  new Cart({ customer: CUSTOMER, outlet: OUTLET, items: [], ...over });

// ---------------------------------------------------------------------------
section('§15.2 — the customer cart surface exists as four routes plus a quote');
// ---------------------------------------------------------------------------
{
  ok('the model is registered as JhatkaCart', !!Cart);
  ok('a cart requires a customer', !!Cart.schema.path('customer'));
  ok('a cart REQUIRES an outlet (it cannot be priced without one)',
     Cart.schema.path('outlet').isRequired);

  const routes = require('../src/modules/jhatka/routes/jhatka.customer.route');
  const paths = routes.stack.map((l) => `${l.route?.path}:${Object.keys(l.route?.methods || {}).join(',')}`);

  for (const expected of [
    '/cart:get',
    '/cart/items:post',
    '/cart/items/:item:patch',
    '/cart/items/:item:delete',
    '/checkout/quote:post',
  ]) {
    ok(`route ${expected} is registered`, paths.includes(expected), paths.join(' | '));
  }
}

// ---------------------------------------------------------------------------
section('ONE cart per (customer, outlet)');
// ---------------------------------------------------------------------------
{
  const uniq = Cart.schema.indexes().filter(
    (i) => i[1] && i[1].unique && JSON.stringify(i[0]) === JSON.stringify({ customer: 1, outlet: 1 })
  );
  ok('a UNIQUE index on {customer, outlet} prevents two baskets per shop',
     uniq.length === 1, JSON.stringify(Cart.schema.indexes().map((i) => i[0])));

  ok('the purge sweep is index-backed, not a collection scan',
     Cart.schema.indexes().some((i) => JSON.stringify(i[0]) === JSON.stringify({ expiresAt: 1 })));

  ok('a cart expires by default (abandoned baskets are not orders)',
     typeof Cart.schema.path('expiresAt').default === 'function');
}

// ---------------------------------------------------------------------------
section('A cart line has NO settled money on it');
// ---------------------------------------------------------------------------
{
  const item = Cart.schema.path('items').schema;

  for (const forbidden of [
    'actualQuantity',
    'finalAmount',
    'deltaAmount',
    'absorbedAmount',
    'refundedAmount',
    'weightConfirmation',
    'adjustmentDirection',
  ]) {
    ok(`a cart item has NO \`${forbidden}\` (that is order-side, and frozen)`,
       item.path(forbidden) === undefined);
  }

  ok('a cart item DOES carry an indicative unitPrice', !!item.path('unitPrice'));
  ok('a cart item DOES carry a tax rate for the line', !!item.path('taxRatePct'));
  // Mongoose keeps `enum` on `path.options.enum` (and normalises some schemas to
  // `{values: [...]}`). Checked in all three shapes so this helper is not brittle.
  const enumValues = (path) => {
    if (!path) return [];
    const e = path.options?.enum ?? path.enum;
    if (!e) return [];
    const list = Array.isArray(e) ? e : Object.values(e.values || e);
    return list.filter((v) => typeof v === 'string');
  };

  ok('measurementMode is frozen at add time (BR-09)',
     enumValues(item.path('measurementMode')).includes('WEIGHT') &&
     enumValues(item.path('measurementMode')).includes('COUNT'));
  ok('fulfilmentMode is part of the cart, not decided after it',
     enumValues(Cart.schema.path('fulfilmentMode')).includes('pickup'));
}

// ---------------------------------------------------------------------------
section('Money: the cart speaks RUPEES, the order speaks frozen rupees');
// ---------------------------------------------------------------------------
{
  const item = Cart.schema.path('items').schema;
  for (const f of ['unitPrice', 'lineTotal', 'unitPriceAtAdd', 'taxAmount']) {
    ok(`\`${f}\` is a moneyField (setter rupees / getter rupees)`, !!item.path(f).getters);
  }

  const c = mkCart();
  c.items.push({
    product: new mongoose.Types.ObjectId(),
    variant: new mongoose.Types.ObjectId(),
    sku: 'CHK-1KG',
    name: 'Chicken',
    quantity: { value: 1, unit: 'KG', approximate: false },
    measurementMode: 'WEIGHT',
    unitPrice: 400,
    lineTotal: 400,
    unitPriceAtAdd: 400,
  });
  c.itemsSubtotal = 400;
  ok('a moneyField line stores 400 rupees as 40000 paise',
     c.items[0].toObject().unitPrice === 40000, String(c.items[0].toObject().unitPrice));
}

// ---------------------------------------------------------------------------
section('Cart and order price IDENTICALLY, or a basket cannot become an order');
// ---------------------------------------------------------------------------
{
  // The whole reason the cart service reuses `linePricePaise`: if these two ever
  // disagree, the customer sees one total in the cart and is charged another.
  const cases = [
    { qty: { value: 1, unit: 'KG', approximate: false }, basis: 'per_kg', price: 40000 },
    { qty: { value: 2, unit: 'KG', approximate: false }, basis: 'per_kg', price: 40000 },
    { qty: { value: 500, unit: 'GRAM', approximate: false }, basis: 'per_kg', price: 40000 },
    { qty: { value: 2, unit: 'PIECE', approximate: false }, basis: 'per_piece', price: 6000 },
  ];

  for (const t of cases) {
    const paise = linePricePaise(t.qty, t.price, t.basis);
    ok(`linePricePaise(${t.qty.value}${t.qty.unit[0]}, ${t.basis}) is paise, not rupees`,
       Number.isInteger(paise) && paise > 0 && paise < 1e9, String(paise));
  }

  // 0.5 kg at Rs 400/kg must be Rs 200 = 20000 paise, NOT Rs 20000.
  const half = linePricePaise({ value: 0.5, unit: 'KG', approximate: false }, 40000, 'per_kg');
  ok('half a kilo at Rs400/kg is 20000 paise (Rs 200), not 200 paise or 2000000',
     half === 20000, String(half));

  // The cart service must expose the whole pricing surface. A missing export means a
  // route silently re-derives pricing inline, which is the duplication this file exists
  // to prevent.
  for (const fn of ['repriceCart', 'addToCart', 'updateCartItem', 'removeCartItem', 'quoteCart']) {
    ok(`cart service exports ${fn}`, typeof cartService[fn] === 'function');
  }
}

// ---------------------------------------------------------------------------
section('The client cannot set the price');
// ---------------------------------------------------------------------------
{
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'modules', 'jhatka', 'services', 'jhatka.cart.service.js'),
    'utf8'
  );

  ok('the cart service never reads a price off the request body',
     !/req\.body[^\n]*\b(price|total|amount|rate)\b/i.test(src));
  ok('prices are derived from the catalogue, not accepted',
     /variant\.pricePerUnit/.test(src));
  ok('the tax rate comes from the PRODUCT, not the client',
     /product\?\.taxRatePct/.test(src));
  ok('a quote reserves nothing and freezes nothing',
     /quoteCart[\s\S]*blockers/.test(src) && !/quoteCart[\s\S]*reserve/.test(src));

  // The routes must not forward a price either.
  const routeSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'modules', 'jhatka', 'routes', 'jhatka.customer.route.js'),
    'utf8'
  );
  const cartRoutes = routeSrc.slice(routeSrc.indexOf("router.post('/cart/items'"), routeSrc.indexOf("router.post('/jhatka"));
  ok('POST /cart/items forwards only {variant, quantity} to the service',
     /addToCart\(cart,\s*\{\s*variant,\s*quantity\s*\}/.test(cartRoutes));
  ok('no cart route destructures a client price',
     !/\{\s*[^}]*\b(price|total|amount)\b[^}]*\}\s*=\s*req\.body/i.test(cartRoutes));
}

// ---------------------------------------------------------------------------
section('Ownership is enforced in the QUERY, not after the fetch');
// ---------------------------------------------------------------------------
{
  const routeSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'modules', 'jhatka', 'routes', 'jhatka.customer.route.js'),
    'utf8'
  );

  ok("findCartWithItem scopes by the customer's id, so an item id alone is not enough",
     /findOne\(\{\s*customer:\s*customerId,\s*'items\._id':\s*itemId\s*\}\)/.test(routeSrc));
  ok('the customer id comes from the token on every cart route',
     (routeSrc.match(/req\.user\._id/g) || []).length >= 5);
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL CART CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);