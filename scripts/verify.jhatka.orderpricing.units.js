/**
 * verify.jhatka.orderpricing.units.js — the paise/rupee contract at the last boundary.
 *
 * ## Why this is a separate suite
 *
 * `priceOrderLines` is the one place a customer's basket becomes money. It receives
 * LEAN reads (raw paise) and returns values destined for `moneyField`s (rupees). Every
 * one of the 100x defects in this vertical happened exactly at a boundary like this
 * one, and none of them threw — a wrong total is still a valid number.
 *
 * These assertions pin BOTH directions:
 *   - a PAISE value assigned where RUPEES is expected  -> must be 100x
 *   - a RUPEES getter read fed to a PAISE helper       -> must be 100x SMALL
 *
 * Getting the direction wrong is silent either way, so the test states both.
 *
 * Run: node scripts/verify.jhatka.orderpricing.units.js
 */

process.env.NODE_ENV = 'test';

const mongoose = require('mongoose');
const { linePricePaise, codCeilingPaise } = require('../src/modules/jhatka/utils/weight.arithmetic');
const { toPaiseAmount } = require('../src/modules/jhatka/utils/money');
const { priceOrderLines, codCeilingFor } = require('../src/modules/jhatka/services/jhatka.order-pricing.service');
const Order = require('../src/modules/jhatka/models/jhatka.order.model');

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n--- ${t} ---`);

const oid = () => new mongoose.Types.ObjectId();

// LEAN-shaped inputs, exactly as the route passes them: PAISE prices, no getters.
const leanVariant = (over = {}) => ({
  _id: oid(),
  product: oid(),
  sku: 'CHK-1KG',
  name: 'Chicken 1kg',
  unitLabel: 'kg',
  measurementMode: 'WEIGHT',
  priceBasis: 'per_kg',
  pricePerUnit: 40000, // Rs 400, raw paise as a lean read returns it
  image: undefined,
  ...over,
});

const leanProduct = (taxRatePct = 5) => ({
  _id: oid(),
  name: 'Chicken Curry Cut',
  category: oid(),
  hsnCode: '02071400',
  taxRatePct,
  prepNotes: undefined,
  storageNotes: undefined,
  allergens: [],
});

/**
 * Price the way the ROUTE does: `items` carry variant IDs, and the service resolves
 * each against the `variants` array it is given. The earlier helper passed variant
 * OBJECTS as `variant`, which is not the contract.
 */
const priceOnce = (items, productById, variants, overrideByVariant = new Map()) =>
  priceOrderLines({ items, variants, productById, overrideByVariant });

// ---------------------------------------------------------------------------
section('a lean PAISE price becomes a RUPEES moneyField');
// ---------------------------------------------------------------------------
{
  const v = leanVariant();
  const p = leanProduct();
  const productById = new Map([[String(v.product), p]]);

  const r = priceOnce(
    [{ variant: String(v._id), quantity: { value: 1, unit: 'KG', approximate: false } }],
    productById,
    [v]
  );

  ok('lineTotal is RUPEES on the order item (400, not 40000)',
     r.orderItems[0].lineTotal === 400, String(r.orderItems[0].lineTotal));
  ok('unitPrice is RUPEES on the order item',
     r.orderItems[0].unitPrice === 400, String(r.orderItems[0].unitPrice));
  ok('the accumulator is PAISE (40000, not 400)',
     r.itemsSubtotalPaise === 40000, String(r.itemsSubtotalPaise));

  // The pre-fix shape, so the regression cannot return silently.
  const wrong = { ...r.orderItems[0], lineTotal: r.itemsSubtotalPaise };
  ok('assigning PAISE into a line moneyField would be 100x WRONG',
     wrong.lineTotal === 40000, String(wrong.lineTotal));
}

// ---------------------------------------------------------------------------
section('a RUPEES getter read fed to a PAISE helper is 100x too small');
// ---------------------------------------------------------------------------
{
  // Build a real document so the moneyField GETTER is exercised, not a stand-in.
  const doc = new Order({
    orderNo: 'JH-PRICE-1',
    customer: oid(), outlet: oid(), business: oid(),
    businessModel: 'commission_partner',
    lifecycle: 'CREATED',
    items: [{
      product: oid(), variant: oid(), sku: 'X', name: 'X', hsnCode: '1',
      taxRatePct: 5, taxPercentage: 0, isVariableWeight: true, measurementMode: 'WEIGHT',
      unitLabel: 'kg', priceBasis: 'per_kg', unitPrice: 400, lineTotal: 400, lineGrand: 420,
      requestedQuantity: { value: 1, unit: 'KG', approximate: false },
      estimatedAmount: 400,
    }],
    itemsSubtotal: 400, taxTotal: 20, estimatedTotal: 420,
  });

  ok('a hydrated moneyField getter returns RUPEES (400)',
     doc.estimatedTotal === 420, String(doc.estimatedTotal));
  ok('a .lean() read returns raw PAISE (42000)',
     doc.toObject().estimatedTotal === 42000, String(doc.toObject().estimatedTotal));

  const qty = { value: 1, unit: 'KG', approximate: false };
  const viaGetter = linePricePaise(qty, doc.items[0].unitPrice, 'per_kg');
  const viaPaise = linePricePaise(qty, toPaiseAmount(doc.items[0].unitPrice), 'per_kg');

  ok('passing the RUPEES getter straight to a PAISE helper gives 100x too little',
     viaGetter === 400, String(viaGetter));
  ok('toPaiseAmount first gives the correct 40000',
     viaPaise === 40000, String(viaPaise));
}

// ---------------------------------------------------------------------------
section('estimatedTotal includes tax — the BR-06 comparison depends on it');
// ---------------------------------------------------------------------------
{
  const v = leanVariant();
  const p = leanProduct(5);
  const productById = new Map([[String(v.product), p]]);

  const r = priceOnce(
    [{ variant: String(v._id), quantity: { value: 1, unit: 'KG', approximate: false } }],
    productById,
    [v]
  );

  ok('estimatedTotalPaise = subtotal + tax (42000, not 40000)',
     r.estimateTotalLocal === 42000, String(r.estimateTotalLocal));
  ok('subtotal alone would have been 40000 — omitting tax is the old bug',
     r.itemsSubtotalPaise === 40000, String(r.itemsSubtotalPaise));
}

// ---------------------------------------------------------------------------
section('a per-outlet price override wins over the catalogue');
// ---------------------------------------------------------------------------
{
  const v = leanVariant();
  const p = leanProduct(0);
  const productById = new Map([[String(v.product), p]]);
  const overrides = new Map([[String(v._id), { price: 35000 }]]); // Rs 350, paise

  const r = priceOnce(
    [{ variant: String(v._id), quantity: { value: 1, unit: 'KG', approximate: false } }],
    productById,
    [v],
    overrides
  );

  ok('the override price is used, not the catalogue price',
     r.orderItems[0].unitPrice === 350, String(r.orderItems[0].unitPrice));
  ok('...and the total follows it',
     r.itemsSubtotalPaise === 35000, String(r.itemsSubtotalPaise));
}

// ---------------------------------------------------------------------------
section('COD ceiling and the payment-mode branch');
// ---------------------------------------------------------------------------
{
  const estimated = 42000;
  const cod = codCeilingFor({ goodsPlusTaxPaise: estimated, paymentMode: 'cod' });
  ok('COD applies a 10% ceiling over the post-tax total',
     cod === codCeilingPaise(estimated) && cod > estimated, String(cod));

  const gw = codCeilingFor({ goodsPlusTaxPaise: estimated, paymentMode: 'gateway' });
  ok('a gateway order collects nothing at the door', gw === 0, String(gw));
}

// ---------------------------------------------------------------------------
section('measurement-mode guards still reject nonsense');
// ---------------------------------------------------------------------------
{
  const v = leanVariant({ measurementMode: 'COUNT', priceBasis: 'per_piece' });
  const p = leanProduct();
  const productById = new Map([[String(v.product), p]]);

  let rejected = null;
  try {
    priceOnce([{ variant: String(v._id), quantity: { value: 3, unit: 'KG', approximate: false } }], productById, [v]);
  } catch (e) { rejected = e; }

  ok('3 KG of a COUNT variant is refused', !!rejected, String(rejected));
  ok('...and the message names the incompatibility',
     /incompatible/.test(rejected?.message || ''), String(rejected?.message));
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL ORDER-PRICING CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);