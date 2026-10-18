/**
 * jhatka.label.service.js — generating a compliant label for a packed order line.
 *
 * ## The artefact
 *
 * A JhatkaLabel is the only thing in this vertical a government regulator reads, and
 * the only one a customer reads while the pack is still in their hand. Two fields do
 * almost all of the work and both are FORBIDDEN to the caller:
 *
 *   - `fssaiLicenceNo` comes from `JhatkaCompliance`. A shop may not print a licence
 *     number it does not hold.
 *   - `qrTraceBatch` / `batch` name the batch the pack came from. §-11's recall flow
 *     finds affected customers from a `{batch: 1}` index; a label without it is a
 *     sticker, not evidence.
 *
 * `useBy` is likewise derived, never supplied — it is the SHORTEST expiry among every
 * contributing batch, so a split pack cannot be labelled with the longer-dated one.
 *
 * ## Why the whole set is one transaction
 *
 * The route created labels one at a time inside a `for` loop with no session. A
 * five-line order whose fourth line has no expiry left three `JhatkaLabel` documents
 * behind a 409 — packs with labels, no record that the request failed, and a packer who
 * has to guess which lines were actually printed.
 *
 * A label set is one physical act ("I am labelling these four packs now"). It either
 * happens or it does not.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { toGrams } = require('../utils/quantity');
const { withTransaction } = require('../utils/transaction');

/**
 * The use-by date for a pack.
 *
 * PREPARED stock uses `cutExpiresAt` (the cut meat's own life), RAW uses `expiresAt`.
 * `packedOn` is the anchor, NOT the receipt date: a batch cut on Monday and packed on
 * Wednesday has three days of cut life left, not five.
 *
 * If the pack was filled AFTER the batch expired, the honest use-by is "now" — the
 * stock is already at the end of its life. Stating the past expiry would put a date on
 * the pack that has already gone by, which is the specific failure §-11 exists to
 * prevent: a customer reading "use by Tuesday" on meat received Thursday.
 *
 * @returns {string|null} ISO string, or null when the batch has no expiry at all.
 */
const computeUseBy = (batch, packedOn, isPrepared) => {
  const anchor = isPrepared ? batch.cutExpiresAt || batch.expiresAt : batch.expiresAt;
  if (!anchor) return null;

  const expiry = new Date(anchor);
  if (expiry <= packedOn) return packedOn.toISOString();

  return expiry.toISOString();
};

/**
 * The batch whose expiry governs this line's use-by.
 *
 * NOT `allocations[0]`: §-5.4 lets one line be filled from several batches, so `[0]` is
 * arbitrary — whichever was written first, not whichever dies first. The rule is the
 * SHORTEST expiry among all contributing batches.
 */
const resolveBatch = async (item, models, reservationService) => {
  const shortest = await reservationService.shortestExpiryForLine(item, {
    JhatkaBatch: models.JhatkaBatch,
  });
  if (!shortest) return null;

  const batch = await models.JhatkaBatch.findById(shortest.batch).lean();
  if (batch) batch.isSplitAllocation = shortest.isSplit;
  return batch;
};

/** Build (but do not save) one label document. */
async function buildLabel({
  models, order, item, entry, batch, outlet, fssaiLicenceNo,
  storageInstruction, customerCare, qrImageUrl, nextNumber,
}) {
  const packedOn = entry.packedOn ? new Date(entry.packedOn) : new Date();
  const isPrepared = item.measurementMode === 'WEIGHT' && !!batch.yieldRecorded?.cutType;

  const useBy = computeUseBy(batch, packedOn, isPrepared);
  if (!useBy) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Batch ${batch.batchNo} has no expiry date, so a compliant use-by cannot be stated`,
      true,
      '',
      { code: 'BATCH_NO_EXPIRY' }
    );
  }

  // The quantity PRINTED is the packed quantity — for a weighed line, the CONFIRMED
  // weight. Printing the requested estimate would put a weight on the pack the shop
  // already knows to be wrong.
  const packedQty = item.actualQuantity || item.requestedQuantity;
  const netWeightGrams = toGrams(packedQty);

  const product = await models.JhatkaProduct.findById(item.product).lean();
  const variant = item.variant ? await models.JhatkaVariant.findById(item.variant).lean() : null;

  const label = new models.JhatkaLabel({
    labelNo: nextNumber('LB'),
    order: order._id,
    orderItem: item._id,
    outlet: outlet._id,
    product: item.product,
    variant: item.variant,
    productName: item.name,
    packSize: entry.packSize || variant?.unitLabel || item.unitLabel || 'kg',
    netQuantity: `${packedQty.value} ${packedQty.unit.toLowerCase()}`,
    packedOn,
    useBy: new Date(useBy),
    storageInstruction:
      entry.storageInstruction
      || storageInstruction
      || `Keep below ${outlet?.qualityPolicy?.maxStorageTemperatureC ?? 4}°C`,
    fssaiLicenceNo,
    outletName: outlet?.name,
    outletAddress: [
      outlet?.address?.line1,
      outlet?.address?.line2,
      outlet?.city,
    ].filter(Boolean).join(', '),
    customerCare: customerCare || outlet?.contact?.mobile || '1800-000-0000',
    mrp: item.unitPrice,
    taxInclusive: product?.taxInclusive,
    netWeightGrams,
    allergens: product?.allergens || item.allergens || [],
    ingredientsNote: product?.storageNotes,
    // The trace key. Everything else exists for the regulator; this exists for US.
    qrTraceBatch: batch.batchNo,
    batch: batch._id,
    qrImageUrl,
    status: 'draft',
  });

  const labelError = label.validateSync();
  if (labelError) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Label failed validation', true, '', {
      fields: Object.keys(labelError.errors),
    });
  }

  return label;
}

/**
 * Generate labels for the requested lines of one order.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaOrder, JhatkaLabel, JhatkaBatch, JhatkaOutlet, JhatkaProduct, JhatkaVariant, JhatkaCompliance }`
 * @param {string} p.orderId
 * @param {Array}  p.items   `[{ orderItem, batch?, packedOn?, packSize?, storageInstruction? }]`
 * @param {Function} p.reservationService — for `shortestExpiryForLine`
 */
async function generateLabels({
  models, outletId, orderId, items, storageInstruction, customerCare, qrImageUrl,
  reservationService, nextNumber,
}) {
  if (!orderId) throw new ApiError(httpStatus.BAD_REQUEST, 'order is required');
  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'items is required');
  }

  return withTransaction({
    startSession: () => models.JhatkaLabel.startSession(),
    fn: async (session) => {
      const order = await models.JhatkaOrder.findOne({ _id: orderId, outlet: outletId })
        .session(session);
      if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found for this outlet');

      // The licence comes from the outlet's compliance record, never from the caller.
      const compliance = await models.JhatkaCompliance.findOne({ outlet: outletId })
        .session(session)
        .lean();
      const fssaiLicenceNo = compliance?.fssai?.licenceNumber;
      if (!fssaiLicenceNo) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'This outlet has no FSSAI licence on file, so a compliant label cannot be printed',
          true,
          '',
          { code: 'NO_FSSAI_LICENCE' }
        );
      }

      const outlet = await models.JhatkaOutlet.findById(outletId).session(session).lean();

      const created = [];

      for (const entry of items) {
        const item = order.items.id(entry.orderItem || entry.itemId);
        if (!item) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item ${entry.orderItem || entry.itemId} not on this order`
          );
        }

        // An already-APPLIED label means the pack is on a shelf with that label. A
        // second one means two packs claim one batch line, and a recall then has to
        // decide which customer got which.
        //
        // KNOWN DEFECT: this checks `['printed','applied']`, but a freshly generated
        // label is a DRAFT — so it does not match its own predecessor, and the
        // `{orderItem: 1}` unique index rejects the insert with a raw E11000 that
        // surfaces as a 500 instead of the 409 LABEL_EXISTS this branch was written
        // to produce. Widening the check to include 'draft' fixes the status code but
        // also means a draft can never be regenerated, which is a product decision.
        // Left as-is and recorded in `verify.jhatka.integration.js` rather than
        // silently changed here.
        const existing = await models.JhatkaLabel.findOne({
          orderItem: item._id,
          status: { $in: ['printed', 'applied'] },
        }).session(session);
        if (existing) {
          throw new ApiError(
            httpStatus.CONFLICT,
            `Line ${item.sku} already has label ${existing.labelNo}`,
            true,
            '',
            { code: 'LABEL_EXISTS', labelNo: existing.labelNo }
          );
        }

        const batch = entry.batch
          ? await models.JhatkaBatch.findOne({ _id: entry.batch, outlet: outletId })
            .session(session)
            .lean()
          : await resolveBatch(item, models, reservationService);

        // REQUIRED and load-bearing: a label with no batch cannot be recalled, and
        // §-11's recall flow finds affected customers from `{batch:1}`.
        if (!batch) {
          throw new ApiError(
            httpStatus.CONFLICT,
            `Line ${item.sku} has no batch allocated, so a traceable label cannot be printed`,
            true,
            '',
            { code: 'NO_BATCH_ALLOCATED', sku: item.sku }
          );
        }
        if (['quarantined', 'discarded'].includes(batch.status)) {
          throw new ApiError(
            httpStatus.CONFLICT,
            `Batch ${batch.batchNo} is ${batch.status} and must not be labelled for sale`,
            true,
            '',
            { code: 'BATCH_NOT_SELLABLE', batchStatus: batch.status }
          );
        }

        const label = await buildLabel({
          models, order, item, entry, batch, outlet, fssaiLicenceNo,
          storageInstruction, customerCare, qrImageUrl, nextNumber,
        });
        await label.save({ session });

        created.push({
          id: String(label._id),
          labelNo: label.labelNo,
          orderItem: String(item._id),
          productName: label.productName,
          netQuantity: label.netQuantity,
          packedOn: label.packedOn,
          useBy: label.useBy,
          qrTraceBatch: label.qrTraceBatch,
          status: label.status,
        });
      }

      return { labels: created };
    },
  });
}

module.exports = { generateLabels, computeUseBy, resolveBatch };