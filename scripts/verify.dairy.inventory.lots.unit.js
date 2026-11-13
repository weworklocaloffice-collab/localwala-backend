const assert = require('assert');
const { DairySku, DairySkuInventoryLot, DairySkuInventoryMovement } = require('../src/models');
const inventoryLots = require('../src/modules/dairy/services/dairy.inventory.lot.service');

const run = async () => {
  const originalSkuFindOne = DairySku.findOne;
  const originalSkuUpdateOne = DairySku.updateOne;
  const originalSkuFindById = DairySku.findById;
  const originalLotFind = DairySkuInventoryLot.find;
  const originalLotFindById = DairySkuInventoryLot.findById;
  const originalLotFindOne = DairySkuInventoryLot.findOne;
  const originalLotUpdateOne = DairySkuInventoryLot.updateOne;
  const originalMovementFindOne = DairySkuInventoryMovement.findOne;
  const originalMovementFind = DairySkuInventoryMovement.find;
  const originalMovementCreate = DairySkuInventoryMovement.create;
  const movementRows = [];
  const now = Date.now();
  const sku = {
    _id: 'sku-a',
    business: 'business-a',
    name: 'Fresh Milk 500 ml',
    availableQty: 11,
    inStock: true,
    lotTrackingEnabled: true,
    lotTrackingInitializing: false,
    batchTracked: false,
  };
  const lots = [
    { _id: 'lot-expiring-first', business: 'business-a', sku: 'sku-a', lotNo: 'A-1', expiry: new Date(now + 86400000), receivedAt: new Date(now - 3000), availableQty: 3, expiredQty: 0, status: 'active' },
    { _id: 'lot-expiring-next', business: 'business-a', sku: 'sku-a', lotNo: 'A-2', expiry: new Date(now + 172800000), receivedAt: new Date(now - 2000), availableQty: 4, expiredQty: 0, status: 'active' },
    { _id: 'lot-opening', business: 'business-a', sku: 'sku-a', lotNo: 'OPENING-sku-a', expiry: null, receivedAt: new Date(now - 10000), availableQty: 4, expiredQty: 0, status: 'active' },
  ];

  const compare = (actual, operator, expected) => {
    if (operator === '$gte') return actual >= expected;
    if (operator === '$gt') return actual > expected;
    if (operator === '$lte') return actual <= expected;
    if (operator === '$lt') return actual < expected;
    if (operator === '$ne') return actual !== expected;
    return true;
  };
  const matches = (doc, query) => Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some((branch) => matches(doc, branch));
    if (key === '_id' || key === 'business' || key === 'sku' || key === 'status') return doc[key] === expected;
    if (key === 'availableQty' || key === 'expiry' || key === 'lotTrackingEnabled' || key === 'lotTrackingInitializing') {
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        return Object.entries(expected).every(([operator, value]) => compare(doc[key], operator, value));
      }
      return doc[key] === expected;
    }
    return true;
  });

  try {
    DairySku.findOne = async () => sku;
    DairySku.updateOne = async (query, update) => {
      if (!matches(sku, query)) return { matchedCount: 0, modifiedCount: 0 };
      for (const [key, value] of Object.entries(update.$inc || {})) sku[key] = (sku[key] || 0) + value;
      Object.assign(sku, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    };
    DairySku.findById = () => ({ select: async () => sku });
    DairySkuInventoryLot.find = (query) => {
      const result = lots.filter((lot) => matches(lot, query));
      return {
        select() { return this; },
        lean: async () => result,
      };
    };
    DairySkuInventoryLot.findById = (id) => ({
      select: async () => ({ availableQty: lots.find((lot) => lot._id === id)?.availableQty }),
    });
    DairySkuInventoryLot.findOne = async (query) => {
      const lot = lots.find((candidate) => matches(candidate, query));
      if (lot) lot.save = async () => {};
      return lot;
    };
    DairySkuInventoryLot.updateOne = async (query, update) => {
      const lot = lots.find((candidate) => matches(candidate, query));
      if (!lot) return { matchedCount: 0, modifiedCount: 0 };
      for (const [key, value] of Object.entries(update.$inc || {})) lot[key] = (lot[key] || 0) + value;
      Object.assign(lot, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    };
    DairySkuInventoryMovement.findOne = async (query) => movementRows.find((movement) => movement.idempotencyKey === query.idempotencyKey) || null;
    DairySkuInventoryMovement.find = () => ({ select() { return this; }, lean: async () => movementRows });
    DairySkuInventoryMovement.create = async (movement) => {
      movementRows.push(movement);
      return movement;
    };

    const reserved = await inventoryLots.reserveSkuStock({ skuId: 'sku-a', businessId: 'business-a', quantity: 5 });
    assert.deepStrictEqual(reserved.allocations.map((item) => [item.lotNo, item.quantity]), [
      ['A-1', 3],
      ['A-2', 2],
    ]);
    assert.strictEqual(sku.availableQty, 6);

    await inventoryLots.releaseSkuStock({ skuId: 'sku-a', businessId: 'business-a', quantity: 5, allocations: reserved.allocations });
    assert.strictEqual(sku.availableQty, 11);
    assert.strictEqual(lots[0].availableQty, 3);
    assert.strictEqual(lots[1].availableQty, 4);

    const originalStock = sku.availableQty;
    const originalLots = lots.map((lot) => lot.availableQty);
    await assert.rejects(
      inventoryLots.reserveSkuStock({ skuId: 'sku-a', businessId: 'business-a', quantity: 5, requiredThrough: new Date(now + 259200000) }),
      (error) => error.statusCode === 400
    );
    assert.strictEqual(sku.availableQty, originalStock, 'an incomplete FEFO allocation must return its SKU reservation');
    assert.deepStrictEqual(lots.map((lot) => lot.availableQty), originalLots, 'an incomplete FEFO allocation must return every lot quantity');

    const oneUnit = await inventoryLots.reserveSkuStock({ skuId: 'sku-a', businessId: 'business-a', quantity: 1 });
    const allocatedLot = lots.find((lot) => lot._id === oneUnit.allocations[0].lot);
    allocatedLot.expiry = new Date(Date.now() - 1000);
    const beforeExpiredReturn = sku.availableQty;
    await inventoryLots.releaseSkuStock({ skuId: 'sku-a', businessId: 'business-a', quantity: 1, allocations: oneUnit.allocations });
    assert.strictEqual(sku.availableQty, beforeExpiredReturn, 'expired returns must not re-enter sellable SKU stock');
    assert.strictEqual(allocatedLot.expiredQty, 1);

    const damagedLot = {
      _id: 'lot-damaged', business: 'business-a', sku: 'sku-a', lotNo: 'DAMAGED-1',
      expiry: new Date(Date.now() + 86400000), receivedAt: new Date(), availableQty: 2,
      heldQty: 0, expiredQty: 0, writtenOffQty: 0, status: 'active', save: async () => {},
    };
    lots.push(damagedLot);
    sku.availableQty += damagedLot.availableQty;
    await inventoryLots.writeOffLot('sku-a', 'business-a', 'lot-damaged', {
      quantity: 1, bucket: 'available', reason: 'Damaged packaging',
    }, 'partner-a');
    assert.strictEqual(damagedLot.availableQty, 1);
    assert.strictEqual(damagedLot.writtenOffQty, 1);
    assert.strictEqual(sku.availableQty, 11);
    assert.strictEqual(movementRows.at(-1).eventType, 'write_off');
    assert.strictEqual(movementRows.at(-1).reason, 'Damaged packaging');

    await inventoryLots.setLotDisposition('sku-a', 'business-a', 'lot-damaged', {
      action: 'hold', reason: 'Quality review',
    }, 'partner-a');
    assert.strictEqual(damagedLot.status, 'held');
    assert.strictEqual(damagedLot.availableQty, 0);
    assert.strictEqual(damagedLot.heldQty, 1);
    assert.strictEqual(sku.availableQty, 10);

    await inventoryLots.setLotDisposition('sku-a', 'business-a', 'lot-damaged', {
      action: 'release', reason: 'Quality check passed',
    }, 'partner-a');
    assert.strictEqual(damagedLot.status, 'active');
    assert.strictEqual(damagedLot.availableQty, 1);
    assert.strictEqual(damagedLot.heldQty, 0);
    assert.strictEqual(sku.availableQty, 11);

    await inventoryLots.setLotDisposition('sku-a', 'business-a', 'lot-damaged', {
      action: 'recall', reason: 'Supplier recall notice',
    }, 'partner-a');
    assert.strictEqual(damagedLot.status, 'recalled');
    assert.strictEqual(damagedLot.availableQty, 0);
    assert.strictEqual(damagedLot.heldQty, 1);
    assert.strictEqual(sku.availableQty, 10);
    await assert.rejects(
      inventoryLots.setLotDisposition('sku-a', 'business-a', 'lot-damaged', {
        action: 'release', reason: 'Try to release recall',
      }, 'partner-a'),
      (error) => error.statusCode === 409
    );

    process.stdout.write('Dairy inventory movement, lot disposition, and write-off verification passed.\n');
  } finally {
    DairySku.findOne = originalSkuFindOne;
    DairySku.updateOne = originalSkuUpdateOne;
    DairySku.findById = originalSkuFindById;
    DairySkuInventoryLot.find = originalLotFind;
    DairySkuInventoryLot.findById = originalLotFindById;
    DairySkuInventoryLot.findOne = originalLotFindOne;
    DairySkuInventoryLot.updateOne = originalLotUpdateOne;
    DairySkuInventoryMovement.findOne = originalMovementFindOne;
    DairySkuInventoryMovement.find = originalMovementFind;
    DairySkuInventoryMovement.create = originalMovementCreate;
  }
};

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
