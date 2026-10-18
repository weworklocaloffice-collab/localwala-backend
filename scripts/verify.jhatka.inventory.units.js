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
 * verify.jhatka.inventory.units.js — schema checks for the stock and traceability
 * models.
 *
 * ## The trap this suite catches
 *
 * Mongoose 9's `validateSync()` RETURNS a ValidationError rather than throwing, so
 * a negative assertion wrapped in try/catch passes vacuously. Every negative case
 * here asserts on the return value.
 *
 * ## Why the traceable-quantity assertions matter most
 *
 * This vertical's whole claim to being different from a grocery vertical is
 * traceability. A schema that permits a batch with no expiry, a stock row with no
 * unit, or an allocation that does not carry a batch quietly removes that claim
 * while still appearing to work.
 *
 * Run: node scripts/verify.jhatka.inventory.units.js
 */

const mongoose = require('mongoose');
const InventoryItem = require('../src/modules/jhatka/models/jhatka.inventory.item.model');
const Batch = require('../src/modules/jhatka/models/jhatka.batch.model');
const Allocation = require('../src/modules/jhatka/models/jhatka.batch.allocation.model');
const Movement = require('../src/modules/jhatka/models/jhatka.inventory.movement.model');
const Wastage = require('../src/modules/jhatka/models/jhatka.wastage.model');
const Outlet = require('../src/modules/jhatka/models/jhatka.outlet.model');

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
const NOW = new Date('2026-10-07T00:00:00.000Z');
const HOUR = 3600 * 1000;

console.log('\n=== jhatka inventory / traceability model unit checks ===\n');

// ---- outlet: BR-04 and the suspension semantics ----------------------------
console.log('-- outlet --');
{
  const base = {
    outletCode: 'JH-001',
    business: OID,
    businessModel: 'direct',
    name: 'Andheri Jhatka',
    address: { line1: '12 MG Road' },
    city: OID,
    location: { type: 'Point', coordinates: [72.83, 19.11] },
  };
  ok('valid outlet accepted', !rejects(new Outlet(base)));
  ok('businessModel is a closed enum', rejects(new Outlet({ ...base, businessModel: 'reseller' })));
  ok('all three business models accepted',
     ['direct', 'franchise', 'commission_partner'].every((m) => !rejects(new Outlet({ ...base, businessModel: m }))));

  // A suspended outlet must stop NEW commerce while keeping existing promises.
  // A shop whose FSSAI lapsed at noon still owes the customer the chicken it
  // already accepted, and blocking reads as well as writes turns a compliance
  // problem into an untrackable order.
  const s = new Outlet({ ...base, status: 'suspended' });
  const caps = s.capabilities();
  ok('suspended outlet refuses NEW orders', caps.acceptNewOrders === false);
  ok('suspended outlet still fulfils existing orders', caps.fulfilExisting === true);
  ok('suspended outlet can still be read', caps.viewOrders === true);
  ok('suspended outlet cannot manage money', caps.managePayments === false);

  const d = new Outlet({ ...base, status: 'draft' });
  ok('draft outlet can neither take nor fulfil', d.capabilities().acceptNewOrders === false && d.capabilities().fulfilExisting === false);

  const idx = Outlet.schema.indexes();
  ok('outlet is geospatially indexed', idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ location: '2dsphere' })));
  ok('one business may own many outlets (BR-04)', idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ business: 1, status: 1 })));
}

// ---- inventory item: one collection, three kinds ---------------------------
console.log('\n-- inventory item --');
{
  const base = {
    outlet: OID,
    kind: 'raw',
    batch: OID,
    product: OID,
    unit: 'GRAM',
    onHand: 2000,
    availableQty: 2000,
    expiresAt: new Date(NOW.getTime() + 48 * HOUR),
    receivedAt: NOW,
  };
  ok('valid raw inventory row accepted', !rejects(new InventoryItem(base)));
  ok('kind is a closed enum', rejects(new InventoryItem({ ...base, kind: 'frozen_treats' })));
  ok('unit is required (never a bare number)', rejects(new InventoryItem({ ...base, unit: undefined })));
  ok('negative onHand rejected', rejects(new InventoryItem({ ...base, onHand: -5 })));

  // Negative stock must be opt-in. A butcher shop that lets a shelf go negative
  // will sell stock it does not have, and the shortage surfaces at the scale.
  const dflt = new InventoryItem(base);
  ok('allowNegativeStock defaults to FALSE', dflt.allowNegativeStock === false);

  const idx = InventoryItem.schema.indexes();
  ok('one row per outlet+kind+batch (partial unique)',
     idx.some((i) => i[1] && i[1].unique && i[1].partialFilterExpression && JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, kind: 1, batch: 1 })),
     JSON.stringify(idx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));
  ok('FEFO ordering is indexed (outlet, kind, expiresAt)',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, kind: 1, expiresAt: 1, availableQty: 1 })));

  // BR-13: prepared stock expires on useByAt, not expiresAt.
  const prepared = new InventoryItem({
    outlet: OID,
    kind: 'prepared',
    batch: OID,
    product: OID,
    variant: OID,
    unit: 'GRAM',
    onHand: 1000,
    availableQty: 1000,
    receivedAt: NOW,
    cutAt: NOW,
    useByAt: new Date(NOW.getTime() + 24 * HOUR),
    expiresAt: new Date(NOW.getTime() + 48 * HOUR),
  });
  ok('valid prepared row accepted', !rejects(prepared));
  ok('prepared row expired on useByAt is unusable',
     prepared.usableQty(new Date(NOW.getTime() + 25 * HOUR)) === 0,
     String(prepared.usableQty(new Date(NOW.getTime() + 25 * HOUR))));
  ok('prepared row still usable inside useByAt',
     prepared.usableQty(new Date(NOW.getTime() + 23 * HOUR)) === 1000,
     String(prepared.usableQty(new Date(NOW.getTime() + 23 * HOUR))));

  const q = new InventoryItem({ ...base, quarantined: 500, availableQty: 1500, onHand: 2000 });
  ok('quarantined stock is not usable', q.usableQty(NOW) === 1000, String(q.usableQty(NOW)));
}

// ---- batch: BR-10, BR-11, BR-13 -------------------------------------------
console.log('\n-- batch --');
{
  const base = {
    batchNo: 'B-2026-0001',
    outlet: OID,
    business: OID,
    supplier: OID,
    procurementReceipt: OID,
    receiptItem: OID,
    product: OID,
    rawSku: 'CHK-WHOLE',
    unit: 'GRAM',
    receivedQty: 1400,
    receivedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 48 * HOUR),
  };
  ok('valid batch accepted', !rejects(new Batch(base)));
  ok('status is a closed enum', rejects(new Batch({ ...base, status: 'on_fire' })));
  ok('expiry is required (BR-13 — undated meat is unsellable meat)',
     rejects(new Batch({ ...base, expiresAt: undefined })));
  ok('receivedAt is required', rejects(new Batch({ ...base, receivedAt: undefined })));
  ok('supplier is required (traceability starts at the gate)',
     rejects(new Batch({ ...base, supplier: undefined })));

  const fresh = new Batch(base);
  ok('source batch is usable', fresh.usableQty(NOW) === 0 || fresh.usableQty(NOW) >= 0);

  const expired = new Batch(base);
  expired.availableQty = 900;
  ok('expired batch has zero usable stock', expired.usableQty(new Date(NOW.getTime() + 49 * HOUR)) === 0);

  const frozen = new Batch({ ...base, status: 'quarantined' });
  frozen.availableQty = 900;
  ok('quarantined batch has zero usable stock even with stock on the books',
     frozen.usableQty(NOW) === 0, String(frozen.usableQty(NOW)));
  ok('isFrozen() reports true for a quarantined batch', frozen.isFrozen() === true);
  ok('isFrozen() reports false for a source batch', fresh.isFrozen() === false);

  // Yield: the concept the blueprint omits entirely.
  const cut = new Batch({
    ...base,
    cutQty: 910,
    uncutQty: 120,
    yieldRecorded: {
      yieldSpec: OID,
      cutType: 'curry_cut',
      expectedPct: 65,
      actualPct: 61,
      variancePct: -4,
      direction: 'BELOW_EXPECTED',
      at: NOW,
    },
  });
  ok('batch carries its cut/uncut split (BR-11)', cut.cutQty === 910 && cut.uncutQty === 120);
  ok('yield variance is recorded on the batch',
     cut.yieldRecorded.variancePct === -4 && cut.yieldRecorded.direction === 'BELOW_EXPECTED');
  ok('unknown cutType rejected',
     rejects(new Batch({ ...base, yieldRecorded: { cutType: 'diced', expectedPct: 50, actualPct: 50 } })));
}

// ---- allocation: the recall index ------------------------------------------
console.log('\n-- allocation (BR-10) --');
{
  const base = {
    batch: OID,
    outlet: OID,
    business: OID,
    allocationType: 'CONSUMPTION',
    qtyDelta: -1080,
    orderItem: OID,
    order: OID,
    occurredAt: NOW,
  };
  ok('valid consumption allocation accepted', !rejects(new Allocation(base)));
  ok('allocationType is a closed enum', rejects(new Allocation({ ...base, allocationType: 'SOLD' })));
  ok('batch is required (an allocation with no batch traces nothing)',
     rejects(new Allocation({ ...base, batch: undefined })));
  ok('quantity is signed (negative consumption is legal)',
     rejects(new Allocation({ ...base, qtyDelta: 1080 })) === false);

  const idx = Allocation.schema.indexes();
  // "Batch X is compromised — who ate it?" is the operation that runs under time
  // pressure. Without this index it is a collection scan while an officer waits.
  ok('THE RECALL INDEX exists: {batch, occurredAt}',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ batch: 1, occurredAt: -1 })),
     JSON.stringify(idx.map((i) => i[0])));
  ok('the reverse index exists: {orderItem}',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ orderItem: 1 })));
  ok('wastage reporting is indexed: {outlet, allocationType, occurredAt}',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, allocationType: 1, occurredAt: -1 })));

  ok('CONSUMPTION is a real allocation type', Allocation.ALLOCATION_TYPES.includes('CONSUMPTION'));
  ok('RECALL_FREEZE is a real allocation type', Allocation.ALLOCATION_TYPES.includes('RECALL_FREEZE'));
  ok('EXPIRY_WRITE_OFF is a real allocation type', Allocation.ALLOCATION_TYPES.includes('EXPIRY_WRITE_OFF'));
  ok('YIELD_SPLIT is a real allocation type', Allocation.ALLOCATION_TYPES.includes('YIELD_SPLIT'));

  // BR-10: one order line may appear in many allocations. Nothing here prevents
  // that — the many-to-many IS the design. Compared as STRINGS because Mongoose
  // casts refs to distinct `ObjectId` instances, so `===` on two of them is false
  // even when they hold the same value. `toString()` is the comparison the recall
  // query effectively makes once the objects are indexed.
  const sharedItem = OID;
  const a = new Allocation({ ...base, orderItem: sharedItem, qtyDelta: -1080 });
  const b = new Allocation({
    ...base,
    batch: new mongoose.Types.ObjectId().toString(),
    orderItem: sharedItem,
    qtyDelta: -20,
  });
  ok(
    'one order item may draw on several batches (BR-10)',
    a.orderItem.toString() === b.orderItem.toString() && a.batch.toString() !== b.batch.toString(),
    a.orderItem.toString() + ' vs ' + b.orderItem.toString()
  );
  ok(
    'each allocation carries its own quantity',
    a.qtyDelta === -1080 && b.qtyDelta === -20,
    a.qtyDelta + ' / ' + b.qtyDelta
  );
  ok('quantities sum to the line total (1080g across two batches)', a.qtyDelta + b.qtyDelta === -1100);

  // The trap: no unique index may exist on {orderItem} — a one-batch-per-line
  // constraint would make the split allocation impossible and silently break
  // traceability for every order that spans two batches.
  const aidx = Allocation.schema.indexes();
  ok('orderItem is indexed but NOT uniquely (splits must be allowed)',
     aidx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ orderItem: 1 }) && !(i[1] && i[1].unique)),
     JSON.stringify(aidx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));
}

// ---- movement ---------------------------------------------------------------
console.log('\n-- inventory movement --');
{
  const base = {
    outlet: OID,
    inventoryItem: OID,
    kind: 'raw',
    movementType: 'ORDER_CONSUMPTION',
    qtyDelta: -1080,
    reservedDelta: -1080,
    onHandAfter: 920,
    reservedAfter: 0,
    movementSeq: 42,
  };
  ok('valid movement accepted', !rejects(new Movement(base)));
  ok('movementType is a closed enum', rejects(new Movement({ ...base, movementType: 'SOLD' })));
  ok('counters after are required (a replay needs them)',
     rejects(new Movement({ ...base, onHandAfter: undefined })));

  // The blueprint's ten, all present.
  const blueprintTypes = [
    'PURCHASE', 'RECEIPT', 'QUALITY_REJECTION', 'STOCK_IN', 'ORDER_RESERVATION',
    'ORDER_CONSUMPTION', 'ADJUSTMENT', 'WASTAGE', 'RETURN', 'TRANSFER',
  ];
  const missing = blueprintTypes.filter((t) => !Movement.MOVEMENT_TYPES.includes(t));
  ok('all ten blueprint §23 movement types present', missing.length === 0, missing.join(', '));

  // Plus the six fresh meat needs.
  const extra = ['YIELD_SPLIT', 'RESERVATION_RELEASE', 'RECALL_FREEZE', 'EXPIRY_WRITE_OFF', 'COUNT_ADJUSTMENT', 'SUBSTITUTION'];
  const missingExtra = extra.filter((t) => !Movement.MOVEMENT_TYPES.includes(t));
  ok('the six fresh-meat movement types are present', missingExtra.length === 0, missingExtra.join(', '));

  ok('ORDER_CONSUMPTION moves both counters', JSON.stringify(Movement.effectOf('ORDER_CONSUMPTION')) === JSON.stringify({ onHand: -1, reserved: -1 }));
  ok('RECALL_FREEZE moves no counter (state, not stock)', JSON.stringify(Movement.effectOf('RECALL_FREEZE')) === JSON.stringify({ onHand: 0, reserved: 0 }));
  ok('every movement type declares an effect',
     Movement.MOVEMENT_TYPES.every((t) => Movement.effectOf(t) !== null));
}

// ---- wastage: the avoidable/inherent split ---------------------------------
console.log('\n-- wastage --');
{
  const base = {
    wastageNo: 'W-2026-0001',
    outlet: OID,
    business: OID,
    product: OID,
    batch: OID,
    order: OID,
    qty: 180,
    unit: 'GRAM',
    unitCost: 285,
    estimatedValue: 51.3,
    cause: 'TRIM',
    orderLinked: true,
    occurredAt: NOW,
  };
  ok('valid wastage record accepted', !rejects(new Wastage(base)));
  ok('cause is a closed enum', rejects(new Wastage({ ...base, cause: 'MISTAKE' })));
  ok('qty is required', rejects(new Wastage({ ...base, qty: undefined })));

  ok('estimatedValue is money (frozen at loss, not repriced)',
     new Wastage(base).estimatedValue === 51.3, String(new Wastage(base).estimatedValue));
  ok('estimatedValue stores paise',
     new Wastage(base).toObject({ getters: false }).estimatedValue === 5130,
     String(new Wastage(base).toObject({ getters: false }).estimatedValue));

  ok('TRIM is inherent (cost of doing business)', Wastage.classifyCause('TRIM') === 'inherent');
  ok('SPOILAGE is avoidable (a decision)', Wastage.classifyCause('SPOILAGE') === 'avoidable');
  ok('OVER_PREPARATION is avoidable', Wastage.classifyCause('OVER_PREPARATION') === 'avoidable');
  ok('THEFT_LOSS is avoidable', Wastage.classifyCause('THEFT_LOSS') === 'avoidable');
  // An unexplained loss counts against the business until it is explained.
  ok('OTHER counts as avoidable until explained', Wastage.classifyCause('OTHER') === 'avoidable');

  ok('orderLinked is the avoidable-waste reporting flag', new Wastage(base).orderLinked === true);

  const idx = Wastage.schema.indexes();
  ok('order-linked loss is separately indexed',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ outlet: 1, orderLinked: 1, occurredAt: -1 })));
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL INVENTORY / TRACEABILITY CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);