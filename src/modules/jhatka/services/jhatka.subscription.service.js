/**
 * jhatka.subscription.service.js — creating and amending a standing order.
 *
 * ## Shared by BOTH surfaces, deliberately
 *
 * A subscription can be created by the shop (the partner route) or by the customer
 * (the customer route). Before this existed the creation logic lived inline in the
 * partner route only, and adding the customer route would have meant copying ~130
 * lines — including the two places where money crosses the paise/rupee boundary.
 *
 * That is not a hypothetical risk. This file was extracted immediately after two 100x
 * bugs were fixed in that exact block:
 *
 *   - CREATION read the variant with `.lean()` (PAISE) and assigned into a
 *     `moneyField` (RUPEES) — Rs 400 stored as Rs 40,000.
 *   - OCCURRENCE GENERATION read a hydrated sub (RUPEES) and fed it to a
 *     paise-taking helper — Rs 440 charged as Rs 4.40.
 *
 * A second copy would have inherited the first and fixed neither.
 *
 * ## OD-07: the ceiling is the price
 *
 * A subscription line is charged at `unitPriceAtSubscribe` plus `subscriptionCeilingPct`,
 * ONCE, at creation. It is not repriced weekly. A standing order that reprices is a
 * variable bill wearing a subscription's name, and the customer has no way to predict
 * it — which is exactly what they subscribed to avoid.
 *
 * ## The egg rule
 *
 * Variants flagged `subscriptionEligible: false` are REFUSED AT CREATION with the
 * reason, not silently filtered. A customer shown a control that then does nothing has
 * been lied to, and the failure surfaces at the checkout they were told would work.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { linePricePaise, subscriptionCeilingPaise } = require('../utils/weight.arithmetic');
const { asMoney, toPaiseAmount } = require('../utils/money');
// Platform defaults sit BEHIND entry/variant values: with nothing saved the
// getters return the same literals the code used to carry inline, so behavior
// is identical until an admin saves the settings screen.
const jhatkaSettingsService = require('../../../services/jhatka.settings.service');

const SCHEDULE_TYPES = ['daily', 'alternate_days', 'weekly', 'custom_days'];

/**
 * Build (and persist) a subscription.
 *
 * @param {object} p
 * @param {object} p.body      request body
 * @param {string} p.customer  the subscription's customer
 * @param {object} p.outlet    lean `JhatkaOutlet`
 * @param {object} p.models    `{ JhatkaVariant, JhatkaProduct, JhatkaSubscription }`
 * @param {Function} p.nextNumber  id generator
 * @param {Function} p.dayKey   local-midnight normaliser
 * @param {Function} p.recordEvent  appends to the subscription's event trail
 * @param {object} p.actor     `{ _id, name, type }` — 'admin' or 'customer'
 * @returns {Promise<object>} the saved subscription
 */
async function createSubscription({
  body,
  customer,
  outlet,
  models,
  nextNumber,
  dayKey,
  recordEvent,
  actor,
}) {
  const { JhatkaVariant, JhatkaProduct, JhatkaSubscription } = models;
  const {
    items,
    scheduleType,
    intervalCount,
    customDays,
    startDate,
    endDate,
    deliverySlot,
    paymentMode,
    prepaid,
    priceMode,
    editCutoffHours,
    substitutionPolicy,
    stockFailurePolicy,
  } = body || {};

  if (!customer) throw new ApiError(httpStatus.BAD_REQUEST, 'customer is required');
  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'items is required');
  }
  if (!SCHEDULE_TYPES.includes(scheduleType)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `scheduleType must be one of ${SCHEDULE_TYPES.join(' | ')}`
    );
  }
  if (scheduleType === 'custom_days' && (!Array.isArray(customDays) || !customDays.length)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'custom_days requires customDays');
  }
  if (!startDate) throw new ApiError(httpStatus.BAD_REQUEST, 'startDate is required');

  const variantIds = items.map((i) => i.variant);
  const variants = await JhatkaVariant.find({ _id: variantIds }).lean();
  if (variants.length !== variantIds.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One or more variants are not found');
  }

  const products = await JhatkaProduct.find({ _id: { $in: variants.map((v) => v.product) } }).lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));

  // The egg rule (§9 note 1). Refused, not filtered.
  const notEligible = items
    .map((entry) => variants.find((v) => String(v._id) === String(entry.variant)))
    .filter((v) => v && v.subscriptionEligible === false)
    .map((v) => v.sku);

  if (notEligible.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `These items are not available on a subscription: ${notEligible.join(', ')}. Eggs and prawn tiers are sold as single purchases, not subscriptions.`,
      true,
      '',
      { code: 'NOT_SUBSCRIPTION_ELIGIBLE', skus: notEligible }
    );
  }

  // PAISE accumulator. Converted once, at the moneyField assignment below.
  let estimatedPaise = 0;

  const platformCeilingPct = await jhatkaSettingsService.getSubscriptionCeilingPct();

  const subItems = items.map((entry) => {
    const variant = variants.find((v) => String(v._id) === String(entry.variant));
    const product = productById.get(String(variant.product));
    if (!product) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Product for variant ${variant.sku} is missing`);
    }

    const qty = entry.requestedQuantity || entry.quantity;
    if (!qty || typeof qty.value !== 'number' || qty.value <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `items.${variant.sku}: requestedQuantity.value must be > 0`
      );
    }

    const chargeMode = entry.chargeMode || variant.subscriptionChargeMode || 'ceiling';
    const ceilingPct = Number(
      entry.subscriptionCeilingPct ?? variant.subscriptionCeilingPct ?? platformCeilingPct
    );

    // OD-07. `variant` is a LEAN read, so `pricePerUnit` is PAISE — which is exactly
    // what these helpers take. That is the correct direction for this call; the bug
    // was on the way OUT, assigning the result to a moneyField without converting.
    estimatedPaise +=
      chargeMode === 'ceiling'
        ? subscriptionCeilingPaise(qty, variant.pricePerUnit, variant.priceBasis, ceilingPct)
        : linePricePaise(qty, variant.pricePerUnit, variant.priceBasis);

    return {
      product: product._id,
      variant: variant._id,
      sku: variant.sku,
      name: product.name,
      nameSnapshot: product.name,
      requestedQuantity: qty,
      chargeMode,
      subscriptionCeilingPct: ceilingPct,
      // PAISE (lean) -> RUPEES (moneyField). The 100x-too-large defect.
      unitPriceAtSubscribe: asMoney(variant.pricePerUnit),
      yieldSpec: variant.yieldRef,
    };
  });

  const sub = new JhatkaSubscription({
    subscriptionNo: nextNumber('SB'),
    customer,
    outlet: outlet._id || outlet,
    business: outlet.business,
    items: subItems,
    scheduleType,
    intervalCount,
    customDays,
    startDate: new Date(startDate),
    endDate: endDate ? new Date(endDate) : undefined,
    nextOccurrenceDate: dayKey(startDate),
    deliverySlot,
    priceMode: priceMode || 'current_price',
    paymentMode: paymentMode || 'cod',
    prepaid: !!prepaid,
    // PAISE accumulator -> RUPEES moneyField. Same boundary, same reason.
    estimatedAmountPerOccurrence: asMoney(estimatedPaise),
    editCutoffHours: Number(editCutoffHours ?? (await jhatkaSettingsService.getEditCutoffHours())),
    substitutionPolicy: substitutionPolicy || 'notify_and_confirm',
    stockFailurePolicy: stockFailurePolicy || 'notify_and_skip',
    status: 'active',
    totals: { amountCollected: 0, amountRefunded: 0, amountCredited: 0, amountSkipped: 0 },
    stats: {
      occurrencesGenerated: 0,
      occurrencesDelivered: 0,
      occurrencesSkipped: 0,
      occurrencesShort: 0,
      consecutiveStockFailures: 0,
    },
  });

  const subError = sub.validateSync();
  if (subError) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Subscription failed validation', true, '', {
      fields: Object.keys(subError.errors),
    });
  }
  await sub.save();

  if (recordEvent) {
    await recordEvent(sub, {
      type: 'created',
      actorType: actor?.type || 'customer',
      actor: actor?._id,
      actorName: actor?.name,
      note: `Subscription created (${actor?.type === 'admin' ? 'at the outlet' : 'by the customer'})`,
    });
  }

  return sub;
}

/**
 * Recompute `estimatedAmountPerOccurrence` from a subscription's CURRENT lines.
 *
 * Called after a quantity or schedule change, because the OD-07 ceiling scales with
 * quantity — a customer doubling their order must not keep being quoted the price of
 * the old one.
 *
 * `sub` must be HYDRATED. Its items' `unitPriceAtSubscribe` getters therefore return
 * RUPEES, so each is converted to PAISE before the helpers. Assigning a paise result
 * into `estimatedAmountPerOccurrence` (a moneyField) then converts back. That round
 * trip is the whole contract, and getting either end wrong is a 100x error — which is
 * exactly what happened in this file before it was extracted.
 */
async function repriceSubscription(sub) {
  let estimatedPaise = 0;
  const platformCeilingPct = await jhatkaSettingsService.getSubscriptionCeilingPct();

  for (const line of sub.items || []) {
    const unitPricePaise = toPaiseAmount(line.unitPriceAtSubscribe);
    estimatedPaise +=
      line.chargeMode === 'ceiling'
        ? subscriptionCeilingPaise(
            line.requestedQuantity,
            unitPricePaise,
            line.priceBasis || 'per_kg',
            line.subscriptionCeilingPct ?? platformCeilingPct
          )
        : linePricePaise(line.requestedQuantity, unitPricePaise, line.priceBasis || 'per_kg');
  }

  sub.estimatedAmountPerOccurrence = asMoney(estimatedPaise);
  return sub;
}

/**
 * Pure extraction from POST /:subscription/items — no behavior changes.
 * Encapsulates the business logic formerly in the route handler.
 *
 * @param {object} sub     HYDRATED subscription document
 * @param {object} body    { items: [], reason: string }
 * @param {object} models  { JhatkaVariant }
 * @param {object} user    { _id, name } — actor for event recording
 * @param {Function} recordEvent  event recorder (same signature as route-level recordEvent)
 * @returns {Promise<object>} { subscription, previousItems, estimatedAmountPerOccurrence }
 */
async function updateSubscriptionItems({ sub, body, models, user, recordEvent }) {
  const { JhatkaVariant } = models;
  const { items, reason } = body || {};

  // Validate items and reason
  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'items is required');
  }
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required for an items change');

  const cutoffHours = sub.editCutoffHours ?? (await jhatkaSettingsService.getEditCutoffHours());
  const nextOccurrence = sub.nextOccurrenceDate
    ? new Date(sub.nextOccurrenceDate)
    : null;
  const hoursToOccurrence = nextOccurrence
    ? (nextOccurrence - Date.now()) / 3600000
    : null;
  const insideCutoff = hoursToOccurrence !== null && hoursToOccurrence < cutoffHours;
  if (insideCutoff) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `The next delivery is in ${Math.max(0, Math.round(hoursToOccurrence))}h and changes close ${cutoffHours}h before it. Skip this occurrence instead of editing it.`,
      true,
      '',
      { code: 'INSIDE_EDIT_CUTOFF', hoursToOccurrence, cutoffHours }
    );
  }

  const variantIds = items.map((i) => i.variant);
  const variants = await JhatkaVariant.find({ _id: variantIds }).lean();
  if (variants.length !== variantIds.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One or more variants are not found');
  }
  const notEligible = variants.filter((v) => v.subscriptionEligible === false);
  if (notEligible.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Not subscription-eligible: ${notEligible.map((v) => v.sku).join(', ')}`,
      true,
      '',
      { code: 'NOT_SUBSCRIPTION_ELIGIBLE' }
    );
  }

  const previous = sub.items;
  const platformCeilingPct = await jhatkaSettingsService.getSubscriptionCeilingPct();
  let estimated = 0;
  sub.items = items.map((entry) => {
    const variant = variants.find((v) => String(v._id) === String(entry.variant));
    const qty = entry.requestedQuantity || entry.quantity;
    const chargeMode = entry.chargeMode || variant.subscriptionChargeMode || 'ceiling';
    const ceilingPct = Number(entry.subscriptionCeilingPct ?? variant.subscriptionCeilingPct ?? platformCeilingPct);
    estimated +=
      chargeMode === 'ceiling'
        ? subscriptionCeilingPaise(qty, variant.pricePerUnit, variant.priceBasis, ceilingPct)
        : linePricePaise(qty, variant.pricePerUnit, variant.priceBasis);
    return {
      product: variant.product,
      variant: variant._id,
      sku: variant.sku,
      name: entry.name || variant.name,
      nameSnapshot: entry.name || variant.name,
      requestedQuantity: qty,
      chargeMode,
      subscriptionCeilingPct: ceilingPct,
      // lean read -> PAISE -> moneyField (RUPEES). See the note in POST '/'.
      unitPriceAtSubscribe: asMoney(variant.pricePerUnit),
    };
  });
  sub.estimatedAmountPerOccurrence = asMoney(estimated);
  await sub.save();

  await recordEvent(sub, {
    type: 'quantity_changed',
    actorType: 'admin',
    actor: user._id,
    actorName: user.name,
    reason,
    note: 'Standing items updated',
  });

  return {
    subscription: {
      id: String(sub._id),
      items: sub.items,
      estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
    },
    previousItems: previous,
  };
}

module.exports = { createSubscription, repriceSubscription, SCHEDULE_TYPES, updateSubscriptionItems };