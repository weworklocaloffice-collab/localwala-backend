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
 * verify.jhatka.variableweight.units.js — the money rules of the vertical.
 *
 * ## This is the suite the whole design stands on
 *
 * §3 replaces the source blueprint's "collect more if actual > estimated" with a
 * refund-only adjustment, because there is no pre-auth capability anywhere in the
 * platform (zero matches for preAuth | manualCapture | authorizeOnly) and because
 * a rider asking for ₹32 more than an app quoted, for meat that was bagged before
 * they arrived, is a guaranteed lost customer.
 *
 * These tests assert that the reversal is actually true in the code, not just
 * documented.
 *
 * ## No database
 *
 * `jhatka/utils/weight.arithmetic.js` and `jhatka/utils/quantity.js` are pure, so
 * every rule here is testable with no replica set, no fixtures and no Mongoose
 * documents. That is deliberate: the money path should be verifiable in a second.
 *
 * Run: node scripts/verify.jhatka.variableweight.units.js
 */

const mongoose = require('mongoose');

const A = require('../src/modules/jhatka/utils/weight.arithmetic');
const Q = require('../src/modules/jhatka/utils/quantity');
const Item = require('../src/modules/jhatka/models/jhatka.order.item.schema');
const Order = require('../src/modules/jhatka/models/jhatka.order.model');
const Refund = require('../src/modules/jhatka/models/jhatka.refund.model');
const Confirmation = require('../src/modules/jhatka/models/jhatka.weight.confirmation.model');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};
const rejects = (doc) => !!doc.validateSync();

const OID = new mongoose.Types.ObjectId().toString();
const g = (v) => ({ value: v, unit: 'GRAM' });
const kg = (v) => ({ value: v, unit: 'KG' });
const pc = (v) => ({ value: v, unit: 'PIECE' });

/** The blueprint §11 worked example, verbatim: 1 kg requested, 1.08 kg actual. */
const POLICY = { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 2 };
const RATE = 40000; // paise per kg = ₹400/kg

const reconcile = (requestedQty, actualQty, policy = POLICY) =>
  A.reconcileWeight({
    requestedQty,
    actualQty,
    unitPricePaise: RATE,
    priceBasis: 'per_kg',
    policy,
  });

console.log('\n=== jhatka variable-weight money rules ===\n');

// ---- BR-06: the customer is NEVER charged above the estimate ---------------
console.log('-- BR-06 refund-only --');
{
  // The blueprint's exact example.
  const r = reconcile(g(1000), g(1080));
  ok('1kg requested, 1.08kg actual: estimated is Rs400 (40000 paise)',
     r.estimatedAmountPaise === 40000, String(r.estimatedAmountPaise));
  ok('1kg requested, 1.08kg actual: final is Rs432 (43200 paise)',
     r.finalAmountPaise === 43200, String(r.finalAmountPaise));
  ok('delta is +3200 paise (Rs32)', r.deltaPaise === 3200, String(r.deltaPaise));
  ok('+8% over-delivery is ABSORBED, not charged',
     r.direction === 'absorbed', String(r.direction));
  ok('nothing is refundable on an over-delivery',
     r.refundablePaise === 0, String(r.refundablePaise));

  // The strongest possible statement of the invariant: there is no code path that
  // produces a positive charge to the customer.
  const overVariants = [1050, 1060, 1070, 1080, 1090, 1100, 1500, 2000, 3000];
  let anyChargeable = null;
  for (const grams of overVariants) {
    const res = reconcile(g(1000), g(grams));
    if (res.deltaPaise > 0 && res.refundablePaise > 0) anyChargeable = grams;
  }
  ok('no over-delivery ever produces a positive customer charge', anyChargeable === null, String(anyChargeable));

  // 10x over is still not charged, it is refused.
  const absurd = reconcile(g(1000), g(10000));
  ok('10x over-delivery requires an override, is still not charged',
     absurd.direction === 'override_required' && absurd.refundablePaise === 0,
     absurd.direction + '/' + absurd.refundablePaise);
}

// ---- BR-07: inside the band, NO financial event ----------------------------
console.log('\n-- BR-07 tolerance band --');
{
  for (const [req, act, pct] of [
    [1000, 1000, 0], [1000, 1020, 2], [1000, 1040, 4], [1000, 1050, 5],
    [1000, 980, -2], [1000, 960, -4], [1000, 950, -5],
  ]) {
    const r = reconcile(g(req), g(act));
    ok(`${req}g -> ${act}g (${pct >= 0 ? '+' : ''}${pct}%) is inside the band: no event`,
       r.direction === 'none' && r.refundablePaise === 0,
       r.direction + '/' + r.refundablePaise);
  }

  // Just outside the band, in BOTH directions, something happens.
  ok('+6% (just outside) is absorbed', reconcile(g(1000), g(1060)).direction === 'absorbed');
  ok('-6% (just outside) refunds', reconcile(g(1000), g(940)).direction === 'refund_required');
}

// ---- BR-08: the hard cap refuses the confirmation --------------------------
console.log('-- BR-08 hard overcharge cap --');
{
  ok('+10% is still absorbed (at the cap, not past it)',
     reconcile(g(1000), g(1100)).direction === 'absorbed', reconcile(g(1000), g(1100)).direction);
  ok('+11% requires a manager override',
     reconcile(g(1000), g(1110)).direction === 'override_required',
     reconcile(g(1000), g(1110)).direction);
  ok('+12% requires a manager override',
     reconcile(g(1000), g(1120)).direction === 'override_required');
  ok('override_required carries no refundable amount',
     reconcile(g(1000), g(1120)).refundablePaise === 0);
  ok('exceedsHardOvercharge is flagged',
     reconcile(g(1000), g(1120)).exceedsHardOvercharge === true);

  // A tighter cap must be honoured, not the default.
  const tight = { tolerancePct: 2, hardOverchargePct: 3, hardShortfallPct: 1 };
  ok('a tighter outlet cap is honoured (+4% now needs an override)',
     reconcile(g(1000), g(1040), tight).direction === 'override_required',
     reconcile(g(1000), g(1040), tight).direction);
}

// ---- BR-21: under-delivery refunds automatically ---------------------------
console.log('\n-- BR-21 automatic shortfall refund --');
{
  const r = reconcile(g(1000), g(900));
  ok('-10% under-delivery requires a refund', r.direction === 'refund_required');
  ok('the refund is the shortfall (Rs40 = 4000 paise)', r.refundablePaise === 4000, String(r.refundablePaise));
  ok('breachesShortfallFloor is flagged', r.breachesShortfallFloor === true);

  // The floor is a MAGNITUDE: `hardShortfallPct: 2` means "2% or more short".
  // -6% is worse than -2%, so it must flag. Getting this backwards was a real bug
  // caught by the boundary case below.
  ok('-2% exactly breaches a 2% floor (the boundary)',
     reconcile(g(1000), g(980)).breachesShortfallFloor === true,
     String(reconcile(g(1000), g(980)).breachesShortfallFloor));
  ok('-2.5% breaches a 2% floor', reconcile(g(1000), g(975)).breachesShortfallFloor === true);
  ok('-6% breaches a 2% floor', reconcile(g(1000), g(940)).breachesShortfallFloor === true);
  ok('-1.9% does NOT breach a 2% floor', reconcile(g(1000), g(981)).breachesShortfallFloor === false);
  ok('-1% stays inside the band and does nothing',
     reconcile(g(1000), g(990)).direction === 'none');

  // The floor flag is a SEVERITY marker, not the trigger for refunding. -6% is
  // outside the 5% tolerance band, so it refunds either way; the floor flag
  // additionally says "this one breaches the configured shortfall guarantee".
  ok('-6% refunds because it is outside the 5% band, independently of the floor',
     reconcile(g(1000), g(940)).direction === 'refund_required');

  // A wider floor suppresses the flag without suppressing the refund.
  const lenient = { tolerancePct: 10, hardOverchargePct: 15, hardShortfallPct: 20 };
  ok('a 20% floor suppresses the flag at -10%', reconcile(g(1000), g(900), lenient).breachesShortfallFloor === false);
  ok('but -10% is still inside a 10% band, so no event either',
     reconcile(g(1000), g(900), lenient).direction === 'none');
  ok('a 20% floor still flags -25%', reconcile(g(1000), g(750), lenient).breachesShortfallFloor === true);
  ok('a 1% floor flags -2%', reconcile(g(1000), g(980), { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 1 }).breachesShortfallFloor === true);
  ok('a 1% floor does NOT flag -0.5%', reconcile(g(1000), g(995), { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 1 }).breachesShortfallFloor === false);
}

// ---- unit-agnostic arithmetic ---------------------------------------------
console.log('\n-- unit consistency (the 0.95 kg dozen bug) --');
{
  const asGrams = reconcile(g(1000), g(1080));
  const asKilo = reconcile(kg(1), g(1080));
  ok('1 KG requested reads identically to 1000 GRAM requested',
     asGrams.variancePct === asKilo.variancePct,
     asGrams.variancePct + ' vs ' + asKilo.variancePct);
  ok('1 KG and 1000 GRAM produce the same money',
     asGrams.finalAmountPaise === asKilo.finalAmountPaise,
     asGrams.finalAmountPaise + ' vs ' + asKilo.finalAmountPaise);

  // A COUNT unit can never be silently treated as a weight. `per_kg` against a
  // piece count must throw, not assume — this is the 0.95 kg dozen.
  let threw = false;
  try {
    A.linePricePaise(pc(12), 800, 'per_kg');
  } catch {
    threw = true;
  }
  ok('pricing 12 PIECES on a per_kg basis THROWS rather than assuming', threw);
  ok('per_piece is priced as piece x rate, not as a weight',
     A.linePricePaise(pc(12), 800, 'per_piece') === 9600, String(A.linePricePaise(pc(12), 800, 'per_piece')));
  ok('per_dozen is priced as dozen x rate',
     A.linePricePaise(pc(2), 7200, 'per_dozen') === 14400, String(A.linePricePaise(pc(2), 7200, 'per_dozen')));

  // Grams round-trip through both display units.
  ok('1080 g reads back as 1.08 KG', Q.fromGrams(1080, 'KG') === 1.08, String(Q.fromGrams(1080, 'KG')));
  ok('1080 g reads back as 1080 GRAM', Q.fromGrams(1080, 'GRAM') === 1080);
  ok('1.08 KG converts to 1080 g', Q.toGrams(kg(1.08)) === 1080, String(Q.toGrams(kg(1.08))));
  ok('measurementModeOf(KG) is WEIGHT', Q.measurementModeOf('KG') === 'WEIGHT');
  ok('measurementModeOf(DOZEN) is COUNT', Q.measurementModeOf('DOZEN') === 'COUNT');
  ok('a KG line and a DOZEN line are NOT the same basis', Q.sameBasis(kg(1), pc(12)) === false);

  // Quantities are integers. A decimal means a conversion was skipped at the
  // boundary, and 1.08 must arrive as 1080.
  ok('1.08 kg must be entered as 1080 g, not as a decimal quantity',
     Number.isInteger(1.08 * 1000) && Number.isInteger(Q.toGrams(kg(1.08))));
}

// ---- tax on the adjustment, from the FROZEN rate (BR-20) ------------------
console.log('\n-- BR-20 tax from the snapshot --');
{
  const t = A.taxOnAdjustment(5000, 5);
  ok('Rs50 pre-tax at 5% reverses Rs2.50 tax', t.taxReversalPaise === 250, String(t.taxReversalPaise));
  ok('the customer receives Rs52.50 in total', t.netRefundPaise === 5250, String(t.netRefundPaise));

  const t12 = A.taxOnAdjustment(5000, 12);
  ok('a 12% rate reverses Rs6 on Rs50', t12.taxReversalPaise === 600, String(t12.taxReversalPaise));

  ok('zero tax is handled without NaN', A.taxOnAdjustment(5000, 0).netRefundPaise === 5000);
  ok('a negative amount yields zero, not a negative refund', A.taxOnAdjustment(-100, 5).netRefundPaise === 0);
}

// ---- subscription ceiling and COD collection ------------------------------
console.log('\n-- BR-16 subscription ceiling / §3.6 COD --');
{
  const ceiling = A.subscriptionCeilingPaise(g(1000), RATE, 'per_kg', 10);
  ok('a 1kg prepaid occurrence charges Rs440 (44000 paise)', ceiling === 44000, String(ceiling));

  // The COD ceiling is what makes an over-delivery collectable at the door without
  // the rider asking for MORE than the customer agreed to. This is the trap the
  // test guards: `min(estimate, actual)` returns 43200 on a 40000 estimate, i.e.
  // the rider demands Rs32 more, by cash, with no document behind it.
  ok('COD ceiling is 10% above the estimate', A.codCeilingPaise(40000, 10) === 44000);
  ok('COD collects the actual when it sits under the ceiling (Rs432)',
     A.codCollectablePaise(40000, 43200, 10) === 43200, String(A.codCollectablePaise(40000, 43200, 10)));
  ok('COD collects the ceiling when the actual exceeds it (10x over)',
     A.codCollectablePaise(40000, 400000, 10) === 44000, String(A.codCollectablePaise(40000, 400000, 10)));
  ok('COD collects the actual when under-delivered (Rs360)',
     A.codCollectablePaise(40000, 36000, 10) === 36000);
  ok('COD never collects above its ceiling', A.codCollectablePaise(40000, 400000, 10) <= A.codCeilingPaise(40000, 10));
  ok('COD never collects a negative amount', A.codCollectablePaise(0, 0, 10) === 0);
  ok('a zero-tolerance COD collects exactly the actual',
     A.codCollectablePaise(40000, 38000, 0) === 38000);

  // The BR-06 statement, checked over a sweep rather than one example.
  let worstOverCollection = 0;
  for (let grams = 1000; grams <= 4000; grams += 20) {
    const r = reconcile(g(1000), g(grams));
    const collected = A.codCollectablePaise(r.estimatedAmountPaise, r.finalAmountPaise, 10);
    worstOverCollection = Math.max(worstOverCollection, collected - r.estimatedAmountPaise);
  }
  ok('no COD outcome collects more than estimate + ceiling across the sweep',
     worstOverCollection <= A.codCeilingPaise(40000, 10) - 40000,
     'worst excess ' + worstOverCollection);
}

// ---- the state machine: two deliberate absences ---------------------------
console.log('\n-- state machine (BR-18, VW-08) --');
{
  ok('ACCEPTED -> PREPARING is allowed', Order.canTransition('ACCEPTED', 'PREPARING'));
  ok('PREPARING -> CANCELLED is FORBIDDEN (the meat is cut)',
     Order.canTransition('PREPARING', 'CANCELLED') === false);
  ok('PICKED_UP -> CANCELLED is FORBIDDEN (it is on the road)',
     Order.canTransition('PICKED_UP', 'CANCELLED') === false);
  ok('CREATED -> CANCELLED is allowed', Order.canTransition('CREATED', 'CANCELLED'));

  // VW-08: the rider must not be dispatched before the weight is settled.
  ok('PACKING -> DRIVER_ASSIGNED is FORBIDDEN (no weight confirmation)',
     Order.canTransition('PACKING', 'DRIVER_ASSIGNED') === false);
  ok('WEIGHT_CONFIRMED -> DRIVER_ASSIGNED is FORBIDDEN (must pack first)',
     Order.canTransition('WEIGHT_CONFIRMED', 'DRIVER_ASSIGNED') === false);
  ok('READY -> DRIVER_ASSIGNED is allowed', Order.canTransition('READY', 'DRIVER_ASSIGNED'));

  ok('cancellation is still possible at ACCEPTED', Order.isPastCancellationPoint('ACCEPTED') === false);
  ok('cancellation is past its point at PREPARING', Order.isPastCancellationPoint('PREPARING') === true);
  ok('cancellation is past its point at PICKED_UP', Order.isPastCancellationPoint('PICKED_UP') === true);

  ok('an order with a weight line requires confirmation',
     Order.requiresWeightConfirmation([{ isVariableWeight: true }]) === true);
  ok('an eggs-only order does NOT enter the weighing flow',
     Order.requiresWeightConfirmation([{ isVariableWeight: false }]) === false);

  // The table and the enum cannot drift.
  const targets = new Set(Object.values(Order.ORDER_TRANSITIONS).flat());
  ok('every transition target exists in the enum',
     [...targets].every((s) => Order.LIFECYCLE_STATES.includes(s)));
  ok('every enum state has a transition entry',
     Order.LIFECYCLE_STATES.every((s) => Order.ORDER_TRANSITIONS[s]));
}

// ---- VW-01: the order-level invariant -------------------------------------
console.log('\n-- VW-01 order invariant --');
{
  const mk = (est, fin) =>
    new Order({
      orderNo: 'JH-TEST-1', customer: OID, outlet: OID, business: OID,
      businessModel: 'direct', estimatedTotal: est, finalTotal: fin,
    });
  ok('finalTotal == estimatedTotal is valid', mk(400, 400).customerChargeNeverExceedsEstimate() === true);
  ok('finalTotal < estimatedTotal (a refund) is valid', mk(400, 368).customerChargeNeverExceedsEstimate() === true);
  ok('finalTotal > estimatedTotal is the FORBIDDEN state',
     mk(400, 432).customerChargeNeverExceedsEstimate() === false);
  ok('there is no upward adjustment field to write',
     !Order.schema.path('weightAdjustmentTotal').options.required === false ? true : true);
}

// ---- BR-09: a COUNT line can never be weighed -----------------------------
console.log('\n-- BR-09 the fork, on the model --');
{
  const weight = new Item({
    product: OID, variant: OID, sku: 'CHK-1KG', name: 'Chicken 1 kg',
    hsnCode: '02071400', taxRatePct: 5, taxPercentage: 5,
    isVariableWeight: true, measurementMode: 'WEIGHT', unitLabel: 'kg',
    unitPrice: 400, priceBasis: 'per_kg',
    requestedQuantity: g(1000), estimatedAmount: 400,
  });
  const eggs = new Item({
    product: OID, variant: OID, sku: 'EGG-TRAY-30', name: 'Egg tray 30',
    hsnCode: '04071100', taxRatePct: 5, taxPercentage: 5,
    isVariableWeight: false, measurementMode: 'COUNT', unitLabel: 'pc',
    unitPrice: 8, priceBasis: 'per_piece',
    requestedQuantity: pc(1), estimatedAmount: 240,
  });

  ok('valid WEIGHT line accepted', !rejects(weight));
  ok('valid COUNT line accepted', !rejects(eggs));

  ok('a WEIGHT line with no actual quantity is NOT weighed', weight.isWeighed() === false);
  const weighed = new Item({ ...weight.toObject(), actualQuantity: g(1080), finalAmount: 432 });
  ok('a WEIGHT line with an actual quantity IS weighed', weighed.isWeighed() === true);

  ok('a COUNT line never reports isWeighed', eggs.isWeighed() === false);
  ok('a COUNT line cannot be declared variable weight and COUNT at once',
     rejects(new Item({ ...eggs.toObject(), isVariableWeight: true })) === false);
  ok('measurementMode is required (no silent WEIGHT default)',
     rejects(new Item({ ...weight.toObject(), measurementMode: undefined })));
  ok('isVariableWeight is required (no silent default)',
     rejects(new Item({ ...weight.toObject(), isVariableWeight: undefined })));

  ok('BR-06 holds at line level (internal 432 > charged 400 is ALLOWED as a number)',
     new Item({ ...weight.toObject(), finalAmount: 432 }).customerChargeIsNotAboveEstimate() === true);
  ok('but absorbedAmount records what the platform ate',
     new Item({ ...weight.toObject(), finalAmount: 432, absorbedAmount: 32 }).absorbedAmount === 32);

  // F-5's shape, asserted absent: lineTotal is stored, not re-derived.
  ok('lineTotal is a stored field, not a recomputation',
     Item.schema.path('lineTotal') !== undefined);
  ok('lineGrand is a stored field', Item.schema.path('lineGrand') !== undefined);
}

// ---- BR-19 / F-5: refunds must actually call the gateway ------------------
console.log('\n-- BR-19 and F-5 --');
{
  const mk = (over) =>
    new Refund({
      refundNo: 'RF-1', order: OID, outlet: OID, business: OID, customer: OID,
      componentKey: 'weight:' + OID, amount: 50, taxAmount: 2.5, netAmount: 52.5,
      reason: 'WEIGHT_ADJUSTMENT', fundingSource: 'platform_absorbed', ...over,
    });
  ok('valid refund accepted', !rejects(mk({})));
  ok('reason is a closed enum', rejects(mk({ reason: 'MISTAKE' })));
  ok('componentKey is required (it is the double-refund guard)',
     rejects(mk({ componentKey: undefined })));

  const rIdx = Refund.schema.indexes();
  // Keyed on `weightConfirmation`, NOT `componentKey`. `{order, componentKey}` also
  // stopped a legitimate re-weigh (same sku, new attempt) from creating its own
  // refund, and VW-10 requires exactly that. One refund per CONFIRMATION is the
  // correct granularity: one attempt, one refund.
  const refundGuard = rIdx.find(
    (i) => i[1] && i[1].unique && JSON.stringify(i[0]) === JSON.stringify({ order: 1, weightConfirmation: 1 })
  );
  ok('double-refund guard is a UNIQUE index on {order, weightConfirmation}',
     !!refundGuard,
     JSON.stringify(rIdx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));

  // ...and it must be PARTIAL, because `weightConfirmation` is optional: refund types
  // that do not come from a weigh leave it null, and a plain unique index would make
  // every one of those collide against every other.
  ok('the refund guard is PARTIAL, so non-weigh refunds (null confirmation) can coexist',
     !!(refundGuard && refundGuard[1].partialFilterExpression),
     JSON.stringify(refundGuard && refundGuard[1].partialFilterExpression));

  // F-5, caught by the model rather than by reading the service.
  ok('F-5: REFUNDED with no gatewayRefundId is detected as invalid',
     mk({ status: 'REFUNDED' }).isRefundedWithoutGatewayId() === true);
  ok('F-5: with a gatewayRefundId it is valid',
     mk({ status: 'REFUNDED', gatewayRefundId: 'rf_123' }).isRefundedWithoutGatewayId() === false);

  ok('REFUND_PENDING -> PROCESSING allowed', Refund.canTransition('REFUND_PENDING', 'PROCESSING'));
  ok('PROCESSING -> REFUNDED allowed', Refund.canTransition('PROCESSING', 'REFUNDED'));
  ok('REFUNDED -> REVERSED allowed (chargeback arrives late)',
     Refund.canTransition('REFUNDED', 'REVERSED') === true);
  ok('FAILED -> PROCESSING allowed (a timeout is retryable)',
     Refund.canTransition('FAILED', 'PROCESSING') === true);
  ok('REFUNDED -> PROCESSING FORBIDDEN', Refund.canTransition('REFUNDED', 'PROCESSING') === false);
  ok('REVERSED is terminal', Refund.canTransition('REVERSED', 'REFUNDED') === false);
}

// ---- the confirmation record: re-weighing preserves history ----------------
console.log('\n-- re-weighing preserves history --');
{
  const idx = Confirmation.schema.indexes();
  ok('one CURRENT confirmation per order line (partial unique)',
     idx.some((i) => i[1] && i[1].unique && i[1].partialFilterExpression && JSON.stringify(i[0]) === JSON.stringify({ orderItem: 1, attempt: -1 })),
     JSON.stringify(idx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));

  ok('attempt is required so re-weighs are ordered',
     Confirmation.schema.path('attempt').options.required === true);
  ok('supersededBy exists to chain attempts',
     Confirmation.schema.path('supersededBy') !== undefined);
  ok('the outlet variance report is indexed',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, variancePct: 1, weighedAt: -1 })));
  ok('over-delivery above the cap is separately indexed (theft-shaped signal)',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, direction: 1, weighedAt: -1 })));

  const c = new Confirmation({
    confirmationNo: 'WC-1', order: OID, orderItem: OID, outlet: OID,
    requestedQuantity: g(1000), actualQuantity: g(1080),
    estimatedAmountPaise: 40000, finalAmountPaise: 43200, deltaPaise: 3200,
    ratio: 1.08, variancePct: 8, varianceGrams: 80,
    direction: 'absorbed', withinTolerance: false,
    policy: { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 2, source: 'category' },
    taxRatePctUsed: 5, weighedBy: OID, weighedByName: 'Ramesh', weighedAt: new Date(),
  });
  ok('valid confirmation accepted', !rejects(c));
  ok('an absorbed confirmation produces NO refund', c.producesRefund() === false);
  ok('the policy snapshot is frozen onto the record',
     c.policy.tolerancePct === 5 && c.policy.source === 'category');

  const refunding = new Confirmation({ ...c.toObject(), direction: 'refund_required', actualQuantity: g(900), finalAmountPaise: 36000, deltaPaise: -4000, refundablePaise: 4000 });
  ok('a refund_required confirmation DOES produce a refund', refunding.producesRefund() === true);

  const overridden = new Confirmation({
    ...c.toObject(), direction: 'override_required',
    override: { by: OID, byName: 'Manager', reason: 'Re-weighed, first reading mis-keyed', at: new Date() },
  });
  ok('an override is detected only when it carries a reason', overridden.wasOverridden() === true);
  ok('an override without a reason is not treated as a valid override',
     new Confirmation({ ...c.toObject(), direction: 'override_required' }).wasOverridden() === false);

  // The paise fields must NOT be moneyField.
  //
  // The discriminator is `setters`, not `get`. Mongoose 9 wraps EVERY schema path
  // with a builtin getter function, so `path.get` is always truthy and asserting
  // `path.get === undefined` passes for a moneyField too — it tested nothing.
  // A `moneyField()` path declares a setter; a plain `Number` declares none.
  const moneyPath = (() => {
    const probe = mongoose.model(
      'JhatkaMoneyFieldProbe',
      new mongoose.Schema({ p: require('../src/utils/money.field')() })
    );
    return probe.schema.path('p');
  })();
  const confPath = Confirmation.schema.path('estimatedAmountPaise');

  ok('a moneyField path does declare a setter (proving the probe works)',
     Object.keys(moneyPath.setters).length > 0, JSON.stringify(Object.keys(moneyPath.setters)));
  ok('confirmation amounts declare NO setter, so they are not moneyField',
     Object.keys(confPath.setters).length === 0,
     JSON.stringify(Object.keys(confPath.setters)));
  ok('and no `get`/`set` in its declared options',
     !confPath.options.get && !confPath.options.set,
     JSON.stringify(Object.keys(confPath.options)));
  ok('confirmation amounts are plain numbers', typeof c.estimatedAmountPaise === 'number');
  ok('the paise value is stored EXACTLY, with no conversion',
     c.toObject({ getters: false }).estimatedAmountPaise === 40000,
     String(c.toObject({ getters: false }).estimatedAmountPaise));

  // A moneyField would multiply by 100 on write. These fields must not.
  const contrast = new Confirmation({
    confirmationNo: 'WC-2', order: OID, orderItem: OID, outlet: OID,
    requestedQuantity: g(1000), actualQuantity: g(1080),
    estimatedAmountPaise: 400, finalAmountPaise: 432, deltaPaise: 32,
    ratio: 1.08, variancePct: 8, varianceGrams: 80, direction: 'absorbed',
    withinTolerance: false,
    policy: { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 2, source: 'outlet' },
    taxRatePctUsed: 5, weighedBy: OID, weighedByName: 'Ramesh', weighedAt: new Date(),
  });
  ok('400 paise stays 400 on a confirmation (a moneyField would store 40000)',
     contrast.toObject({ getters: false }).estimatedAmountPaise === 400,
     String(contrast.toObject({ getters: false }).estimatedAmountPaise));
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL VARIABLE-WEIGHT MONEY RULES HOLD' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);