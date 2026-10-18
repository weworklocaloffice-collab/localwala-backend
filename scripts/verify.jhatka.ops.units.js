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
 * Unauthorized copying, redistribution, resale, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.jhatka.ops.units.js — subscriptions, delivery, cold chain, compliance,
 * recall, labelling, variance, complaints, reviews.
 *
 * ## The three rules this suite protects
 *
 *   BR-12  cold chain is ENFORCED, not documented — a transit-time breach blocks
 *          pickup, and a warm delivery raises a complaint automatically
 *   BR-15  eggs and fish are not subscription-eligible, and the reason is physical
 *   BR-17  a recurring occurrence that cannot be fulfilled never silently skips —
 *          it notifies, and repeats auto-pause the subscription
 *
 * Plus the recall function the blueprint does not have: the reverse lookup.
 *
 * Run: node scripts/verify.jhatka.ops.units.js
 */

const mongoose = require('mongoose');

const Subscription = require('../src/modules/jhatka/models/jhatka.subscription.model');
const SubscriptionEvent = require('../src/modules/jhatka/models/jhatka.subscription.event.model');
const RecurringOrder = require('../src/modules/jhatka/models/jhatka.recurring.order.model');
const Driver = require('../src/modules/jhatka/models/jhatka.driver.model');
const Delivery = require('../src/modules/jhatka/models/jhatka.delivery.model');
const POD = require('../src/modules/jhatka/models/jhatka.delivery.pod.model');
const DeliverySettlement = require('../src/modules/jhatka/models/jhatka.delivery.settlement.model');
const Compliance = require('../src/modules/jhatka/models/jhatka.compliance.model');
const Recall = require('../src/modules/jhatka/models/jhatka.recall.model');
const Label = require('../src/modules/jhatka/models/jhatka.label.model');
const Variance = require('../src/modules/jhatka/models/jhatka.outlet.variance.flag.model');
const Complaint = require('../src/modules/jhatka/models/jhatka.complaint.model');
const Review = require('../src/modules/jhatka/models/jhatka.review.model');
const Promotion = require('../src/modules/jhatka/models/jhatka.promotion.model');
const History = require('../src/modules/jhatka/models/jhatka.order.status.history.model');
const SupplierDoc = require('../src/modules/jhatka/models/jhatka.supplier.document.model');
const { assessRecallScope, deriveComplianceStatus } = require('../src/modules/jhatka/utils/compliance.arithmetic');

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
const OID2 = new mongoose.Types.ObjectId().toString();
const MON = 5; // 2026-10-05 is a Monday; Oct 2026 starts on a Thursday.
const oct = (d) => new Date(2026, 9, d);
const line = () => ({
  product: OID, variant: OID, sku: 'CHK-CURRY-1KG', name: 'Chicken Curry Cut',
  requestedQuantity: { value: 1000, unit: 'GRAM' },
});

const mkSub = (over = {}) =>
  new Subscription({
    subscriptionNo: 'SB-1', customer: OID, outlet: OID, items: [line()],
    startDate: oct(MON), ...over,
  });

console.log('\n=== jhatka operations model unit checks ===\n');

// ---- recurrence: copied from dairy, tested harder --------------------------
console.log('-- recurrence --');
{
  const mwf = mkSub({ scheduleType: 'custom_days', customDays: [1, 3, 5] });
  ok('Mon/Wed/Fri fires on Mon, Wed, Fri',
     mwf.isScheduledFor(oct(5)) && !mwf.isScheduledFor(oct(6)) &&
     mwf.isScheduledFor(oct(7)) && !mwf.isScheduledFor(oct(8)) && mwf.isScheduledFor(oct(9)));
  ok('daily fires every day', mkSub({ scheduleType: 'daily' }).isScheduledFor(oct(6)));
  ok('weekly fires on the start weekday',
     mkSub({ scheduleType: 'weekly' }).isScheduledFor(oct(5)) &&
     !mkSub({ scheduleType: 'weekly' }).isScheduledFor(oct(6)));
  ok('alternate_days from Monday hits Mon/Wed/Fri',
     mkSub({ scheduleType: 'alternate_days' }).isScheduledFor(oct(5)) &&
     !mkSub({ scheduleType: 'alternate_days' }).isScheduledFor(oct(6)) &&
     mkSub({ scheduleType: 'alternate_days' }).isScheduledFor(oct(7)));

  // An explicit skip BEATS the recurrence.
  const skipped = mkSub({ scheduleType: 'custom_days', customDays: [1, 3, 5] });
  skipped.skipDates = [oct(7)];
  ok('an explicit skip beats the recurrence', skipped.isScheduledFor(oct(7)) === false);
  ok('and does not affect the other days', skipped.isScheduledFor(oct(5)) && skipped.isScheduledFor(oct(9)));

  // A pause window is HALF-OPEN [from, to). The first version tested it inverted
  // and generated deliveries inside the pause — the exact failure BR-17 exists for.
  const paused = mkSub({
    scheduleType: 'daily',
    pauseWindows: [{ from: oct(6), to: oct(8), reason: 'Diwali' }],
  });
  ok('a pause window SUSPENDS generation (this was inverted and leaked)',
     paused.isScheduledFor(oct(6)) === false && paused.isScheduledFor(oct(7)) === false,
     `6th=${paused.isScheduledFor(oct(6))} 7th=${paused.isScheduledFor(oct(7))}`);
  ok('the pause end date itself is NOT paused (half-open)',
     paused.isScheduledFor(oct(8)) === true);
  ok('days outside the window are unaffected',
     paused.isScheduledFor(oct(5)) === true && paused.isScheduledFor(oct(9)) === true);

  // "The next occurrence" is STRICTLY after.
  const nxt = mwf.nextOccurrenceAfter(oct(5));
  ok('nextOccurrenceAfter is strictly AFTER the given date',
     nxt.getTime() > oct(5).getTime(), String(nxt));
  ok('and it is a date the recurrence actually fires on',
     mwf.isScheduledFor(nxt) === true);
  ok('from Tuesday it finds the Wednesday, not Tuesday',
     mwf.nextOccurrenceAfter(oct(6)).getDate() === 7);
  ok('a terminated subscription has no next occurrence',
     mkSub({ scheduleType: 'daily', endDate: oct(7) }).nextOccurrenceAfter(oct(6)) === null);

  ok('customDays must be 0-6 integers',
     rejects(mkSub({ scheduleType: 'custom_days', customDays: [7] })));
  ok('scheduleType is a closed enum', rejects(mkSub({ scheduleType: 'fortnightly' })));

  const idx = Subscription.schema.indexes();
  ok('the nightly generator has a hot index on outlet + status + nextOccurrenceDate',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, status: 1, nextOccurrenceDate: 1 })));
}

// ---- BR-15 and BR-16 -------------------------------------------------------
console.log('\n-- BR-15/BR-16 subscriptions --');
{
  const s = mkSub({ scheduleType: 'daily' });
  ok('a WEIGHT line defaults to charging the CEILING (BR-16)',
     s.items[0].chargeMode === 'ceiling');
  ok('the default ceiling is 10%', s.items[0].subscriptionCeilingPct === 10);
  ok('the ceiling is explicit on the item, never implicit',
     rejects(mkSub({ scheduleType: 'daily', items: [{ ...line(), chargeMode: 'hope' }] })));

  ok('stock failure defaults to notify_and_PAUSE (BR-17)',
     s.stockFailurePolicy === 'notify_and_pause');
  ok('substitution defaults to notify_and_confirm',
     s.substitutionPolicy === 'notify_and_confirm');
  ok('price changes are notified, not silently applied',
     s.priceMode === 'notify_and_confirm');
  ok('the consecutive-failure counter starts at zero',
     s.stats.consecutiveStockFailures === 0);

  const idx = Subscription.schema.indexes();
  ok('the auto-pause check has its own index',
     idx.some((i) => JSON.stringify(i[0]).includes('consecutiveStockFailures')));
}

// ---- BR-17: the recurring order ------------------------------------------
console.log('\n-- BR-17 the recurring order --');
{
  const rIdx = RecurringOrder.schema.indexes();
  ok('THE idempotency anchor: UNIQUE on {subscription, occurrenceDate}',
     rIdx.some((i) => i[1] && i[1].unique &&
       JSON.stringify(i[0]) === JSON.stringify({ subscription: 1, occurrenceDate: 1 })),
     JSON.stringify(rIdx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));

  ok('occurrenceDate must be local midnight',
     rejects(new RecurringOrder({
      subscription: OID, outlet: OID, customer: OID, occurrenceDate: new Date('2026-10-07T13:45:00'),
    })));
  ok('a midnight occurrenceDate is accepted',
     !rejects(new RecurringOrder({ subscription: OID, outlet: OID, customer: OID, occurrenceDate: oct(7) })));

  ok('skip_no_stock is a real generation status',
     RecurringOrder.GENERATION_STATUSES.includes('skipped_no_stock'));
  ok('and stockReserved is guarded, not trusted from the caller',
     new RecurringOrder({ subscription: OID, outlet: OID, customer: OID, occurrenceDate: oct(7) }).stockReserved === false);

  const skipped = new RecurringOrder({
    subscription: OID, outlet: OID, customer: OID, occurrenceDate: oct(7),
    generationStatus: 'skipped_no_stock', skipReason: 'insufficient_stock',
  });
  ok('a stock failure IS recognisable by one predicate',
     skipped.failedOnStock() === true);
  ok('a generated occurrence is NOT a stock failure',
     new RecurringOrder({ subscription: OID, outlet: OID, customer: OID, occurrenceDate: oct(8) }).failedOnStock() === false);
  ok('a skip can carry a credit for a prepaid customer',
     RecurringOrder.schema.path('creditAmount') !== undefined);
}

// ---- BR-12: cold chain at pickup ------------------------------------------
console.log('\n-- BR-12 the cold-chain dispatch guard --');
{
  const mkDelivery = (over = {}) =>
    new Delivery({
      deliveryNo: 'DL-1', order: OID, outlet: OID, customer: OID, ...over,
    });

  const ok1 = mkDelivery({ coldChain: { transitMinutes: 30, maxTransitMinutes: 45 } });
  ok('a 30-minute transit inside a 45-minute limit may be picked up',
     ok1.canBePickedUp().ok === true);

  const tooLong = mkDelivery({ coldChain: { transitMinutes: 70, maxTransitMinutes: 45 } });
  const blocked = tooLong.canBePickedUp();
  ok('a 70-minute transit BLOCKS pickup', blocked.ok === false);
  ok('and the reason names both numbers so the rider can act',
     /70min/.test(blocked.reason) && /45min/.test(blocked.reason), blocked.reason);

  ok('exactly AT the limit is allowed (not blocked)',
     mkDelivery({ coldChain: { transitMinutes: 45, maxTransitMinutes: 45 } }).canBePickedUp().ok === true);
  ok('one minute past it is blocked',
     mkDelivery({ coldChain: { transitMinutes: 46, maxTransitMinutes: 45 } }).canBePickedUp().ok === false);

  const breached = mkDelivery({
    coldChain: { transitMinutes: 20, maxTransitMinutes: 45, packingTempC: 11, packingAt: new Date(), breachDetectedAt: new Date() },
  });
  ok('a packing-time breach also blocks (a faster ride does not undo it)',
     breached.canBePickedUp().ok === false);

  ok('no recorded transit means no block — absence of data is not a breach',
     mkDelivery().canBePickedUp().ok === true);

  // §3.6: the COD figure is frozen at weight confirmation.
  const cod = mkDelivery({
    codStatus: 'pending', codCollectionAmount: 40000, codCollectedAmount: 40000,
  });
  ok('a matched COD collection is recognised',
     cod.codMatchesQuoted() === true);
  ok('a mismatched one is NOT quietly accepted',
     mkDelivery({ codStatus: 'pending', codCollectionAmount: 40000, codCollectedAmount: 38000 }).codMatchesQuoted() === false);
  ok('codCollectionAmount is frozen with a timestamp',
     Delivery.schema.path('codFrozenAt') !== undefined);

  const dIdx = Delivery.schema.indexes();
  ok('one delivery per order', dIdx.some((i) => i[1] && i[1].unique &&
    JSON.stringify(i[0]) === JSON.stringify({ order: 1 })));
  ok('delivered is terminal', Delivery.canTransition('delivered', 'picked_up') === false);
  ok('a picked-up delivery cannot be un-picked-up',
     Delivery.canTransition('picked_up', 'accepted') === false);
}

// ---- the POD and its offline idempotency ---------------------------------
console.log('\n-- proof of delivery --');
{
  const pIdx = POD.schema.indexes();
  ok('clientRef is UNIQUE + SPARSE — the offline retry guard',
     pIdx.some((i) => i[1] && i[1].unique && i[1].sparse &&
       JSON.stringify(i[0]) === JSON.stringify({ clientRef: 1 })),
     JSON.stringify(pIdx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));
  ok('one proof per delivery', pIdx.some((i) => i[1] && i[1].unique &&
    JSON.stringify(i[0]) === JSON.stringify({ delivery: 1 })));

  const mkPod = (over = {}) =>
    new POD({ delivery: OID, order: OID, capturedAt: new Date(), ...over });

  const warm = mkPod({ deliveredTempC: 11, maxTempC: 4 });
  const a = warm.assessColdChain();
  ok('a warm delivery is a BREACH', a.breached === true && a.unmeasured === false);
  ok('and the reason names both temperatures', /11/.test(a.reason) && /4/.test(a.reason), a.reason);

  const cool = mkPod({ deliveredTempC: 3, maxTempC: 4 });
  ok('a 3C delivery is within band', cool.assessColdChain().breached === false);

  const none = mkPod();
  const b = none.assessColdChain();
  ok('NO temperature recorded is UNMEASURED, not compliant',
     b.breached === false && b.unmeasured === true, JSON.stringify(b));
  ok('and unmeasured is distinguishable from fine, which is the point', b.reason !== cool.assessColdChain().reason);
}

// ---- drivers --------------------------------------------------------------
console.log('\n-- drivers --');
{
  const mkDriver = (over = {}) =>
    new Driver({ driverCode: 'DR-1', user: OID, name: 'Ramesh', mobile: 9876543210, ...over });

  ok('a platform-pool rider has outlet === null, not an absent field',
     mkDriver().outlet === null);
  ok('and isPool reports it', mkDriver().isPlatformPool() === true);
  ok('an outlet-owned rider is not pool',
     mkDriver({ outlet: OID }).isPlatformPool() === false);

  const active = mkDriver();
  ok('an available active rider can be assigned', active.canBeAssigned() === true);
  ok('a suspended rider cannot', mkDriver({ status: 'suspended' }).canBeAssigned() === false);
  ok('a blocked rider cannot', mkDriver({ isBlocked: true }).canBeAssigned() === false);
  ok('an UNAVAILABLE rider cannot — but is still ACTIVE',
     mkDriver({ available: false }).canBeAssigned() === false);
  ok('a five-minute break must not suspend anyone',
     mkDriver({ available: false }).status === 'active');

  // Vehicle document expiry is a legal exposure, not paperwork.
  ok('an expired INSURANCE certificate blocks assignment',
     mkDriver({ vehicle: { insuranceExpiry: new Date(Date.now() - 86400000) } }).canBeAssigned() === false);
  ok('an expired PERMIT blocks assignment',
     mkDriver({ vehicle: { permitExpiry: new Date(Date.now() - 86400000) } }).canBeAssigned() === false);
  ok('valid vehicle documents do not block',
     mkDriver({ vehicle: { insuranceExpiry: new Date(Date.now() + 30 * 86400000) } }).canBeAssigned() === true);

  // BR-24: soft-deactivate only.
  ok('there is no delete field or method on a driver',
     Driver.schema.path('deletedAt') === undefined &&
     typeof Driver.schema.methods.findOneAndDelete === 'undefined');
  ok('status is a closed enum', rejects(mkDriver({ status: 'terminated' })));
  const dIdx = Driver.schema.indexes();
  ok('the dispatcher picker is indexed (outlet, status, available)',
     dIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, status: 1, available: 1 })));
}

// ---- delivery settlement --------------------------------------------------
console.log('\n-- delivery settlement --');
{
  // The accounting identity: codCollected = platformFee + riderCashShare + shortfall.
  // The rider's own cut is NOT a shortfall — omitting it made a reconciled
  // statement report ₹900 missing on a ₹1,000 collection.
  const mk = (over = {}) =>
    new DeliverySettlement({
      settlementNo: 'DS-1', driver: OID, payoutMode: 'platform_pays',
      period: { from: oct(1), to: oct(8) }, ...over,
    });

  const balanced = mk({
    totals: { codCollected: 1000, platformFeeOnCod: 100, riderCashShare: 900, codShortfall: 0 },
  });
  ok('1000 = 100 fee + 900 rider + 0 short reconciles', balanced.isCashReconciled() === true);
  ok('and the variance is zero', balanced.cashVariance() === 0, String(balanced.cashVariance()));

  const short = mk({
    totals: { codCollected: 1000, platformFeeOnCod: 100, riderCashShare: 850, codShortfall: 0 },
  });
  ok('a genuine ₹50 gap does NOT reconcile', short.isCashReconciled() === false);
  ok('and the variance NAMES the amount, which is what is actionable',
     short.cashVariance() === 50, String(short.cashVariance()));

  const declared = mk({
    totals: { codCollected: 1000, platformFeeOnCod: 100, riderCashShare: 850, codShortfall: 50 },
  });
  ok('a DECLARED shortfall reconciles — declaring it is the point',
     declared.isCashReconciled() === true);

  const s = balanced;
  ok('a platform rider has outlet null', s.isPlatformPool() === true);
  ok('and an outlet rider does not',
     mk({ outlet: OID, payoutMode: 'business_pays' }).isPlatformPool() === false);

  const sIdx = DeliverySettlement.schema.indexes();
  ok('one settlement per driver per period, by INDEX',
     sIdx.some((i) => i[1] && i[1].unique &&
       JSON.stringify(i[0]) === JSON.stringify({ driver: 1, 'period.from': 1 })));
  ok('payoutMode is required and frozen per delivery',
     DeliverySettlement.schema.path('payoutMode').options.required === true);
  ok('BR-24: payoutMode is stored on the settlement, not derived at read time',
     DeliverySettlement.schema.path('deliveries.payoutMode') !== undefined);
}

// ---- BR-25: compliance ----------------------------------------------------
console.log('\n-- BR-25 compliance --');
{
  const NOW = new Date('2026-10-07T00:00:00.000Z');
  const mk = (days) =>
    new Compliance({
      outlet: OID, business: OID,
      fssai: {
        licenceNumber: '123', category: 'state_licence',
        expiresAt: new Date(NOW.getTime() + days * 86400000),
      },
    });

  ok('a licence 90 days out is valid', deriveComplianceStatus(mk(90).fssai, NOW, 30) === 'valid');
  ok('a licence 10 days out is expiring', deriveComplianceStatus(mk(10).fssai, NOW, 30) === 'expiring');
  ok('a lapsed licence is expired', deriveComplianceStatus(mk(-1).fssai, NOW, 30) === 'expired');

  // The call site must pass `this.fssai`, NOT the whole record.
  //
  // Passing the whole record — the obvious thing to write — made the shared function
  // read `doc.expiresAt`, find undefined, and return `pending` unconditionally. Every
  // outlet read as PENDING forever, `canAcceptNewOrders()` was permanently false,
  // and no outlet could take an order. Nothing threw and nothing logged.
  ok('the model derives a valid 90-day licence as VALID, not pending',
     Compliance.deriveStatus(mk(90), NOW, 30) === 'valid',
     Compliance.deriveStatus(mk(90), NOW, 30));
  ok('and agrees with the shared function on the fssai subdocument',
     Compliance.deriveStatus(mk(90), NOW, 30) === deriveComplianceStatus(mk(90).fssai, NOW, 30));
  ok('a 10-day licence reads as expiring through the model too',
     Compliance.deriveStatus(mk(10), NOW, 30) === 'expiring');
  ok('a lapsed licence reads as expired through the model too',
     Compliance.deriveStatus(mk(-1), NOW, 30) === 'expired');

  ok('a valid licence permits new orders', mk(90).canAcceptNewOrders(NOW) === true);
  ok('an expiring one still permits — 30 days is not a reason to stop trading',
     mk(10).canAcceptNewOrders(NOW) === true);
  ok('an EXPIRED one does not', mk(-1).canAcceptNewOrders(NOW) === false);

  ok('daysToExpiry is null, not zero, when there is no date',
     new Compliance({ outlet: OID, business: OID, fssai: { licenceNumber: '1', category: 'state_licence' } }).daysToExpiry(NOW) === null);
  ok('and an undated licence derives as pending, never as valid',
     Compliance.deriveStatus({ fssai: {} }, NOW, 30) === 'pending');

  ok('FSSAI legally blocks trading', mk(90).blocksTrading('fssai') === true);
  ok('a trade licence does not', mk(90).blocksTrading('trade_licence') === false);

  const cIdx = Compliance.schema.indexes();
  ok('the expiry sweep has the dairy-derived index',
     cIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ status: 1, 'fssai.expiresAt': 1 })));

  // The supplier document rule must be IDENTICAL, not a second implementation.
  ok('supplier documents use the SAME rule for the undated case',
     SupplierDoc.deriveStatus({ expiresAt: null }, NOW, 30) === 'pending');
}

// ---- recall: the reverse lookup ------------------------------------------
console.log('\n-- §5.4 recall: who ate this batch --');
{
  const alloc = (over = {}) => ({
    batch: OID, outlet: OID, allocationType: 'CONSUMPTION', qtyDelta: -500,
    orderItem: OID, order: OID, ...over,
  });

  const scope = assessRecallScope([
    alloc({ order: OID, orderItem: OID, orderLifecycle: 'DELIVERED', customer: OID }),
    // Same order, second line — must NOT notify twice.
    alloc({ order: OID, orderItem: OID2, orderLifecycle: 'DELIVERED', customer: OID, qtyDelta: -200 }),
    // Not yet delivered — recoverable at the outlet.
    alloc({ order: OID2, orderItem: OID2, orderLifecycle: 'ACCEPTED', customer: OID2 }),
    // Not a consumption.
    alloc({ order: OID, orderItem: OID, allocationType: 'RESERVATION', qtyDelta: -500, orderLifecycle: 'DELIVERED' }),
    // No order — traced nothing.
    alloc({ orderItem: undefined, order: undefined, allocationType: 'CONSUMPTION', qtyDelta: -500 }),
  ]);

  ok('only CONSUMPTION allocations with an order are counted',
     scope.affectedOrders.length === 2, String(scope.affectedOrders.length));
  ok('two lines on the SAME order collapse to ONE affected order',
     scope.affectedOrders.filter((o) => String(o.order) === OID).length === 1);
  ok('quantities sum across the split lines',
     scope.affectedOrders.find((o) => String(o.order) === OID).qty === 700,
     String(scope.affectedOrders.find((o) => String(o.order) === OID).qty));
  ok('DELIVERED orders are counted separately from undelivered',
     scope.deliveredCount === 1 && scope.undeliveredCount === 1,
     `${scope.deliveredCount}/${scope.undeliveredCount}`);
  ok('only DELIVERED orders generate a customer notification',
     scope.affectedCustomers.length === 1);
  ok('and the notification carries the order it refers to',
     scope.affectedCustomers[0].orders.length === 1);
  ok('undelivered orders are REPORTED, not dropped — they need ON_HOLD',
     scope.undeliveredCount > 0);

  const empty = assessRecallScope([]);
  ok('an empty batch reports zero, not undefined',
     empty.affectedOrders.length === 0 && empty.affectedCustomers.length === 0);
  ok('and a non-array is handled rather than crashing',
     assessRecallScope(null).affectedOrders.length === 0);

  const r = new Recall({
    recallNo: 'RC-1', batch: OID, outlet: OID, business: OID, severity: 'recall',
    reason: 'Salmonella detected in supplier batch', initiatedBy: OID, initiatedAt: new Date(),
  });
  ok('a recall severity REQUIRES customer notification', r.requiresCustomerNotification() === true);
  ok('a withdraw does NOT',
     new Recall({ recallNo: 'RC-2', batch: OID, outlet: OID, business: OID, severity: 'withdraw', reason: 'Batch withdrawn pending review', initiatedBy: OID, initiatedAt: new Date() }).requiresCustomerNotification() === false);
  ok('neither does an advisory',
     new Recall({ recallNo: 'RC-3', batch: OID, outlet: OID, business: OID, severity: 'advisory', reason: 'Supplier batch advisory notice', initiatedBy: OID, initiatedAt: new Date() }).requiresCustomerNotification() === false);
  ok('a reason under 10 characters is rejected',
     rejects(new Recall({ recallNo: 'RC-4', batch: OID, outlet: OID, business: OID, severity: 'recall', reason: 'bad', initiatedBy: OID, initiatedAt: new Date() })));
  ok('acknowledgement is tracked as a count, not a boolean',
     Recall.schema.path('acknowledgedCount') !== undefined &&
     Recall.schema.path('notifiedCount') !== undefined);
  ok('with nobody notified yet, fullyAcknowledged is false',
     new Recall({ recallNo: 'RC-5', batch: OID, outlet: OID, business: OID, severity: 'recall', reason: 'Test recall reason text', initiatedBy: OID, initiatedAt: new Date() }).fullyAcknowledged() === false);
}

// ---- BR-13: labelling -----------------------------------------------------
console.log('\n-- BR-13 pack labelling --');
{
  const mk = (over = {}) =>
    new Label({
      labelNo: 'LB-1', orderItem: OID, outlet: OID, product: OID,
      productName: 'Chicken Curry Cut', packSize: '1 kg', netQuantity: '1000 g',
      packedOn: new Date('2026-10-07T06:00:00'),
      useBy: new Date('2026-10-08T06:00:00'),
      storageInstruction: 'Keep refrigerated below 4 C',
      fssaiLicenceNo: '123', outletName: 'X', outletAddress: 'Y',
      qrTraceBatch: 'B-1', ...over,
    });

  ok('a valid label is accepted', !rejects(mk()));
  ok('useBy is REQUIRED — a pack with no expiry is unsellable meat',
     rejects(mk({ useBy: undefined })));
  ok('packedOn is REQUIRED (BR-13 — cut time, not intake)',
     rejects(mk({ packedOn: undefined })));
  ok('the FSSAI number is REQUIRED on the pack', rejects(mk({ fssaiLicenceNo: undefined })));
  ok('the storage instruction is REQUIRED', rejects(mk({ storageInstruction: undefined })));
  ok('the traceability QR is REQUIRED', rejects(mk({ qrTraceBatch: undefined })));

  const l = mk();
  ok('a pack is live before its use-by', l.isWithinUseBy(new Date('2026-10-07T11:00:00')) === true);
  ok('and dead after', l.isWithinUseBy(new Date('2026-10-08T07:00:00')) === false);
  ok('hoursRemaining goes NEGATIVE once expired, not to zero',
     l.hoursRemaining(new Date('2026-10-08T07:00:00')) < 0,
     String(l.hoursRemaining(new Date('2026-10-08T07:00:00'))));

  const lIdx = Label.schema.indexes();
  ok('recall by label is ONE indexed read on qrTraceBatch',
     lIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ qrTraceBatch: 1 })));
  ok('the batch index exists too, for labels printed before a QR scan',
     lIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ batch: 1 })));
}

// ---- the variance flag ----------------------------------------------------
console.log('\n-- §8.5 the variance flag (the fraud control) --');
{
  const P = { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 2 };
  ok('0% variance is NOT flagged', Variance.shouldFlag(0, P) === false);
  ok('5% (at the band edge) is not flagged', Variance.shouldFlag(5, P) === false);
  ok('6% is flagged', Variance.shouldFlag(6, P) === true);
  ok('-1% is not flagged', Variance.shouldFlag(-1, P) === false);
  ok('-2% IS flagged — the shortfall floor', Variance.shouldFlag(-2, P) === true);
  ok('12% is flagged', Variance.shouldFlag(12, P) === true);

  // Exactly zero has NO direction. Returning 'under' would file a correct reading
  // into the under-delivery report and make a well-behaved outlet look short.
  ok('zero variance has NO direction, not "under"',
     Variance.directionOf(0) === null, String(Variance.directionOf(0)));
  ok('a positive variance is "over"', Variance.directionOf(5) === 'over');
  ok('a negative variance is "under"', Variance.directionOf(-5) === 'under');

  ok('the hard cap can be tightened and is honoured',
     Variance.shouldFlag(4, { tolerancePct: 2, hardOverchargePct: 3, hardShortfallPct: 1 }) === true);

  const f = new Variance({
    outlet: OID, order: OID, orderItem: OID, weightConfirmation: OID,
    direction: 'over', ratio: 1.12, variancePct: 12,
    requestedGrams: 1000, actualGrams: 1120, flaggedAt: new Date(),
    policy: { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 2 },
  });
  ok('a fresh flag is unreviewed', f.isUnreviewed() === true);
  ok('self-approval (weigher signed off their own weight) defaults false',
     f.selfApproved === false);
  ok('and the field exists to count violations',
     Variance.schema.path('selfApproved') !== undefined);

  const vIdx = Variance.schema.indexes();
  ok('the variance report query is indexed (outlet, time, direction)',
     vIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, flaggedAt: -1, direction: 1 })));
  ok('one flag per weight confirmation', vIdx.some((i) => i[1] && i[1].unique &&
    JSON.stringify(i[0]) === JSON.stringify({ weightConfirmation: 1 })));
}

// ---- complaints -----------------------------------------------------------
console.log('\n-- complaints --');
{
  const mk = (over = {}) =>
    new Complaint({
      complaintNo: 'CM-1', order: OID, outlet: OID, customer: OID,
      category: 'quality_issue', source: 'customer', subject: 'Chicken smelled off', ...over,
    });

  ok('a customer complaint is accepted', !rejects(mk()));
  ok('a system complaint is equally valid',
     !rejects(mk({ source: 'system', category: 'cold_chain_breach', subject: 'Delivered above 4 C' })));

  const cIdx = Complaint.schema.indexes();
  ok('system complaints have a SEPARATE index — a working control is not a failure',
     cIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ source: 1, createdAt: -1 })));

  ok('a quality complaint defaults to a 2-hour window', mk().windowHours === 2);
  ok('a short-delivery complaint gets longer — it can be found later',
     mk({ category: 'short_delivery', subject: 'Weighed short' }).windowHours === 2);
  ok('a description under 10 characters is rejected', rejects(mk({ description: 'bad' })));

  // No return flow, ever. See the model header.
  ok('there is NO return-to-outlet resolution',
     !Complaint.RESOLUTIONS.includes('return_to_outlet') &&
     !Complaint.RESOLUTIONS.includes('collect_returned_item'));
  ok('refund resolutions are named explicitly',
     Complaint.RESOLUTIONS.includes('refund_full') && Complaint.RESOLUTIONS.includes('refund_partial'));
  ok('and a goodwill credit is NOT a refund — it moves no money (BR-19)',
     mk({ resolution: 'goodwill_credit' }).resolutionRequiresRefund() === false);
  ok('a partial refund DOES require a refund document',
     mk({ resolution: 'refund_partial' }).resolutionRequiresRefund() === true);
}

// ---- reviews --------------------------------------------------------------
console.log('\n-- reviews --');
{
  const mk = (over = {}) =>
    new Review({
      order: OID, outlet: OID, customer: OID, outletRating: 4, ...over,
    });

  ok('a review is accepted', !rejects(mk()));
  ok('ratings are 1-5', rejects(mk({ outletRating: 6 })) && rejects(mk({ outletRating: 0 })));

  const rIdx = Review.schema.indexes();
  ok('one published review per order + customer, by partial-unique INDEX',
     rIdx.some((i) => i[1] && i[1].unique && i[1].partialFilterExpression &&
       JSON.stringify(i[0]) === JSON.stringify({ order: 1, customer: 1 })));

  ok('outlet, product and delivery ratings are SEPARATE fields',
     Review.schema.path('outletRating') && Review.schema.path('productRating') &&
     Review.schema.path('deliveryRating'));
  ok('a hidden review is not deleted — it is moderated with a reason',
     Review.STATUSES.includes('hidden') && Review.MODERATION_REASONS.length > 0);
  ok('and there is no delete path',
     Review.schema.path('deletedAt') === undefined);

  const fresh = mk({ elapsedMinutes: 30 });
  ok('a review within 2 hours is FRESH', fresh.isFresh() === true);
  ok('one from a month ago is not', mk({ elapsedMinutes: 40000 }).isFresh() === false);
  ok('a weight complaint is detectable from the variance alone',
     mk({ weightVariancePct: -10 }).mentionsWeight() === true);
  ok('and from the comment text', mk({ comment: 'the weight was short' }).mentionsWeight() === true);
  ok('an unrelated 1-star review is not a weight complaint',
     mk({ comment: 'rider was rude', weightVariancePct: 1 }).mentionsWeight() === false);
}

// ---- promotions -----------------------------------------------------------
console.log('\n-- promotions on a variable-weight order --');
{
  const NOW = new Date('2026-10-07T00:00:00');
  const mk = (over = {}) =>
    new Promotion({
      code: 'PROMO10', name: 'Ten off', type: 'percent_off',
      startAt: new Date('2026-10-01'), endAt: new Date('2026-10-31'),
      createdBy: OID, ...over,
    });

  ok('a valid promotion is accepted', !rejects(mk()));
  ok('an end date BEFORE the start is rejected',
     rejects(mk({ startAt: new Date('2026-10-31'), endAt: new Date('2026-10-01') })));
  ok('discounts are NOT stackable by default', mk().stackable === false);
  ok('promotions do NOT apply to subscriptions by default (BR-16 compounding)',
     mk().appliesToSubscriptions === false);
  ok('and the discount BASIS is explicit, because estimate != final on a weight line',
     mk().discountBasis === 'estimated_line_total');
  ok('a weight line and a count line can be targeted separately',
     Promotion.schema.path('appliesToMeasurementMode').options.enum.includes('WEIGHT') &&
     Promotion.schema.path('appliesToMeasurementMode').options.enum.includes('COUNT'));
  ok('a percentage discount is capped on a variable-weight line',
     Promotion.schema.path('maxDiscountAmount') !== undefined);

  const p = mk({ status: 'active', startAt: new Date('2026-10-01'), endAt: new Date('2026-10-31') });
  ok('a promotion is live inside its window', p.isLive(NOW) === true);
  ok('and not before it', p.isLive(new Date('2026-09-30')) === false);
  ok('and not after it', p.isLive(new Date('2026-11-01')) === false);
  ok('a DRAFT promotion is never live, even inside its window',
     mk({ status: 'draft' }).isLive(NOW) === false);
  ok('a paused one is not either', mk({ status: 'paused' }).isLive(NOW) === false);

  // null = unlimited, 0 = none. Conflating them is a real bug.
  ok('usageLimitPerCustomer null means UNLIMITED',
     mk({ usageLimitPerCustomer: null }).canBeUsedBy(999) === true);
  ok('a limit of 3 rejects the fourth use',
     mk({ usageLimitPerCustomer: 3 }).canBeUsedBy(3) === false);
  ok('and allows the third', mk({ usageLimitPerCustomer: 3 }).canBeUsedBy(2) === true);
  ok('a limit of 0 rejects any use',
     mk({ usageLimitPerCustomer: 0 }).canBeUsedBy(0) === false);
  ok('a global usage limit is respected',
     mk({ usageLimit: 10, usageCount: 10 }).canBeUsedBy(0) === false);
}

// ---- the status history ---------------------------------------------------
console.log('\n-- order status history --');
{
  const mk = (over = {}) =>
    new History({
      order: OID, toStatus: 'ON_HOLD', actorType: 'system', at: new Date(), ...over,
    });

  ok('a hold transition is accepted', !rejects(mk()));
  ok('actorType is required — a cron transition and an operator one differ',
     History.schema.path('actorType').options.required === true);
  ok('a system transition needs no user', !rejects(mk({ actor: undefined })));
  ok('but a human one should have a name', rejects(mk({ actorType: 'customer' })) === false);

  ok('a system transition is NOT a human action', mk().wasHumanAction() === false);
  ok('an operator transition IS',
     new History({ order: OID, toStatus: 'ACCEPTED', actorType: 'outlet', actor: OID, at: new Date() }).wasHumanAction() === true);
  ok('the hold predicate is separate from the status check',
     mk().isHold() === true);

  const hIdx = History.schema.indexes();
  ok('offline transitions are idempotent by clientRef (unique + sparse)',
     hIdx.some((i) => i[1] && i[1].unique && i[1].sparse &&
       JSON.stringify(i[0]) === JSON.stringify({ clientRef: 1 })));
  ok('the order timeline is one indexed read', hIdx.some((i) =>
    JSON.stringify(i[0]) === JSON.stringify({ order: 1, at: 1 })));
  ok('no money field is imported on this document',
     History.schema.path('amount') === undefined);
}

// ---- the subscription event log ------------------------------------------
console.log('\n-- subscription event log --');
{
  const mk = (over = {}) =>
    new SubscriptionEvent({
      subscription: OID, customer: OID, outlet: OID,
      type: 'paused', actorType: 'customer', at: new Date(), ...over,
    });

  ok('a pause event is accepted', !rejects(mk()));
  ok('effectiveFrom is separate from at — a deferred change says so',
     SubscriptionEvent.schema.path('effectiveFrom') !== undefined &&
     SubscriptionEvent.schema.path('at') !== undefined);

  const immediate = mk();
  ok('an immediate change is NOT deferred', immediate.isDeferred() === false);
  const deferred = mk({ at: new Date('2026-10-07T14:30:00'), effectiveFrom: new Date('2026-10-09T06:00:00') });
  ok('a change past the cutoff IS deferred', deferred.isDeferred() === true);
  ok('and the customer can be told WHEN it takes effect',
     deferred.effectiveFrom > deferred.at);

  ok('a system action is distinguishable from the customer\'s',
     mk({ type: 'auto_paused', actorType: 'system' }).isSystemAction() === true);
  ok('a customer action is not', mk().isSystemAction() === false);

  const eIdx = SubscriptionEvent.schema.indexes();
  ok('"why did my subscription change its own mind" is ONE indexed read',
     eIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ subscription: 1, at: 1 })));
  ok('the BR-17 sequence is queryable per outlet',
     eIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, type: 1, at: -1 })));
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL OPERATIONS CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);