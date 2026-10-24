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
 * stores.basket.service.js — one basket computation for quote AND order.
 *
 * `resolveBasket` is called by the checkout summary (the quote) and by order
 * creation (the charge). Same inputs → same numbers, because there is only
 * one implementation. Client money is never an input: prices come from the
 * (variant × outlet) row, the promo discount from the promotion engine, and
 * tax from the GST helper. A doctored `unitPrice` in the request changes
 * nothing — it is not even read.
 *
 * Money discipline: the whole computation runs in integer paise (see
 * stores.tax.service.js). Rupee floats appear only at the boundary, via
 * `toRupees`, so every stored total is exact to the paise and line sums
 * reconcile with the header totals the BR-33 ceiling depends on.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const taxService = require('./stores.tax.service');
const promotionService = require('./stores.promotion.service');
const couponService = require('./stores.coupon.service');

const { toPaise, toRupees } = taxService;

const freezeAttributes = (variant) => {
  const source = variant && variant.attributes;
  const entries = source instanceof Map ? Array.from(source.entries()) : Object.entries(source || {});
  return entries.map(([key, value]) => ({ key, label: key, value }));
};

/**
 * The COD checkout gate (BR-39, §5.13).
 *
 * Kept pure so the same gate can be proved without fixture products. The inert
 * product lookup loop stays in `resolveBasket`; the gate checks the totals the
 * basket computes, never anything a client sent.
 *
 * @param {object} args
 * @param {string} args.paymentMode
 * @param {object} args.deliveryConfig StoreOutlet.deliveryConfig
 * @param {boolean|undefined} args.verticalCodEnabled undefined means no vertical row configured
 * @param {number} args.grandTotalPaise integer paise
 */
const assertCodCheckoutAllowed = ({ paymentMode, deliveryConfig = {}, verticalCodEnabled, grandTotalPaise }) => {
  // §5.13 / BR-39: the COD gate is the whole policy.
  if (paymentMode === 'cod') {
    if (verticalCodEnabled === false) {
      throw new ApiError(httpStatus.CONFLICT, 'COD_DISABLED_PLATFORM: COD is not enabled for this vertical');
    }
    if (deliveryConfig.codEnabled === false) {
      throw new ApiError(httpStatus.CONFLICT, 'COD_DISABLED_OUTLET: this outlet does not accept COD');
    }
    const codMinOrderPaise = toPaise(deliveryConfig.codMinOrder || 0);
    const codMaxOrderPaise = toPaise(deliveryConfig.codMaxOrder || 0);
    if (codMinOrderPaise > 0 && grandTotalPaise < codMinOrderPaise) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `COD_MIN_ORDER_NOT_MET: COD minimum is ${toRupees(codMinOrderPaise)}`);
    }
    if (codMaxOrderPaise > 0 && grandTotalPaise > codMaxOrderPaise) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `COD_MAX_ORDER_EXCEEDED: COD maximum is ${toRupees(codMaxOrderPaise)}; pay online instead`);
    }
  } else if (deliveryConfig.onlinePaymentEnabled === false) {
    throw new ApiError(httpStatus.CONFLICT, 'ONLINE_PAYMENT_DISABLED: this outlet accepts COD only');
  }
  return true;
};

const resolveBasket = async ({ outlet, chain, items, promoCode, couponCode, customerId, atDate = new Date(), paymentMode = 'gateway' }) => {
  const StoreOutlet = mongoose.model('StoreOutlet');
  const ChainProduct = mongoose.model('ChainProduct');
  const ChainProductVariant = mongoose.model('ChainProductVariant');
  const StoreOutletProduct = mongoose.model('StoreOutletProduct');
  const Vertical = mongoose.model('Vertical');

  const outletDoc = await StoreOutlet.findById(outlet);
  if (!outletDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

  const lines = [];
  for (const input of items || []) {
    const variant = await ChainProductVariant.findById(input.variant);
    if (!variant) throw new ApiError(httpStatus.NOT_FOUND, `VARIANT_NOT_FOUND: ${input.variant}`);
    if (variant.status && variant.status !== 'active') {
      throw new ApiError(httpStatus.CONFLICT, `VARIANT_NOT_ACTIVE: ${variant.sku || variant._id}`);
    }
    const product = await ChainProduct.findById(input.product || variant.product);
    if (!product) throw new ApiError(httpStatus.NOT_FOUND, `PRODUCT_NOT_FOUND: ${input.product || variant.product}`);
    if (String(variant.product) !== String(product._id)) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'LINE_PRODUCT_MISMATCH: variant does not belong to the product');
    }
    // BR-36: availability is per outlet. No join row (or a non-active one)
    // means this outlet does not sell the variant — never fall back to the
    // chain price, which would sell stock the outlet may not hold.
    const outletProduct = await StoreOutletProduct.findOne({ outlet, productVariant: variant._id });
    if (!outletProduct || outletProduct.status !== 'active') {
      throw new ApiError(httpStatus.CONFLICT, `VARIANT_NOT_AVAILABLE_AT_OUTLET: ${variant.sku || variant._id}`);
    }

    const unitPricePaise = toPaise(outletProduct.price !== undefined && outletProduct.price !== null
      ? outletProduct.price
      : variant.price);
    const lineTotalPaise = unitPricePaise * input.quantity;

    lines.push({
      product, variant, outletProduct, quantity: input.quantity,
      image: input.image || '',
      unitPricePaise, lineTotalPaise,
    });
  }
  if (!lines.length) throw new ApiError(httpStatus.BAD_REQUEST, 'BASKET_EMPTY: no saleable lines');

  const itemsSubtotalPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);

  // Order-level promo and coupon, validated here (not trusted from the client) and
  // allocated pro-rata so per-line tax is computed on the discounted base.
  let promo = null;
  let promoDiscountPaise = 0;
  if (promoCode) {
    const promoDoc = await promotionService.validatePromotion({
      chain, outlet, code: promoCode, cartAmount: toRupees(itemsSubtotalPaise), customerId,
    });
    const discountRupees = promotionService.calculateDiscount(promoDoc, toRupees(itemsSubtotalPaise));
    promoDiscountPaise = toPaise(Math.min(discountRupees, toRupees(itemsSubtotalPaise)));
    promo = promoDoc;
  }

  // A coupon is a second, deliberately separate discount source. The plan allows it to
  // stack only when the promotion says so; an un-stackable promotion wins and the coupon
  // is refused rather than silently dropped.
  let coupon = null;
  let couponDiscountPaise = 0;
  if (couponCode) {
    if (promo && promo.stackable === false) {
      throw new ApiError(httpStatus.CONFLICT, 'PROMOTION_NOT_STACKABLE: this offer cannot be combined with a coupon');
    }
    let couponDoc;
    try {
      couponDoc = await couponService.validateCoupon({
        chain, outlet, code: couponCode, cartAmount: toRupees(itemsSubtotalPaise), customerId,
      });
    } catch (couponError) {
      // Backwards compatibility: codes created through the older promotion form live on
      // StorePromotion, not StoreCoupon. A lone code that is not a coupon is retried once
      // against the promotion ledger so existing printed codes keep working. When a
      // promoCode was also supplied the caller is explicitly trying to stack, and an
      // unknown coupon stays an error.
      if (promo || !couponError || couponError.statusCode !== httpStatus.NOT_FOUND) throw couponError;
      const promoDoc = await promotionService.validatePromotion({
        chain, outlet, code: couponCode, cartAmount: toRupees(itemsSubtotalPaise), customerId,
      });
      const discountRupees = promotionService.calculateDiscount(promoDoc, toRupees(itemsSubtotalPaise));
      promoDiscountPaise = toPaise(Math.min(discountRupees, toRupees(itemsSubtotalPaise)));
      promo = promoDoc;
    }

    if (couponDoc) {
      const remainingRupees = toRupees(itemsSubtotalPaise - promoDiscountPaise);
      const discountRupees = couponService.calculateDiscount(couponDoc, remainingRupees);
      couponDiscountPaise = toPaise(Math.min(discountRupees, remainingRupees));
      coupon = couponDoc;
    }
  }

  const discountTotalPaise = promoDiscountPaise + couponDiscountPaise;
  const discountShares = taxService.allocateProRata(discountTotalPaise, lines.map((l) => l.lineTotalPaise));

  const deliveryFeePaise = (promo && promo.type === 'free_delivery') || (coupon && coupon.type === 'free_delivery')
    ? 0
    : itemsSubtotalPaise >= toPaise(outletDoc.deliveryConfig?.freeDeliveryAbove ?? Infinity)
      ? 0
      : toPaise(outletDoc.deliveryConfig?.deliveryFee || 0);
  const deliveryTaxPaise = 0; // No SAC rate is configured for the delivery fee in V1.

  const outletStateCode = outletDoc.taxIdentity?.stateCode || null;
  let taxTotalPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let intraState = true;

  const frozen = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // eslint-disable-next-line no-await-in-loop
    const tax = await taxService.computeLineTax({
      product: line.product,
      outletProduct: line.outletProduct,
      unitPricePaise: line.unitPricePaise,
      quantity: line.quantity,
      discountPaise: discountShares[i],
      outletStateCode,
      customerStateCode: null, // local delivery — intra-state (§6.19)
      atDate,
    });
    taxTotalPaise += tax.taxPaise;
    cgstPaise += tax.cgstPaise;
    sgstPaise += tax.sgstPaise;
    igstPaise += tax.igstPaise;
    intraState = tax.intraState;

    frozen.push({
      product: line.product._id,
      variant: line.variant._id,
      name: line.product.name,
      variantName: line.variant.name,
      image: line.image,
      attributes: freezeAttributes(line.variant),
      sku: line.variant.sku,
      unitPrice: toRupees(line.unitPricePaise),
      discountAmount: toRupees(discountShares[i]),
      taxAmount: toRupees(tax.taxPaise),
      taxPercentage: tax.gstRate,
      hsn: tax.hsn,
      gstRate: tax.gstRate,
      taxableValue: toRupees(tax.taxablePaise),
      cgstAmount: toRupees(tax.cgstPaise),
      sgstAmount: toRupees(tax.sgstPaise),
      igstAmount: toRupees(tax.igstPaise),
      lineTotal: toRupees(line.lineTotalPaise),
      lineGrand: toRupees(tax.lineGrandPaise),
      quantity: line.quantity,
    });
  }

  const grandTotalPaise = itemsSubtotalPaise - discountTotalPaise + taxTotalPaise + deliveryFeePaise + deliveryTaxPaise;
  const minimumOrderPaise = toPaise(outletDoc.deliveryConfig?.minimumOrder || 0);
  if (grandTotalPaise < minimumOrderPaise) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `MINIMUM_ORDER_NOT_MET: minimum is ${toRupees(minimumOrderPaise)}`);
  }

  // §5.13 / BR-39: the COD gate is the whole policy. It is checked here, where
  // the order total already exists, so checkout quotes and real orders use the
  // same limits instead of drifting.
  const cfg = outletDoc.deliveryConfig || {};
  let verticalCodEnabled;
  if (paymentMode === 'cod') {
    const vertical = await Vertical.findOne({ key: 'stores' }).select('settings').lean();
    verticalCodEnabled =
      vertical && vertical.settings && vertical.settings.enabledFeatures && typeof vertical.settings.enabledFeatures.codEnabled === 'boolean'
        ? vertical.settings.enabledFeatures.codEnabled
        : undefined;
  }
  assertCodCheckoutAllowed({ paymentMode, deliveryConfig: cfg, verticalCodEnabled, grandTotalPaise });

  return {
    lines: frozen,
    totals: {
      itemsSubtotal: toRupees(itemsSubtotalPaise),
      itemDiscountTotal: 0, // no line-level discount engine in V1; promo is order-level
      taxTotal: toRupees(taxTotalPaise),
      deliveryFee: toRupees(deliveryFeePaise),
      deliveryTax: toRupees(deliveryTaxPaise),
      packagingFee: 0,
      serviceFee: 0,
      deliveryTip: 0,
      discountTotal: toRupees(discountTotalPaise),
      grandTotal: toRupees(grandTotalPaise),
      totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    },
    taxSummary: {
      cgst: toRupees(cgstPaise),
      sgst: toRupees(sgstPaise),
      igst: toRupees(igstPaise),
      intraState,
    },
    placeOfSupply: {
      outletStateCode,
      customerStateCode: null,
      intraState,
    },
    promo: promo
      ? { promotion: promo._id, title: promo.name, code: promo.code, discountAmount: toRupees(promoDiscountPaise), freeDelivery: promo.type === 'free_delivery' }
      : null,
    promoDoc: promo,
    coupon: coupon
      ? { coupon: coupon._id, title: coupon.title, code: coupon.code, discountAmount: toRupees(couponDiscountPaise) }
      : null,
    couponDoc: coupon,
    outlet: outletDoc,
  };
};

module.exports = {
  resolveBasket,
  freezeAttributes,
  assertCodCheckoutAllowed,
};
