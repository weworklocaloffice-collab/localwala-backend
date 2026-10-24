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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const basketService = require('./stores.basket.service');

const getCheckoutSummary = async ({ customer, outlet, chain, address, promoCode, couponCode, paymentMode }) => {
  const StoreCart = mongoose.model('StoreCart');

  const cart = await StoreCart.findOne({ customer, outlet }).populate('items.product', 'name slug images').populate('items.variant', 'name sku');
  if (!cart || !cart.items.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Cart is empty');

  // The quote IS the charge computation — same basket, same promo, same tax.
  // Anything the summary shows, order creation will write.
  const basket = await basketService.resolveBasket({
    outlet,
    chain,
    items: cart.items.map((item) => ({
      product: item.product && item.product._id ? item.product._id : item.product,
      variant: item.variant && item.variant._id ? item.variant._id : item.variant,
      quantity: item.quantity,
    })),
    // The two codes have separate ledgers and separate order snapshots. Passing the
    // coupon as a promo made `StoreOrder.promo` claim a voucher was a promotion and left
    // `StoreOrder.coupon` permanently null.
    promoCode,
    couponCode,
    customerId: customer,
    paymentMode: paymentMode || 'gateway',
  });

  return {
    items: basket.lines,
    itemsSubtotal: basket.totals.itemsSubtotal,
    itemDiscountTotal: basket.totals.discountTotal,
    taxTotal: basket.totals.taxTotal,
    taxSummary: basket.taxSummary,
    placeOfSupply: basket.placeOfSupply,
    deliveryFee: basket.totals.deliveryFee,
    deliveryTax: basket.totals.deliveryTax,
    packagingFee: basket.totals.packagingFee,
    serviceFee: basket.totals.serviceFee,
    deliveryTip: basket.totals.deliveryTip,
    discountTotal: basket.totals.discountTotal,
    grandTotal: basket.totals.grandTotal,
    promotion: basket.promo ? { code: basket.promo.code, type: basket.promoDoc.type, value: basket.promoDoc.value } : null,
    coupon: basket.coupon ? { code: basket.coupon.code, type: basket.couponDoc.type, value: basket.couponDoc.value } : null,
    outlet: {
      name: basket.outlet.name,
      outletCode: basket.outlet.outletCode,
      deliveryConfig: basket.outlet.deliveryConfig,
    },
  };
};

/**
 * BR-27 eligibility, as the HTTP layer actually calls it.
 *
 * `outlet` arrives here as an ObjectId from the request body — the same shape
 * `getCheckoutSummary` takes. It is NOT an outlet document. But `checkEligibility` reads
 * document fields: `outlet.operational`, `outlet.status`, `outlet.location.coordinates`,
 * `outlet.deliveryConfig.radiusKm`, `outlet.operatingHours`.
 *
 * Passing the raw string through meant every one of those reads was `undefined`, so EVERY
 * outlet produced the same three reasons:
 *
 *     STORE_NOT_OPERATIONAL   (undefined is falsy)
 *     STORE_NOT_ACTIVE        (undefined !== 'active')
 *     STORE_LOCATION_MISSING  (undefined has no .coordinates)
 *
 * and `eligible` was always false. No customer could ever pass the checkout gate, for any
 * store, at any distance. The capacity and opening-hours checks silently did nothing too,
 * because they are guarded on those same undefined fields.
 *
 * This was invisible to the suite because every eligibility assertion calls
 * `checkEligibility` DIRECTLY with a real outlet document. Nothing ever passed an id down
 * this path — the same gap that hid the route shadowing: tests exercise the service with
 * shapes the HTTP layer never produces.
 */
const validateCheckoutEligibility = async ({ outlet, address, addressLocation }) => {
  const eligibilityService = require('./stores.eligibility.service');
  const mongoose = require('mongoose');
  const StoreOutlet = mongoose.model('StoreOutlet');

  // Resolve only when given an identifier. An already-populated document is passed
  // straight through, so this stays correct for any internal caller and keeps working if
  // the route is ever changed to populate the outlet itself.
  let resolved = outlet;
  if (outlet && typeof outlet !== 'object') {
    resolved = await StoreOutlet.findById(outlet).lean();
  }

  // An id that does not resolve is OUTLET_NOT_FOUND, not three unrelated faults.
  if (!resolved) {
    return { eligible: false, reasons: ['OUTLET_NOT_FOUND'] };
  }

  return eligibilityService.checkEligibility({
    outlet: resolved,
    address,
    addressLocation,
  });
};

module.exports = {
  getCheckoutSummary,
  validateCheckoutEligibility,
};