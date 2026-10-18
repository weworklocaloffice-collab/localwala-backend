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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.inventory.js — BR-30: overselling is impossible.
 *
 * Run: node scripts/verify.stores.inventory.js
 *
 * ## Why this suite exists
 *
 * `stores.inventory.service.js` carries the single riskiest rule in the vertical: if the
 * availability guard is wrong, the platform silently sells stock it does not have, and the
 * loss surfaces days later at picking time. Every other stores rule degrades loudly; this one
 * does not.
 *
 * The plan (§7.3) requires exactly this proof:
 *
 *     verify.stores.reservation.js green
 *     including 200 concurrent reserves against 100 units -> exactly 100 succeed
 *
 * That assertion is the first block below. The rest of the file pins the surrounding
 * contract the concurrency guarantee depends on — the movement ledger, the five movement
 * types, the availability arithmetic, and the commit/release pair.
 *
 * ## What is deliberately NOT faked
 *
 * The concurrency test hits a real database. A `$expr`-based guard cannot be proven with a
 * stub, because the stub is the thing that would be wrong. Mongoose is connected against
 * the configured `MONGODB_URL`; every row created here is deleted in the `finally`.
 *
 * Fixtures are synthetic ObjectIds — Mongoose does not enforce ref existence, and the
 * inventory service never populates outlet/variant/chain, so no taxonomy rows are needed.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const inventoryService = require('../src/modules/stores/services/stores.inventory.service');

// The service resolves models through `mongoose.model(...)` at call time, so the schemas
// must be registered before it is invoked.
require('../src/modules/stores/models/store.outlet.stock.item.model');
require('../src/modules/stores/models/store.stock.reservation.model');
require('../src/modules/stores/models/store.inventory.movement.model');
// `getStockForOutlet` / `getLowStockItems` populate `product`, which resolves through the
// `ChainProduct` model name. Registering the schema is a precondition for those two.
require('../src/modules/stores/models/chain.product.model');

const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
const StoreStockReservation = mongoose.model('StoreStockReservation');
const StoreInventoryMovement = mongoose.model('StoreInventoryMovement');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const isConflict = (e) => e && e.statusCode === 409 && /INSUFFICIENT_STOCK/.test(e.message || '');

const OUTLET = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();
const variantId = (n) => {
  const v = new mongoose.Types.ObjectId();
  // A stable per-variant id is derived from the outlet so parallel runs never collide on
  // the unique (outlet, variant) index.
  v._bsontype = undefined;
  return v;
};

// One distinct variant per scenario keeps each block's counters independent.
const V = {
  oversell: new mongoose.Types.ObjectId(),
  ledger: new mongoose.Types.ObjectId(),
  types: new mongoose.Types.ObjectId(),
  cycle: new mongoose.Types.ObjectId(),
  lowA: new mongoose.Types.ObjectId(),
  lowB: new mongoose.Types.ObjectId(),
};

const seedStock = async (variant, { onHand = 0, lowStockThreshold = 0, damaged = 0, allowNegativeStock = false } = {}) => {
  return StoreOutletStockItem.create({
    outlet: OUTLET,
    chain: CHAIN,
    variant,
    product: new mongoose.Types.ObjectId(),
    onHand,
    reserved: 0,
    damaged,
    incoming: 0,
    availableQty: onHand - damaged,
    lowStockThreshold,
    allowNegativeStock,
    movementSeq: 0,
  });
};

const cleanup = async () => {
  await StoreInventoryMovement.deleteMany({ outlet: OUTLET });
  await StoreStockReservation.deleteMany({ outlet: OUTLET });
  await StoreOutletStockItem.deleteMany({ outlet: OUTLET });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  console.log('\n=== BR-30: 200 concurrent reserves against 100 units ===\n');

  await seedStock(V.oversell, { onHand: 100 });

  const ATTEMPTS = 200;
  const results = await Promise.allSettled(
    Array.from({ length: ATTEMPTS }, (_, i) =>
      inventoryService.reserveStock({
        outlet: OUTLET,
        chain: CHAIN,
        variant: V.oversell,
        product: new mongoose.Types.ObjectId(),
        order: new mongoose.Types.ObjectId(),
        quantity: 1,
      })
    )
  );

  const granted = results.filter((r) => r.status === 'fulfilled').length;
  const refused = results.filter((r) => r.status === 'rejected');
  const refusedForStock = refused.filter((r) => isConflict(r.reason)).length;

  ck('exactly 100 of 200 reserves are granted', granted === 100, `granted=${granted}`);
  ck('the other 100 are refused', refused.length === 100, `refused=${refused.length}`);
  ck('every refusal is an INSUFFICIENT_STOCK conflict', refusedForStock === 100, `conflicts=${refusedForStock}`);

  const after = await StoreOutletStockItem.findOne({ outlet: OUTLET, variant: V.oversell }).lean();
  ck('reserved reaches exactly the 100 on hand', after.reserved === 100, `reserved=${after.reserved}`);
  ck('availableQty lands on zero', after.availableQty === 0, `availableQty=${after.availableQty}`);
  ck('availableQty never goes negative (BR-30)', after.availableQty >= 0, `availableQty=${after.availableQty}`);
  ck('reserve does not decrement onHand — that is commit', after.onHand === 100, `onHand=${after.onHand}`);

  const heldRows = await StoreStockReservation.countDocuments({ outlet: OUTLET, variant: V.oversell, status: 'held' });
  const releasedRows = await StoreStockReservation.countDocuments({ outlet: OUTLET, variant: V.oversell, status: 'released' });
  ck('100 reservations are held', heldRows === 100, `held=${heldRows}`);
  ck('the 100 refusals are released, not leaked', releasedRows === 100, `released=${releasedRows}`);

  console.log('\n=== the reservation ledger ===\n');

  await seedStock(V.ledger, { onHand: 10 });
  const order = new mongoose.Types.ObjectId();
  const reservedOnce = await inventoryService.reserveStock({
    outlet: OUTLET, chain: CHAIN, variant: V.ledger, product: new mongoose.Types.ObjectId(), order, quantity: 3,
  });
  ck('reserve returns the item and the reservation', !!reservedOnce.item && !!reservedOnce.reservation);
  ck('the reservation is held', reservedOnce.reservation.status === 'held');

  const reserveMovements = await StoreInventoryMovement.find({ outlet: OUTLET, variant: V.ledger, type: 'RESERVED' }).lean();
  ck('reserve appends a RESERVED movement', reserveMovements.length === 1, `count=${reserveMovements.length}`);
  ck('the movement carries the reserved delta', reserveMovements[0].reservedDelta === 3, `delta=${reserveMovements[0].reservedDelta}`);

  const replay = await inventoryService.reserveStock({
    outlet: OUTLET, chain: CHAIN, variant: V.ledger, product: new mongoose.Types.ObjectId(), order, quantity: 3,
  });
  ck('re-reserving the same order+variant is a no-op', replay.item.reserved === 3, `reserved=${replay.item.reserved}`);
  const replayMovements = await StoreInventoryMovement.countDocuments({ outlet: OUTLET, variant: V.ledger, type: 'RESERVED' });
  ck('the replay appends no second movement', replayMovements === 1, `count=${replayMovements}`);

  console.log('\n=== the five movement types ===\n');

  await seedStock(V.types, { onHand: 20 });
  const p = new mongoose.Types.ObjectId();

  const added = await inventoryService.adjustStock({ outlet: OUTLET, chain: CHAIN, variant: V.types, product: p, type: 'STOCK_ADDED', quantity: 5 });
  ck('STOCK_ADDED raises onHand and availableQty', added.onHand === 25 && added.availableQty === 25, `onHand=${added.onHand}`);

  const removed = await inventoryService.adjustStock({ outlet: OUTLET, chain: CHAIN, variant: V.types, product: p, type: 'STOCK_REMOVED', quantity: 3 });
  ck('STOCK_REMOVED lowers onHand', removed.onHand === 22 && removed.availableQty === 22, `onHand=${removed.onHand}`);

  const adjusted = await inventoryService.adjustStock({ outlet: OUTLET, chain: CHAIN, variant: V.types, product: p, type: 'ADJUSTMENT', quantity: 40 });
  ck('ADJUSTMENT sets onHand absolutely', adjusted.onHand === 40 && adjusted.availableQty === 40, `onHand=${adjusted.onHand}`);

  const damaged = await inventoryService.adjustStock({ outlet: OUTLET, chain: CHAIN, variant: V.types, product: p, type: 'DAMAGED', quantity: 4 });
  ck('DAMAGED moves units out of onHand and into damaged', damaged.onHand === 36 && damaged.damaged === 4, `onHand=${damaged.onHand} damaged=${damaged.damaged}`);
  ck('damaged units leave availability', damaged.availableQty === 32, `availableQty=${damaged.availableQty}`);

  const expired = await inventoryService.adjustStock({ outlet: OUTLET, chain: CHAIN, variant: V.types, product: p, type: 'EXPIRED', quantity: 2 });
  ck('EXPIRED books to damaged when negatives are disallowed', expired.damaged === 6, `damaged=${expired.damaged}`);
  ck('EXPIRED lowers onHand', expired.onHand === 34, `onHand=${expired.onHand}`);

  let rejected = false;
  try {
    await inventoryService.adjustStock({ outlet: OUTLET, chain: CHAIN, variant: V.types, product: p, type: 'TELEPORTED', quantity: 1 });
  } catch (e) {
    rejected = /Unknown movement type/.test(e.message || '');
  }
  ck('an unknown movement type is rejected', rejected);

  const movements = await inventoryService.getMovements({ outlet: OUTLET, variant: V.types, limit: 100 });
  ck('every adjustment appends a movement row', movements.length === 5, `count=${movements.length}`);
  // getMovements sorts newest-first, so the sequence numbers read back in reverse.
  const seqs = movements.map((m) => m.movementSeq);
  ck(
    'movementSeq is strictly monotonic',
    seqs.every((v, i) => i === 0 || v < seqs[i - 1]),
    `seqs=${seqs.join(',')}`
  );

  console.log('\n=== availableQty arithmetic ===\n');

  const probe = { onHand: 50, reserved: 12, damaged: 8 };
  inventoryService.recalculateAvailable(probe);
  ck('available = onHand - reserved - damaged', probe.availableQty === 30, `availableQty=${probe.availableQty}`);

  console.log('\n=== commit and release ===\n');

  await seedStock(V.cycle, { onHand: 10 });
  const orderA = new mongoose.Types.ObjectId();
  await inventoryService.reserveStock({ outlet: OUTLET, chain: CHAIN, variant: V.cycle, product: p, order: orderA, quantity: 4 });

  const committed = await inventoryService.commitReservation({ order: orderA, variant: V.cycle, quantity: 4 });
  ck('commit removes from onHand and reserved', committed.onHand === 6 && committed.reserved === 0, `onHand=${committed.onHand} reserved=${committed.reserved}`);
  ck('commit restores availability to the unsold remainder', committed.availableQty === 6, `availableQty=${committed.availableQty}`);
  const soldMovements = await StoreInventoryMovement.countDocuments({ outlet: OUTLET, variant: V.cycle, type: 'SOLD' });
  ck('commit appends a SOLD movement', soldMovements === 1, `count=${soldMovements}`);

  const orderB = new mongoose.Types.ObjectId();
  await inventoryService.reserveStock({ outlet: OUTLET, chain: CHAIN, variant: V.cycle, product: p, order: orderB, quantity: 2 });
  const released = await inventoryService.releaseReservation({ order: orderB, variant: V.cycle, quantity: 2, reason: 'order_cancelled' });
  ck('release returns the units to availability', released.reserved === 0 && released.availableQty === 6, `reserved=${released.reserved} availableQty=${released.availableQty}`);
  ck('release leaves onHand untouched', released.onHand === 6, `onHand=${released.onHand}`);

  const releaseAgain = await inventoryService.releaseReservation({ order: orderB, variant: V.cycle, quantity: 2, reason: 'order_cancelled' });
  ck('a second release is a no-op, not a double credit', releaseAgain.reserved === 0 && releaseAgain.availableQty === 6, `availableQty=${releaseAgain.availableQty}`);

  const ghostRelease = await inventoryService.releaseReservation({ order: new mongoose.Types.ObjectId(), variant: V.cycle, quantity: 1 });
  ck('releasing an unknown reservation returns null instead of throwing', ghostRelease === null);

  console.log('\n=== low stock query ===\n');

  await seedStock(V.lowA, { onHand: 3, lowStockThreshold: 5 });
  await seedStock(V.lowB, { onHand: 40, lowStockThreshold: 5 });
  const low = await inventoryService.getLowStockItems(OUTLET);
  const lowVariants = low.map((i) => String(i.variant));
  ck('an item at or below its threshold is reported', lowVariants.includes(String(V.lowA)));
  ck('an item above its threshold is not reported', !lowVariants.includes(String(V.lowB)));
};

run()
  .catch((e) => {
    failures += 1;
    console.log('\nSUITE ERROR: ' + (e && e.stack ? e.stack : e));
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      /* the run already failed; cleanup errors must not mask it */
    }
    await mongoose.disconnect();
    console.log('\n' + (failures === 0 ? 'ALL STORES INVENTORY CHECKS PASSED' : failures + ' STORES INVENTORY CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });