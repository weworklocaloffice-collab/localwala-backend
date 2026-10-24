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

const { toPaise, fromPaise } = require('../../../utils/money');

/**
 * localservice.pricing.service — SOLE service-price authority (revenue.service
 * owns fee+commission; this owns the booking price itself).
 *
 * Fixed order per spec §6.6: base+units -> addons -> discounts -> tax ->
 * deposit/balance. All math in integer paise; items[] frozen onto booking.
 */
const P = (r) => Math.round(Number(r || 0) * 100);

function priceBooking(input = {}) {
  const {
    pricingMode = 'FIXED',
    basePrice = 0,
    variantPrice = null,
    hourlyRate = 0,
    hours = 0,
    unitRate = 0,
    quantity = 1,
    nightlyRate = 0,
    nights = 0,
    addons = [],
    discountAmount = 0,
    taxPercent = 0,
    depositPercent = 0,
    minimumCharge = 0,
  } = input;

  const items = [];
  let basePaise;
  if (pricingMode === 'FIXED') {
    basePaise = P(basePrice);
    items.push({ kind: 'service', label: 'Service', quantity: 1, unitPrice: fromPaise(basePaise), lineTotal: fromPaise(basePaise) });
  } else if (pricingMode === 'VARIANT') {
    basePaise = P(variantPrice !== null ? variantPrice : basePrice);
    items.push({ kind: 'variant', label: 'Variant', quantity: 1, unitPrice: fromPaise(basePaise), lineTotal: fromPaise(basePaise) });
  } else if (pricingMode === 'HOURLY') {
    basePaise = P(hourlyRate) * Number(hours);
    items.push({ kind: 'service', label: `${hours} hr x ${hourlyRate}`, quantity: Number(hours), unitPrice: Number(hourlyRate), lineTotal: fromPaise(basePaise) });
  } else if (pricingMode === 'UNIT_BASED') {
    basePaise = P(unitRate) * Number(quantity);
    items.push({ kind: 'service', label: `${quantity} x ${unitRate}`, quantity: Number(quantity), unitPrice: Number(unitRate), lineTotal: fromPaise(basePaise) });
  } else if (pricingMode === 'DATE_BASED') {
    basePaise = P(nightlyRate) * Number(nights);
    items.push({ kind: 'service', label: `${nights} night(s) x ${nightlyRate}`, quantity: Number(nights), unitPrice: Number(nightlyRate), lineTotal: fromPaise(basePaise) });
  } else {
    // QUOTE / INSPECTION_QUOTE: price comes from accepted quote, not here.
    basePaise = P(basePrice);
    items.push({ kind: 'service', label: 'Quoted service', quantity: 1, unitPrice: fromPaise(basePaise), lineTotal: fromPaise(basePaise) });
  }

  let addonsPaise = 0;
  for (const a of addons) {
    const line = P(a.price) * Number(a.quantity || 1);
    addonsPaise += line;
    items.push({ kind: 'addon', label: a.label || 'Add-on', quantity: Number(a.quantity || 1), unitPrice: Number(a.price), lineTotal: fromPaise(line) });
  }

  let subtotalPaise = basePaise + addonsPaise;
  const minPaise = P(minimumCharge);
  if (minPaise > 0 && subtotalPaise < minPaise) {
    items.push({ kind: 'fee', label: 'Minimum charge adjustment', quantity: 1, unitPrice: fromPaise(minPaise - subtotalPaise), lineTotal: fromPaise(minPaise - subtotalPaise) });
    subtotalPaise = minPaise;
  }

  const discountPaise = Math.min(P(discountAmount), subtotalPaise);
  if (discountPaise > 0) {
    items.push({ kind: 'discount', label: 'Discount', quantity: 1, unitPrice: -fromPaise(discountPaise), lineTotal: -fromPaise(discountPaise) });
  }
  const taxablePaise = subtotalPaise - discountPaise;
  const taxPaise = Math.round((taxablePaise * Number(taxPercent || 0)) / 100);
  if (taxPaise > 0) {
    items.push({ kind: 'tax', label: `Tax ${taxPercent}%`, quantity: 1, unitPrice: fromPaise(taxPaise), lineTotal: fromPaise(taxPaise) });
  }
  const totalPaise = taxablePaise + taxPaise;
  // Inspection fee (INSPECTION_QUOTE): additional lands on top; credited is
  // shown as its own line and offset at invoice so the customer sees both.
  const inspection = input.inspection || null;
  let inspectionPaise = 0;
  if (inspection && Number(inspection.fee) > 0) {
    inspectionPaise = P(inspection.fee);
    items.push({ kind: 'fee', label: `Inspection fee (${inspection.treatment || 'additional'})`, quantity: 1, unitPrice: fromPaise(inspectionPaise), lineTotal: fromPaise(inspectionPaise) });
    if ((inspection.treatment || 'additional') === 'credited') {
      items.push({ kind: 'discount', label: 'Inspection credit (adjusted at invoice)', quantity: 1, unitPrice: -fromPaise(inspectionPaise), lineTotal: -fromPaise(inspectionPaise) });
      inspectionPaise = 0;
    }
    // 'additional' stays on top of the service total (due now).
  }
  const grandPaise = totalPaise + inspectionPaise;
  const depositPaise = Math.round((grandPaise * Number(depositPercent || 0)) / 100);
  const f = fromPaise;
  return {
    items,
    subtotal: f(subtotalPaise),
    discount: f(discountPaise),
    taxable: f(taxablePaise),
    tax: f(taxPaise),
    total: f(totalPaise),
    inspectionFee: f(inspection ? P(inspection.fee) : 0),
    grandTotal: f(grandPaise),
    deposit: f(depositPaise),
    balance: f(grandPaise - depositPaise),
    _paise: { subtotalPaise, discountPaise, taxablePaise, taxPaise, totalPaise, inspectionPaise, grandPaise, depositPaise },
  };
}

module.exports = { priceBooking, assertPriceBand };

/**
 * Partner price-band guard (CENTRAL/PARTNER control). Band of 0 = open.
 * Throws 400 when outside [min, max]. Pure — unit-tested.
 */
function assertPriceBand(price, min, max) {
  const p = Number(price);
  if (Number(min) > 0 && p < Number(min)) {
    const e = new Error(`Price ${p} below minimum ${min}`);
    e.statusCode = 400;
    throw e;
  }
  if (Number(max) > 0 && p > Number(max)) {
    const e = new Error(`Price ${p} above maximum ${max}`);
    e.statusCode = 400;
    throw e;
  }
}
