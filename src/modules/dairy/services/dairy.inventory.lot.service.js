const { setTimeout: delay } = require('timers/promises');
const { status: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const { DairySku, DairySkuInventoryLot, DairySkuInventoryMovement } = require('../../../models');
const ApiError = require('../../../utils/ApiError');

const OPENING_LOT_PREFIX = 'OPENING-';

const notEnoughStock = (sku, quantity) => new ApiError(
  httpStatus.BAD_REQUEST,
  `Not enough unexpired stock for ${sku.name}. Need ${quantity}, ${sku.availableQty} shown available.`
);

const getOwnedSku = async (skuId, businessId) => {
  const sku = await DairySku.findOne({ _id: skuId, business: businessId });
  if (!sku) throw new ApiError(httpStatus.NOT_FOUND, 'SKU not found');
  return sku;
};

const recordMovement = async ({
  sku, eventType, quantity, allocations = [], availableDelta = 0, heldDelta = 0,
  expiredDelta = 0, writtenOffDelta = 0, sourceType = 'manual', sourceId,
  idempotencyKey, reason = '', note = '', actorId,
}) => {
  if (idempotencyKey) {
    const existing = await DairySkuInventoryMovement.findOne({ idempotencyKey });
    if (existing) {
      existing._alreadyRecorded = true;
      return existing;
    }
  }
  const currentSku = await DairySku.findById(sku._id).select('availableQty');
  const touchedLots = allocations.length
    ? await DairySkuInventoryLot.find({ _id: { $in: allocations.map((item) => item.lot) } }).select('availableQty heldQty expiredQty writtenOffQty').lean()
    : [];
  const movement = {
    business: sku.business,
    sku: sku._id,
    eventType,
    quantity,
    availableDelta,
    heldDelta,
    expiredDelta,
    writtenOffDelta,
    allocations,
    sourceType,
    sourceId,
    idempotencyKey,
    reason,
    note,
    actor: actorId,
    balanceAfter: {
      skuAvailableQty: Number(currentSku?.availableQty || 0),
      lotAvailableQty: touchedLots.reduce((sum, lot) => sum + Number(lot.availableQty || 0), 0),
      lotHeldQty: touchedLots.reduce((sum, lot) => sum + Number(lot.heldQty || 0), 0),
      lotExpiredQty: touchedLots.reduce((sum, lot) => sum + Number(lot.expiredQty || 0), 0),
      lotWrittenOffQty: touchedLots.reduce((sum, lot) => sum + Number(lot.writtenOffQty || 0), 0),
    },
  };
  try {
    return await DairySkuInventoryMovement.create(movement);
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await DairySkuInventoryMovement.findOne({ idempotencyKey });
      if (existing) existing._alreadyRecorded = true;
      return existing;
    }
    throw error;
  }
};

/** Establishes a one-time starting point for lots that were already enabled before the ledger shipped. */
const ensureMovementBaseline = async (sku) => {
  const idempotencyKey = `opening:${sku._id}`;
  if (await DairySkuInventoryMovement.findOne({ idempotencyKey })) return;
  const [currentSku, lots, priorMovements] = await Promise.all([
    DairySku.findById(sku._id).select('availableQty'),
    DairySkuInventoryLot.find({ business: sku.business, sku: sku._id })
      .select('_id lotNo availableQty heldQty expiredQty writtenOffQty').lean(),
    DairySkuInventoryMovement.find({ business: sku.business, sku: sku._id })
      .select('availableDelta heldDelta expiredDelta writtenOffDelta').lean(),
  ]);
  const previous = priorMovements.reduce((sum, event) => ({
    availableDelta: sum.availableDelta + Number(event.availableDelta || 0),
    heldDelta: sum.heldDelta + Number(event.heldDelta || 0),
    expiredDelta: sum.expiredDelta + Number(event.expiredDelta || 0),
    writtenOffDelta: sum.writtenOffDelta + Number(event.writtenOffDelta || 0),
  }), { availableDelta: 0, heldDelta: 0, expiredDelta: 0, writtenOffDelta: 0 });
  const current = {
    availableDelta: Number(currentSku?.availableQty || 0),
    heldDelta: lots.reduce((sum, lot) => sum + Number(lot.heldQty || 0), 0),
    expiredDelta: lots.reduce((sum, lot) => sum + Number(lot.expiredQty || 0), 0),
    writtenOffDelta: lots.reduce((sum, lot) => sum + Number(lot.writtenOffQty || 0), 0),
  };
  const baseline = {
    availableDelta: current.availableDelta - previous.availableDelta,
    heldDelta: current.heldDelta - previous.heldDelta,
    expiredDelta: current.expiredDelta - previous.expiredDelta,
    writtenOffDelta: current.writtenOffDelta - previous.writtenOffDelta,
  };
  await recordMovement({
    sku,
    eventType: 'opening_balance',
    quantity: Math.abs(baseline.availableDelta),
    ...baseline,
    allocations: lots.filter((lot) => Number(lot.availableQty || 0) > 0).map((lot) => ({
      lot: lot._id,
      lotNo: lot.lotNo,
      quantity: Number(lot.availableQty),
    })),
    sourceType: 'system',
    sourceId: sku._id,
    idempotencyKey,
    reason: 'Opening balance for inventory lots that existed before movement auditing was enabled.',
  });
};

const finishLotTrackingSetup = async (sku) => {
  const currentQty = Math.max(0, Number(sku.availableQty || 0));
  if (currentQty > 0) {
    const openingLotNo = `${OPENING_LOT_PREFIX}${sku._id}`;
    try {
      await DairySkuInventoryLot.updateOne(
        { sku: sku._id, lotNo: openingLotNo },
        {
          $setOnInsert: {
            business: sku.business,
            sku: sku._id,
            lotNo: openingLotNo,
            receivedQty: currentQty,
            availableQty: currentQty,
            expiredQty: 0,
            receivedAt: sku.createdAt || new Date(),
            expiry: null,
            status: 'active',
            notes: 'Legacy opening stock converted when lot tracking was enabled; expiry is unknown.',
          },
        },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const openingLot = await DairySkuInventoryLot.findOne({ sku: sku._id, lotNo: openingLotNo }).select('_id lotNo');
    if (openingLot) {
      await recordMovement({
        sku,
        eventType: 'opening_balance',
        quantity: currentQty,
        availableDelta: currentQty,
        allocations: [{ lot: openingLot._id, lotNo: openingLot.lotNo, quantity: currentQty }],
        sourceType: 'system',
        sourceId: sku._id,
        idempotencyKey: `opening:${sku._id}`,
        note: 'Legacy available stock converted to a no-expiry opening lot.',
      });
    }
  }
  await DairySku.updateOne(
    { _id: sku._id, lotTrackingInitializing: true },
    { $set: { lotTrackingEnabled: true, lotTrackingInitializing: false } }
  );
  return getOwnedSku(sku._id, sku.business);
};

/**
 * Converts the current balance to a single no-expiry opening lot exactly once.
 * The temporary flag blocks older stock writers during this short migration.
 */
const ensureLotTracking = async (skuId, businessId) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sku = await getOwnedSku(skuId, businessId);
    if (sku.batchTracked) {
      throw new ApiError(httpStatus.CONFLICT, 'Raw-milk SKUs use Dairy milk batch tracking, not packaged-product lots.');
    }
    if (sku.lotTrackingEnabled && !sku.lotTrackingInitializing) {
      await ensureMovementBaseline(sku);
      return sku;
    }
    if (sku.lotTrackingInitializing) {
      await finishLotTrackingSetup(sku);
      continue;
    }

    const claimed = await DairySku.findOneAndUpdate(
      {
        _id: sku._id,
        lotTrackingEnabled: { $ne: true },
        lotTrackingInitializing: { $ne: true },
      },
      { $set: { lotTrackingInitializing: true } },
      { new: true }
    );
    if (claimed) {
      await finishLotTrackingSetup(claimed);
      continue;
    }
    await delay(15);
  }
  throw new ApiError(httpStatus.CONFLICT, 'Inventory lot setup is still in progress. Please retry shortly.');
};

const sortFefo = (lots) => lots.sort((a, b) => {
  const aExpiry = a.expiry ? new Date(a.expiry).getTime() : Number.MAX_SAFE_INTEGER;
  const bExpiry = b.expiry ? new Date(b.expiry).getTime() : Number.MAX_SAFE_INTEGER;
  return aExpiry - bExpiry || new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0);
});

const reserveFromLots = async (sku, quantity, requiredThrough = new Date()) => {
  const cutoff = new Date(requiredThrough);
  const lots = sortFefo(await DairySkuInventoryLot.find({
    business: sku.business,
    sku: sku._id,
    status: 'active',
    availableQty: { $gt: 0 },
    $or: [{ expiry: null }, { expiry: { $gte: cutoff } }],
  }).lean());

  let remaining = quantity;
  const allocations = [];
  try {
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, lot.availableQty);
      const expiryFilter = lot.expiry
        ? { expiry: { $gte: cutoff } }
        : { $or: [{ expiry: null }, { expiry: { $exists: false } }] };
      const result = await DairySkuInventoryLot.updateOne(
        {
          _id: lot._id,
          business: sku.business,
          sku: sku._id,
          status: 'active',
          availableQty: { $gte: take },
          ...expiryFilter,
        },
        { $inc: { availableQty: -take } }
      );
      if (result.modifiedCount !== 1) continue;
      allocations.push({ lot: lot._id, lotNo: lot.lotNo, quantity: take });
      remaining -= take;
      const updated = await DairySkuInventoryLot.findById(lot._id).select('availableQty');
      if (updated && updated.availableQty <= 0) {
        await DairySkuInventoryLot.updateOne({ _id: lot._id, availableQty: { $lte: 0 } }, { $set: { status: 'depleted' } });
      }
    }
  } catch (error) {
    for (const allocation of allocations) {
      await DairySkuInventoryLot.updateOne(
        { _id: allocation.lot },
        { $inc: { availableQty: allocation.quantity }, $set: { status: 'active' } }
      );
    }
    throw error;
  }
  return { allocations, remaining };
};

/** Atomically decrements the SKU and, when enabled, its FEFO lots. */
const reserveSkuStock = async ({ skuId, businessId, quantity, requiredThrough, sourceType = 'manual', sourceId, actorId, reason = '' }) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Stock quantity must be a positive whole number.');
  const idempotencyKey = sourceId ? `reserve:${sourceType}:${sourceId}:${skuId}` : undefined;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sku = await getOwnedSku(skuId, businessId);
    if (sku.lotTrackingInitializing) {
      await delay(15);
      continue;
    }
    if (sku.lotTrackingEnabled) {
      await ensureMovementBaseline(sku);
      await expireLotsForSku(sku._id, sku.business);
    }
    const currentSku = sku.lotTrackingEnabled ? await getOwnedSku(skuId, businessId) : sku;

    if (currentSku.lotTrackingEnabled && idempotencyKey) {
      const priorMovement = await DairySkuInventoryMovement.findOne({ idempotencyKey });
      if (priorMovement) return { lotTracked: true, allocations: priorMovement.allocations || [] };
    }

    const baseFilter = { _id: currentSku._id, business: currentSku.business, availableQty: { $gte: qty } };
    if (!currentSku.lotTrackingEnabled) {
      const result = await DairySku.updateOne(
        { ...baseFilter, lotTrackingEnabled: { $ne: true }, lotTrackingInitializing: { $ne: true } },
        { $inc: { availableQty: -qty } }
      );
      if (result.modifiedCount === 1) {
        await DairySku.updateOne({ _id: sku._id, availableQty: { $lte: 0 } }, { $set: { inStock: false } });
        return { lotTracked: false, allocations: [] };
      }
      continue;
    }

    const result = await DairySku.updateOne(
      { ...baseFilter, lotTrackingEnabled: true, lotTrackingInitializing: { $ne: true } },
      { $inc: { availableQty: -qty } }
    );
    if (result.modifiedCount !== 1) {
      const fresh = await getOwnedSku(currentSku._id, businessId);
      throw notEnoughStock(fresh, qty);
    }
    await DairySku.updateOne({ _id: currentSku._id, availableQty: { $lte: 0 } }, { $set: { inStock: false } });

    let reservedAllocations = [];
    try {
      const reserved = await reserveFromLots(currentSku, qty, requiredThrough || new Date());
      reservedAllocations = reserved.allocations;
      if (reserved.remaining > 0) throw notEnoughStock(currentSku, qty);
      const movement = await recordMovement({
        sku: currentSku,
        eventType: 'reserved',
        quantity: qty,
        availableDelta: -qty,
        allocations: reservedAllocations,
        sourceType,
        sourceId,
        idempotencyKey,
        reason,
        actorId,
      });
      if (movement?._alreadyRecorded) throw new ApiError(httpStatus.CONFLICT, 'This inventory reservation was already applied. Refresh the order and retry.');
      return { lotTracked: true, allocations: reservedAllocations };
    } catch (error) {
      for (const allocation of reservedAllocations) {
        await DairySkuInventoryLot.updateOne(
          { _id: allocation.lot },
          { $inc: { availableQty: allocation.quantity }, $set: { status: 'active' } }
        );
      }
      await DairySku.updateOne(
        { _id: currentSku._id, business: currentSku.business },
        { $inc: { availableQty: qty }, $set: { inStock: true } }
      );
      throw error;
    }
  }
  const sku = await getOwnedSku(skuId, businessId);
  throw notEnoughStock(sku, qty);
};

/** Restores a checkout/subscription reservation to its source lots. */
const releaseSkuStock = async ({ skuId, businessId, quantity, allocations = [], sourceType = 'manual', sourceId, actorId, reason = '' }) => {
  const idempotencyKey = sourceId ? `release:${sourceType}:${sourceId}:${skuId}` : undefined;
  if (idempotencyKey) {
    const priorMovement = await DairySkuInventoryMovement.findOne({ idempotencyKey });
    if (priorMovement) return Math.max(0, Number(priorMovement.availableDelta || 0));
  }
  if (!allocations || allocations.length === 0) {
    let sku = await getOwnedSku(skuId, businessId);
    if (sku.lotTrackingInitializing) {
      await ensureLotTracking(skuId, businessId);
      sku = await getOwnedSku(skuId, businessId);
    }
    let movementAllocations = [];
    if (sku.lotTrackingEnabled) {
      const openingLotNo = `${OPENING_LOT_PREFIX}${sku._id}`;
      try {
        await DairySkuInventoryLot.updateOne(
          { sku: sku._id, lotNo: openingLotNo },
          {
            $inc: { receivedQty: quantity, availableQty: quantity },
            $set: { status: 'active' },
            $setOnInsert: {
              business: sku.business,
              sku: sku._id,
              lotNo: openingLotNo,
              receivedAt: new Date(),
              expiry: null,
              expiredQty: 0,
              notes: 'Legacy stock returned without a historical lot allocation; expiry is unknown.',
            },
          },
          { upsert: true }
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
        await DairySkuInventoryLot.updateOne(
          { sku: sku._id, lotNo: openingLotNo },
          { $inc: { receivedQty: quantity, availableQty: quantity }, $set: { status: 'active' } }
        );
      }
      const openingLot = await DairySkuInventoryLot.findOne({ sku: sku._id, lotNo: openingLotNo }).select('_id lotNo');
      if (openingLot) movementAllocations = [{ lot: openingLot._id, lotNo: openingLot.lotNo, quantity }];
    }
    await DairySku.updateOne({ _id: skuId, business: businessId }, { $inc: { availableQty: quantity }, $set: { inStock: true } });
    if (sku.lotTrackingEnabled && movementAllocations.length) {
      await recordMovement({
        sku,
        eventType: 'released',
        quantity,
        availableDelta: quantity,
        allocations: movementAllocations,
        sourceType,
        sourceId,
        idempotencyKey,
        reason,
        actorId,
      });
    }
    return quantity;
  }

  let sellableQty = 0;
  let heldQty = 0;
  let expiredQty = 0;
  const now = new Date();
  const restoredAllocations = [];
  for (const allocation of allocations) {
    const lot = await DairySkuInventoryLot.findOne({
      _id: allocation.lot,
      sku: skuId,
      business: businessId,
    });
    if (!lot) throw new ApiError(httpStatus.CONFLICT, `Inventory lot ${allocation.lotNo || allocation.lot} is missing; stock needs reconciliation.`);
    const expired = lot.expiry && new Date(lot.expiry) <= now;
    if (['held', 'recalled'].includes(lot.status)) {
      lot.heldQty = Number(lot.heldQty || 0) + Number(allocation.quantity);
      heldQty += Number(allocation.quantity);
    } else if (expired) {
      lot.expiredQty += Number(allocation.quantity);
      lot.status = 'expired';
      expiredQty += Number(allocation.quantity);
    } else {
      lot.availableQty += Number(allocation.quantity);
      lot.status = 'active';
    }
    await lot.save();
    restoredAllocations.push({ lot: lot._id, lotNo: lot.lotNo, quantity: Number(allocation.quantity) });
    if (!['held', 'recalled'].includes(lot.status) && !expired) sellableQty += Number(allocation.quantity);
  }
  if (sellableQty > 0) {
    await DairySku.updateOne({ _id: skuId, business: businessId }, { $inc: { availableQty: sellableQty }, $set: { inStock: true } });
  }
  const sku = await getOwnedSku(skuId, businessId);
  await recordMovement({
    sku,
    eventType: 'released',
    quantity: Number(quantity),
    availableDelta: sellableQty,
    heldDelta: heldQty,
    expiredDelta: expiredQty,
    allocations: restoredAllocations,
    sourceType,
    sourceId,
    idempotencyKey,
    reason,
    actorId,
  });
  return sellableQty;
};

const receiveLot = async (skuId, businessId, param, actorId) => {
  const sku = await getOwnedSku(skuId, businessId);
  await ensureLotTracking(sku._id, sku.business);
  const receivedAt = param.receivedAt ? new Date(param.receivedAt) : new Date();
  const expiry = new Date(param.expiry);
  // The PartnerApp captures a calendar date, not a clock time. Treat it as
  // usable through the end of that calendar day in UTC.
  expiry.setUTCHours(23, 59, 59, 999);
  if (expiry <= new Date()) throw new ApiError(httpStatus.BAD_REQUEST, 'Expiry date must be in the future.');

  let lot;
  try {
    lot = await DairySkuInventoryLot.create({
      business: sku.business,
      sku: sku._id,
      lotNo: param.lotNo,
      receivedQty: param.quantity,
      availableQty: 0,
      receivedAt,
      expiry,
      status: 'receiving',
      notes: param.notes,
      createdBy: actorId,
    });
  } catch (error) {
    if (error.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'That batch number already exists for this product.');
    throw error;
  }

  let skuIncremented = false;
  try {
    const result = await DairySku.updateOne(
      { _id: sku._id, business: sku.business, lotTrackingEnabled: true, lotTrackingInitializing: { $ne: true } },
      { $inc: { availableQty: param.quantity }, $set: { inStock: true } }
    );
    if (result.modifiedCount !== 1) throw new ApiError(httpStatus.CONFLICT, 'Product inventory changed. Refresh and retry the batch receipt.');
    skuIncremented = true;
    const activated = await DairySkuInventoryLot.updateOne(
      { _id: lot._id, status: 'receiving' },
      { $set: { availableQty: param.quantity, status: 'active' } }
    );
    if (activated.modifiedCount !== 1) throw new ApiError(httpStatus.CONFLICT, 'The received batch could not be activated. Please retry.');
    await recordMovement({
      sku,
      eventType: 'received',
      quantity: param.quantity,
      availableDelta: param.quantity,
      allocations: [{ lot: lot._id, lotNo: lot.lotNo, quantity: param.quantity }],
      sourceType: 'manual',
      sourceId: lot._id,
      idempotencyKey: `receive:${lot._id}`,
      note: param.notes || '',
      actorId,
    });
  } catch (error) {
    if (skuIncremented) {
      await DairySku.updateOne({ _id: sku._id }, { $inc: { availableQty: -param.quantity } });
    }
    await DairySkuInventoryLot.deleteOne({ _id: lot._id, status: { $in: ['receiving', 'active'] }, availableQty: { $gte: param.quantity } });
    throw error;
  }
  return DairySkuInventoryLot.findById(lot._id);
};

const listLots = async (skuId, businessId) => {
  let sku = await getOwnedSku(skuId, businessId);
  if (sku.batchTracked) return { lots: [], lotTrackingEnabled: false, batchTracked: true };
  await ensureLotTracking(sku._id, sku.business);
  await expireLotsForSku(sku._id, sku.business);
  sku = await getOwnedSku(skuId, businessId);
  const lots = sortFefo(await DairySkuInventoryLot.find({ business: sku.business, sku: sku._id })
    .sort({ receivedAt: -1 })
    .lean());
  return { lots, lotTrackingEnabled: true };
};

const expireLotsForSku = async (skuId, businessId) => {
  const now = new Date();
  const expiredLots = await DairySkuInventoryLot.find({
    sku: skuId,
    business: businessId,
    status: 'active',
    expiry: { $ne: null, $lte: now },
    availableQty: { $gt: 0 },
  }).lean();
  for (const lot of expiredLots) {
    const qty = Number(lot.availableQty);
    const skuUpdate = await DairySku.updateOne(
      { _id: skuId, business: businessId, lotTrackingEnabled: true, availableQty: { $gte: qty } },
      { $inc: { availableQty: -qty } }
    );
    if (skuUpdate.modifiedCount !== 1) continue;
    const lotUpdate = await DairySkuInventoryLot.updateOne(
      { _id: lot._id, status: 'active', expiry: { $ne: null, $lte: now }, availableQty: qty },
      { $set: { availableQty: 0, status: 'expired' }, $inc: { expiredQty: qty } }
    );
    if (lotUpdate.modifiedCount !== 1) {
      await DairySku.updateOne({ _id: skuId, business: businessId }, { $inc: { availableQty: qty }, $set: { inStock: true } });
      continue;
    }
    try {
      const sku = await getOwnedSku(skuId, businessId);
      await recordMovement({
        sku,
        eventType: 'expired',
        quantity: qty,
        availableDelta: -qty,
        expiredDelta: qty,
        allocations: [{ lot: lot._id, lotNo: lot.lotNo, quantity: qty }],
        sourceType: 'system',
        sourceId: lot._id,
        idempotencyKey: `expire:${lot._id}:${new Date(lot.expiry).toISOString()}`,
        reason: 'Batch expiry date passed.',
      });
    } catch (error) {
      await DairySkuInventoryLot.updateOne(
        { _id: lot._id, status: 'expired', expiredQty: { $gte: qty } },
        { $inc: { availableQty: qty, expiredQty: -qty }, $set: { status: 'active' } }
      );
      await DairySku.updateOne({ _id: skuId, business: businessId }, { $inc: { availableQty: qty }, $set: { inStock: true } });
      throw error;
    }
    await DairySku.updateOne({ _id: skuId, availableQty: { $lte: 0 } }, { $set: { inStock: false } });
  }
};

const expireLotsForBusiness = async (businessId) => {
  const skuIds = await DairySkuInventoryLot.distinct('sku', {
    business: businessId,
    status: 'active',
    expiry: { $ne: null, $lte: new Date() },
    availableQty: { $gt: 0 },
  });
  for (const skuId of skuIds) await expireLotsForSku(skuId, businessId);
};

const writeOffLot = async (skuId, businessId, lotId, { quantity, bucket = 'available', reason, note = '' }, actorId) => {
  const sku = await getOwnedSku(skuId, businessId);
  await ensureLotTracking(skuId, businessId);
  const lot = await DairySkuInventoryLot.findOne({ _id: lotId, sku: skuId, business: businessId });
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Inventory lot not found');
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Write-off quantity must be a positive whole number.');
  if (!String(reason || '').trim()) throw new ApiError(httpStatus.BAD_REQUEST, 'A write-off reason is required.');

  if (bucket === 'available' && lot.expiry && new Date(lot.expiry) <= new Date()) {
    await expireLotsForSku(skuId, businessId);
    throw new ApiError(httpStatus.CONFLICT, 'This batch has expired. Refresh and write it off from expired stock.');
  }
  const field = bucket === 'available' ? 'availableQty' : bucket === 'held' ? 'heldQty' : 'expiredQty';
  const current = Number(lot[field] || 0);
  if (qty > current) throw new ApiError(httpStatus.BAD_REQUEST, `Write-off quantity exceeds this batch's ${bucket} quantity (${current}).`);
  if (bucket === 'available' && lot.status !== 'active') throw new ApiError(httpStatus.CONFLICT, 'Only active batch stock can be written off from available inventory.');
  if (bucket === 'held' && !['held', 'recalled'].includes(lot.status)) throw new ApiError(httpStatus.CONFLICT, 'This batch has no held stock.');
  if (bucket === 'expired' && lot.status !== 'expired') throw new ApiError(httpStatus.CONFLICT, 'This batch has no expired stock.');

  const increments = { writtenOffQty: qty, [field]: -qty };
  const nextQty = current - qty;
  let nextStatus = lot.status;
  if (bucket === 'available' && nextQty === 0) nextStatus = 'depleted';
  if (bucket === 'expired' && nextQty === 0) nextStatus = lot.heldQty > 0 ? 'held' : 'written_off';
  if (bucket === 'held' && nextQty === 0) nextStatus = Number(lot.expiredQty || 0) > 0 ? 'expired' : 'written_off';
  const result = await DairySkuInventoryLot.updateOne(
    { _id: lot._id, [field]: { $gte: qty }, status: lot.status },
    { $inc: increments, $set: { status: nextStatus } }
  );
  if (result.modifiedCount !== 1) throw new ApiError(httpStatus.CONFLICT, 'Batch inventory changed. Refresh and try again.');
  if (bucket === 'available') {
    const stockChange = await DairySku.updateOne(
      { _id: skuId, business: businessId, availableQty: { $gte: qty } },
      { $inc: { availableQty: -qty } }
    );
    if (stockChange.modifiedCount !== 1) {
      await DairySkuInventoryLot.updateOne({ _id: lot._id }, { $inc: { availableQty: qty, writtenOffQty: -qty }, $set: { status: lot.status } });
      throw new ApiError(httpStatus.CONFLICT, 'Product inventory changed. Refresh and try again.');
    }
    await DairySku.updateOne({ _id: skuId, availableQty: { $lte: 0 } }, { $set: { inStock: false } });
  }
  const delta = bucket === 'available' ? { availableDelta: -qty } : bucket === 'held' ? { heldDelta: -qty } : { expiredDelta: -qty };
  try {
    await recordMovement({
      sku,
      eventType: 'write_off',
      quantity: qty,
      ...delta,
      writtenOffDelta: qty,
      allocations: [{ lot: lot._id, lotNo: lot.lotNo, quantity: qty }],
      sourceType: 'manual',
      sourceId: lot._id,
      idempotencyKey: `writeoff:${lot._id}:${new mongoose.Types.ObjectId()}`,
      reason: String(reason).trim(),
      note: String(note || '').trim(),
      actorId,
    });
  } catch (error) {
    await DairySkuInventoryLot.updateOne({ _id: lot._id }, { $inc: { [field]: qty, writtenOffQty: -qty }, $set: { status: lot.status } });
    if (bucket === 'available') await DairySku.updateOne({ _id: skuId, business: businessId }, { $inc: { availableQty: qty }, $set: { inStock: true } });
    throw error;
  }
  return DairySkuInventoryLot.findById(lot._id);
};

const setLotDisposition = async (skuId, businessId, lotId, { action, reason }, actorId) => {
  const sku = await getOwnedSku(skuId, businessId);
  await ensureLotTracking(skuId, businessId);
  await expireLotsForSku(skuId, businessId);
  const lot = await DairySkuInventoryLot.findOne({ _id: lotId, sku: skuId, business: businessId });
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Inventory lot not found');
  const note = String(reason || '').trim();
  if (!note) throw new ApiError(httpStatus.BAD_REQUEST, 'A hold or recall reason is required.');
  const available = Number(lot.availableQty || 0);
  const held = Number(lot.heldQty || 0);
  const expired = lot.expiry && new Date(lot.expiry) <= new Date();

  if (action === 'hold' || action === 'recall') {
    if (action === 'hold' && (lot.status !== 'active' || available <= 0)) {
      throw new ApiError(httpStatus.CONFLICT, 'Only active batches with available stock can be placed on hold.');
    }
    if (action === 'recall' && !['active', 'depleted', 'held'].includes(lot.status)) {
      throw new ApiError(httpStatus.CONFLICT, 'Only active or held batches can be recalled.');
    }
    if (action === 'recall' && lot.status === 'held' && held === 0) {
      throw new ApiError(httpStatus.CONFLICT, 'This batch has no held stock to recall.');
    }
    const result = await DairySkuInventoryLot.updateOne(
      { _id: lot._id, status: lot.status, availableQty: available, heldQty: held },
      {
        $inc: { availableQty: -available, heldQty: available },
        $set: {
          status: action === 'recall' ? 'recalled' : 'held',
          dispositionReason: note,
          dispositionAt: new Date(),
          dispositionBy: actorId,
        },
      }
    );
    if (result.modifiedCount !== 1) throw new ApiError(httpStatus.CONFLICT, 'Batch inventory changed. Refresh and try again.');
    if (available > 0) {
      const stock = await DairySku.updateOne({ _id: skuId, business: businessId, availableQty: { $gte: available } }, { $inc: { availableQty: -available } });
      if (stock.modifiedCount !== 1) {
        await DairySkuInventoryLot.updateOne({ _id: lot._id }, { $inc: { availableQty: available, heldQty: -available }, $set: { status: lot.status } });
        throw new ApiError(httpStatus.CONFLICT, 'Product inventory changed. Refresh and try again.');
      }
      await DairySku.updateOne({ _id: skuId, availableQty: { $lte: 0 } }, { $set: { inStock: false } });
    }
    try {
      await recordMovement({
        sku,
        eventType: action === 'recall' ? 'recalled' : 'held',
        quantity: available,
        availableDelta: -available,
        heldDelta: available,
        allocations: [{ lot: lot._id, lotNo: lot.lotNo, quantity: available }],
        reason: note,
        actorId,
      });
    } catch (error) {
      await DairySkuInventoryLot.updateOne(
        { _id: lot._id },
        { $inc: { availableQty: available, heldQty: -available }, $set: { status: lot.status, dispositionReason: lot.dispositionReason || '' } }
      );
      if (available > 0) await DairySku.updateOne({ _id: skuId, business: businessId }, { $inc: { availableQty: available }, $set: { inStock: true } });
      throw error;
    }
    return DairySkuInventoryLot.findById(lot._id);
  }

  if (action !== 'release') throw new ApiError(httpStatus.BAD_REQUEST, 'Choose hold, release, or recall.');
  if (lot.status === 'recalled') throw new ApiError(httpStatus.CONFLICT, 'A recalled batch cannot be released for sale. Write it off after the recall is resolved.');
  if (lot.status !== 'held' || held <= 0) throw new ApiError(httpStatus.CONFLICT, 'This batch is not on hold.');
  const releasedToExpired = Boolean(expired);
  const result = await DairySkuInventoryLot.updateOne(
    { _id: lot._id, status: 'held', heldQty: held },
    {
      $inc: releasedToExpired ? { heldQty: -held, expiredQty: held } : { heldQty: -held, availableQty: held },
      $set: { status: releasedToExpired ? 'expired' : 'active', dispositionReason: '', dispositionAt: new Date(), dispositionBy: actorId },
    }
  );
  if (result.modifiedCount !== 1) throw new ApiError(httpStatus.CONFLICT, 'Batch inventory changed. Refresh and try again.');
  if (!releasedToExpired) await DairySku.updateOne({ _id: skuId, business: businessId }, { $inc: { availableQty: held }, $set: { inStock: true } });
  try {
    await recordMovement({
      sku,
      eventType: 'hold_released',
      quantity: held,
      availableDelta: releasedToExpired ? 0 : held,
      heldDelta: -held,
      expiredDelta: releasedToExpired ? held : 0,
      allocations: [{ lot: lot._id, lotNo: lot.lotNo, quantity: held }],
      reason: note,
      actorId,
    });
  } catch (error) {
    await DairySkuInventoryLot.updateOne(
      { _id: lot._id },
      releasedToExpired
        ? { $inc: { heldQty: held, expiredQty: -held }, $set: { status: 'held' } }
        : { $inc: { heldQty: held, availableQty: -held }, $set: { status: 'held' } }
    );
    if (!releasedToExpired) await DairySku.updateOne({ _id: skuId, business: businessId, availableQty: { $gte: held } }, { $inc: { availableQty: -held }, $set: { inStock: held < sku.availableQty } });
    throw error;
  }
  return DairySkuInventoryLot.findById(lot._id);
};

const listInventoryMovements = async ({ businessId, skuId, lotId, eventType, from, to, page = 1, limit = 50 }) => {
  const paging = { page: Math.max(1, Number(page) || 1), limit: Math.min(100, Math.max(1, Number(limit) || 50)) };
  const filter = { business: businessId };
  if (skuId) filter.sku = skuId;
  if (lotId) filter['allocations.lot'] = lotId;
  if (eventType) filter.eventType = eventType;
  if (from || to) filter.occurredAt = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lt: new Date(to) } : {}) };
  const [movements, totalResults] = await Promise.all([
    DairySkuInventoryMovement.find(filter).populate('sku', 'name').sort({ occurredAt: -1 })
      .skip((paging.page - 1) * paging.limit).limit(paging.limit),
    DairySkuInventoryMovement.countDocuments(filter),
  ]);
  return { movements, totalResults, ...paging };
};

const getInventoryReport = async ({ businessId, from, to } = {}) => {
  const packagedSkus = await DairySku.find({ business: businessId, batchTracked: { $ne: true } }).select('_id');
  for (const sku of packagedSkus) await ensureLotTracking(sku._id, businessId);
  await expireLotsForBusiness(businessId);
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a valid inventory report date range');
  }
  if (end - start > 366 * 24 * 60 * 60 * 1000) throw new ApiError(httpStatus.BAD_REQUEST, 'Inventory reports can cover at most 366 days');
  const [skus, lots, movementTotals, ledgerBalances] = await Promise.all([
    DairySku.find({ business: businessId }).select('_id name availableQty lotTrackingEnabled inStock stockAlertThreshold').lean(),
    DairySkuInventoryLot.find({ business: businessId }).select('_id sku lotNo status expiry availableQty heldQty expiredQty writtenOffQty').lean(),
    DairySkuInventoryMovement.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(businessId)), occurredAt: { $gte: start, $lt: end } } },
      { $group: {
        _id: '$eventType',
        events: { $sum: 1 },
        quantity: { $sum: '$quantity' },
        availableDelta: { $sum: '$availableDelta' },
        heldDelta: { $sum: '$heldDelta' },
        expiredDelta: { $sum: '$expiredDelta' },
        writtenOffDelta: { $sum: '$writtenOffDelta' },
      } },
      { $sort: { _id: 1 } },
    ]),
    DairySkuInventoryMovement.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(businessId)) } },
      { $group: {
        _id: '$sku',
        availableDelta: { $sum: '$availableDelta' },
        heldDelta: { $sum: '$heldDelta' },
        expiredDelta: { $sum: '$expiredDelta' },
        writtenOffDelta: { $sum: '$writtenOffDelta' },
      } },
    ]),
  ]);
  const skuMap = new Map(skus.map((sku) => [String(sku._id), sku]));
  const ledgerMap = new Map(ledgerBalances.map((row) => [String(row._id), row]));
  const lotRows = lots.map((lot) => ({ ...lot, skuName: skuMap.get(String(lot.sku))?.name || 'Product' }));
  const rows = skus.map((sku) => {
    const skuLots = lotRows.filter((lot) => String(lot.sku) === String(sku._id));
    const lotAvailableQty = skuLots.reduce((sum, lot) => sum + Number(lot.availableQty || 0), 0);
    const ledger = ledgerMap.get(String(sku._id));
    const ledgerAvailableQty = sku.lotTrackingEnabled ? Number(ledger?.availableDelta || 0) : null;
    return {
      sku: sku._id,
      name: sku.name,
      lotTrackingEnabled: sku.lotTrackingEnabled === true,
      skuAvailableQty: Number(sku.availableQty || 0),
      lotAvailableQty: sku.lotTrackingEnabled ? lotAvailableQty : null,
      ledgerAvailableQty,
      heldQty: skuLots.reduce((sum, lot) => sum + Number(lot.heldQty || 0), 0),
      expiredQty: skuLots.reduce((sum, lot) => sum + Number(lot.expiredQty || 0), 0),
      writtenOffQty: skuLots.reduce((sum, lot) => sum + Number(lot.writtenOffQty || 0), 0),
      discrepancy: sku.lotTrackingEnabled ? Number(sku.availableQty || 0) - lotAvailableQty : 0,
      ledgerDiscrepancy: sku.lotTrackingEnabled ? Number(sku.availableQty || 0) - ledgerAvailableQty : 0,
      lowStock: Number(sku.availableQty || 0) <= Number(sku.stockAlertThreshold || 0),
    };
  });
  const expiryCutoff = new Date();
  expiryCutoff.setDate(expiryCutoff.getDate() + 30);
  const expiring = lotRows.filter((lot) => lot.status === 'active' && Number(lot.availableQty || 0) > 0 && lot.expiry && new Date(lot.expiry) <= expiryCutoff)
    .sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
  return {
    generatedAt: new Date(),
    period: { from: start, to: end },
    summary: {
      skuCount: rows.length,
      skuAvailableQty: rows.reduce((sum, row) => sum + row.skuAvailableQty, 0),
      lotAvailableQty: rows.reduce((sum, row) => sum + Number(row.lotAvailableQty || 0), 0),
      heldQty: rows.reduce((sum, row) => sum + row.heldQty, 0),
      expiredQty: rows.reduce((sum, row) => sum + row.expiredQty, 0),
      writtenOffQty: rows.reduce((sum, row) => sum + row.writtenOffQty, 0),
      discrepancyCount: rows.filter((row) => row.discrepancy !== 0 || row.ledgerDiscrepancy !== 0).length,
      lowStockCount: rows.filter((row) => row.lowStock).length,
      expiringLotCount: expiring.length,
    },
    rows,
    expiring,
    movementTotals: movementTotals.map((row) => ({
      eventType: row._id,
      events: row.events,
      quantity: row.quantity,
      availableDelta: row.availableDelta,
      heldDelta: row.heldDelta,
      expiredDelta: row.expiredDelta,
      writtenOffDelta: row.writtenOffDelta,
    })),
  };
};

const adjustStock = async (skuId, businessId, delta) => {
  const sku = await getOwnedSku(skuId, businessId);
  if (delta === 0) return sku;
  if (sku.batchTracked) throw new ApiError(httpStatus.CONFLICT, 'Raw-milk stock is managed through Dairy milk batches.');
  if (delta > 0) throw new ApiError(httpStatus.CONFLICT, 'Receive stock as a batch with its lot number and expiry date.');
  await ensureLotTracking(skuId, businessId);
  throw new ApiError(httpStatus.CONFLICT, 'Select a specific batch and record a reason when writing off stock.');
};

module.exports = {
  ensureLotTracking,
  reserveSkuStock,
  releaseSkuStock,
  receiveLot,
  listLots,
  adjustStock,
  expireLotsForBusiness,
  writeOffLot,
  setLotDisposition,
  listInventoryMovements,
  getInventoryReport,
};
