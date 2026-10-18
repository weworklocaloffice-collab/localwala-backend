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
 * jhatka.order-creation.service.js — `POST /customer/orders`, minus Express.
 *
 * ## Why this was extracted
 *
 * This is the single most consequential write in the customer surface: it is where a
 * customer's money is committed, where tax is snapshotted, and where `estimatedTotal`
 * is frozen — the number BR-06 says can only ever fall.
 *
 * It lived entirely inside an Express handler for the whole life of the vertical,
 * which meant the only way to exercise it was to boot HTTP. Every money bug this
 * vertical has shipped (§3.5's paise/rupee inversion, the `estimatedTotal` that
 * omitted tax) was found by the integration suite precisely because there was no
 * cheaper way to test it. Here it can be called directly, with no `req`, no `res` and
 * no server.
 *
 * ## What is deliberately NOT here
 *
 * The line pricing. That is `jhatka.order-pricing.service.priceOrderLines`, which was
 * extracted earlier precisely because this module, the cart service and the
 * subscription service each had their own copy of "what does this basket cost" and
 * the three could disagree. This module CALLS it; it never re-derives a price.
 *
 * ## The two gates that must never move into the model
 *
 *   §12.2 compliance — an EXPIRED FSSAI licence blocks NEW orders here, and only
 *   here. §12.2 is explicit that this is a CALLER decision: encoding it in
 *   `JhatkaOutlet` would make compliance a trading policy, and an order already paid
 *   for would be caught by the same rule that stops a new one.
 *
 *   §12.4 granularity — the block is per OUTLET. Suspending the `jhatka` vertical
 *   because one counter's licence lapsed would take down every outlet in the country.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const orderPricing = require('./jhatka.order-pricing.service');
const { assertJhatkaOperational } = require('./jhatka.compliance-gate.service');
const { asMoney } = require('../utils/money');

/**
 * `JH` + yymmdd + 6 random digits. Human-readable, so a support ticket can be
 * resolved by eye (§6.5).
 *
 * Not unique by construction — it is a DISPLAY number. `orderNo` carries a unique
 * index, so a collision is rejected at the database rather than silently producing
 * two orders with the same customer-visible code.
 */
const buildOrderNo = () => {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  return `JH${stamp}${rand}`;
};

/**
 * Reject an order from an outlet that may not trade.
 *
 * Delegates to `jhatka.compliance-gate.service` — the single owner of §12.2 — and
 * returns the compliance record for the outlet snapshot. Keeping a local copy of
 * these two conditions here is how they drifted before: this function checked FSSAI
 * and outlet status, the gate checks those plus trade licence and suspension with
 * machine-readable codes, and two copies of "may this outlet sell" is how an outlet
 * ends up sellable by one path and blocked by another.
 *
 * @returns {Promise<object|null>} the compliance record, for the snapshot
 */
async function assertOutletMaySell(outlet, models, { now = new Date() } = {}) {
  await assertJhatkaOperational({ outlet, operation: 'place_order', models, now });
  return models.JhatkaCompliance
    ? models.JhatkaCompliance.findOne({ outlet: outlet._id }).lean()
    : null;
}

/**
 * Place an order.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaOutlet, JhatkaCompliance, JhatkaVariant, JhatkaProduct,
 *                             JhatkaPriceOverride, JhatkaOrder, JhatkaAddress }`
 * @param {string} p.customerId from the ACCESS TOKEN, never from the body. §0.0.
 * @param {object} p.body      `{ outlet, items, address, instructions, fulfilmentMode,
 *                               paymentMode, promisedDeliveryAt }`
 * @returns {Promise<{order: object, compliance: object|null}>} the persisted order
 */
async function placeOrder({ models, customerId, body }) {
  const {
    JhatkaOutlet, JhatkaVariant, JhatkaProduct,
    JhatkaPriceOverride, JhatkaOrder, JhatkaAddress,
  } = models;

  const {
    outlet: outletId,
    items,
    address: addressId,
    instructions,
    fulfilmentMode = 'delivery',
    paymentMode = 'cod',
    promisedDeliveryAt,
  } = body || {};

  // ---- input shape -------------------------------------------------------
  if (!outletId) throw new ApiError(httpStatus.BAD_REQUEST, 'outlet is required');
  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'items is required');
  }
  if (!['delivery', 'pickup'].includes(fulfilmentMode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "fulfilmentMode must be 'delivery' or 'pickup'");
  }
  if (!['cod', 'gateway'].includes(paymentMode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "paymentMode must be 'cod' or 'gateway'");
  }

  // ---- outlet + compliance gates ----------------------------------------
  const outlet = await JhatkaOutlet.findById(outletId);
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  const compliance = await assertOutletMaySell(outlet, models);

  // ---- address -----------------------------------------------------------
  let addressSnapshot;
  if (fulfilmentMode === 'delivery') {
    if (!addressId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'address is required for delivery');
    }
    const address = await JhatkaAddress.findOne({ _id: addressId, user: customerId }).lean();
    // Scoped by `user` so a customer's order cannot be delivered to somebody else's
    // saved address by passing its id. A 403 rather than a 404 because the address
    // existing is not this customer's business.
    if (!address) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Address not found for this account');
    }
    addressSnapshot = address;
  }

  // ---- resolve the catalogue --------------------------------------------
  const variantIds = items.map((i) => i.variant);
  const variants = await JhatkaVariant.find({ _id: { $in: variantIds }, status: true }).lean();
  if (variants.length !== variantIds.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One or more variants are unavailable');
  }

  const products = await JhatkaProduct.find({
    _id: { $in: variants.map((v) => v.product) },
    status: true,
  }).lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const overrides = await JhatkaPriceOverride.find({
    outlet: outlet._id,
    variant: { $in: variantIds },
    status: true,
  }).lean();
  const overrideByVariant = new Map(overrides.map((o) => [String(o.variant), o]));

  // ---- price -------------------------------------------------------------
  const priced = orderPricing.priceOrderLines({ items, variants, productById, overrideByVariant });

  // ---- the COD ceiling ----------------------------------------------------
  // Capped so a rider can never be asked to collect more than the ceiling (§3.6). This
  // is PAISE from the pricing service.
  const estimateTotalLocalPaise = priced.estimateTotalLocal;
  const codAmountPaise = orderPricing.codCeilingFor({
    goodsPlusTaxPaise: estimateTotalLocalPaise,
    paymentMode,
  });

  const order = new JhatkaOrder({
    orderNo: buildOrderNo(),
    customer: customerId,
    outlet: outlet._id,
    business: outlet.business,
    // Denormalised deliberately (§6.2): §8, §10 and §19 branch on it in hot queries.
    businessModel: outlet.businessModel,
    fulfilmentMode,
    // CREATED, not 'placed'. §16.2 VW-08: every guard reads `lifecycle`.
    lifecycle: 'CREATED',
    paymentMode,
    paymentStatus: 'pending',
    items: priced.orderItems,
    // PAISE -> RUPEES at the moneyField boundary, ONCE, via `asMoney`.
    itemsSubtotal: asMoney(priced.itemsSubtotalPaise),
    taxTotal: asMoney(priced.taxTotalPaise),
    // FROZEN. BR-06: this is what the customer paid and it can only ever fall.
    estimatedTotal: asMoney(estimateTotalLocalPaise),
    codAmount: asMoney(codAmountPaise),
    paidAmount: asMoney(0),
    refundedAmount: asMoney(0),
    // BR-05: LocalWala is Merchant of Record for all three business models.
    merchantOfRecord: { name: 'LocalWala', entity: 'LOCALWALA' },
    outletSnapshot: {
      outletCode: outlet.outletCode,
      name: outlet.name,
      address: [outlet.address?.line1, outlet.address?.line2].filter(Boolean).join(', '),
      fssaiLicenceNo: compliance?.fssai?.licenceNumber,
    },
    address: addressId || undefined,
    addressSnapshot,
    deliveryAddressSnapshot: addressId ? addressSnapshot : undefined,
    instructions: { customerNote: instructions?.customerNote },
    promisedDeliveryAt: promisedDeliveryAt ? new Date(promisedDeliveryAt) : undefined,
    promisedWeightGrams: priced.promisedWeightGrams,
    totalItems: priced.orderItems.length,
    totalQuantity: priced.totalQuantity,
    placedAt: new Date(),
  });

  // `validateSync` rather than trusting `save()` to reject: this turns a missing
  // required field into a 400 with a readable map, instead of a 500 from a raw
  // ValidationError three layers down.
  const validationError = order.validateSync();
  if (validationError) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Order failed validation',
      true,
      '',
      Object.keys(validationError.errors).reduce((acc, k) => {
        acc[k] = validationError.errors[k].message;
        return acc;
      }, {})
    );
  }

  await order.save();
  return { order, compliance };
}

/**
 * The customer-facing projection of a placed order.
 *
 * A separate function because the STORED document and the RETURNED document are
 * different things, and conflating them is how an internal field leaks into a public
 * API. Everything the customer may see is named here explicitly.
 */
function toCustomerView(order) {
  return {
    id: String(order._id),
    orderNo: order.orderNo,
    lifecycle: order.lifecycle,
    fulfilmentMode: order.fulfilmentMode,
    paymentMode: order.paymentMode,
    paymentStatus: order.paymentStatus,
    itemsSubtotal: order.itemsSubtotal,
    taxTotal: order.taxTotal,
    estimatedTotal: order.estimatedTotal,
    codAmount: order.codAmount,
    totalItems: order.totalItems,
    totalQuantity: order.totalQuantity,
    promisedWeightGrams: order.promisedWeightGrams,
    items: order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      variantName: i.variantName,
      unitLabel: i.unitLabel,
      measurementMode: i.measurementMode,
      isVariableWeight: i.isVariableWeight,
      requestedQuantity: i.requestedQuantity,
      lineTotal: i.lineTotal,
      taxAmount: i.taxAmount,
      lineGrand: i.lineGrand,
    })),
    placedAt: order.placedAt,
  };
}

module.exports = {
  placeOrder,
  assertOutletMaySell,
  toCustomerView,
  buildOrderNo,
};