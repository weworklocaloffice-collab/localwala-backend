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
 * stores.tax.service.js — per-line GST (BR-41, OD-03, §6.19).
 *
 * Tax is computed per order line and FROZEN onto it (`hsn`, `gstRate`,
 * `taxableValue`, `cgstAmount`, `sgstAmount`, `igstAmount`). Historical orders
 * are never recalculated: the line carries the rate that was in force, not a
 * pointer to today's table.
 *
 * ## Arithmetic core is paise integers
 *
 * Every function below takes and returns integer paise. GST percentages of
 * rupee floats (e.g. 18% of 999) are not representable exactly in binary, and
 * the drift lands exactly where it hurts: `lineGrand` sums that must equal
 * `grandTotal` to the paise for the BR-28/BR-33 refund ceiling to hold. The
 * services convert rupees to paise on entry and back on exit; the model
 * setter (`Math.round(v * 100)`) then stores exactly what was computed.
 *
 * ## Rate precedence
 *
 *   1. the outlet's `taxConfigOverride` row (outlet-specific ruling)
 *   2. `TaxConfiguration.resolveRate(hsn, atDate)` — the effective-dated table
 *   3. the product's `defaultGstRate` (products predating the taxonomy work)
 *   4. 0 — a product with no HSN and no default never blocks checkout
 *
 * ## Place of supply (§6.19)
 *
 * Same-state sale → CGST + SGST split down the middle (odd paise to SGST).
 * Cross-state sale → IGST. Store-owned delivery runs inside a kilometre
 * radius, so the customer is effectively always in the outlet's state; the
 * customer state is therefore optional and a missing one means intra-state.
 * Both codes and the verdict are frozen onto the order for the invoice.
 */

const mongoose = require('mongoose');

const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const toRupees = (paise) => Math.round(paise) / 100;

const resolveGstRate = async ({ outletProduct, product, atDate }) => {
  if (outletProduct && outletProduct.taxConfigOverride) {
    const TaxConfiguration = mongoose.model('TaxConfiguration');
    const override =
      outletProduct.taxConfigOverride.gstRate !== undefined
        ? outletProduct.taxConfigOverride
        : await TaxConfiguration.findById(outletProduct.taxConfigOverride).lean();
    if (override && typeof override.gstRate === 'number') return override.gstRate;
  }
  const hsn = product && product.hsn ? String(product.hsn).toUpperCase() : null;
  if (hsn) {
    try {
      const TaxConfiguration = mongoose.model('TaxConfiguration');
      const row = await TaxConfiguration.resolveRate(hsn, atDate);
      if (row && typeof row.gstRate === 'number') return row.gstRate;
    } catch (e) {
      // TAX_CONFIG_MISSING: the HSN has no rate rows yet. Fall through to the
      // product default rather than refusing the sale — the taxonomy backfill
      // (Phase 2/13) closes this, not the checkout path.
      if (!String((e && e.message) || e).includes('TAX_CONFIG_MISSING')) throw e;
    }
  }
  if (product && typeof product.defaultGstRate === 'number') return product.defaultGstRate;
  return 0;
};

/**
 * Split a line tax into CGST/SGST or IGST.
 *
 * @param {number} taxPaise integer paise
 * @param {boolean} intraState true → CGST+SGST, false → IGST
 */
const splitTax = (taxPaise, intraState) => {
  if (!intraState) return { cgst: 0, sgst: 0, igst: taxPaise };
  const cgst = Math.round(taxPaise / 2);
  return { cgst, sgst: taxPaise - cgst, igst: 0 };
};

/**
 * GST for one order line. All money in integer paise, all money out integer paise.
 *
 * @param {object} args
 * @param {object} args.product ChainProduct (hsn, taxType, defaultGstRate)
 * @param {object} [args.outletProduct] StoreOutletProduct (taxConfigOverride)
 * @param {number} args.unitPricePaise shelf price of one unit
 * @param {number} args.quantity
 * @param {number} [args.discountPaise] line discount + promo share already allocated
 * @param {string} [args.outletStateCode] e.g. '29'
 * @param {string|null} [args.customerStateCode] null → intra-state (local delivery)
 * @param {Date} [args.atDate] rate in force on this date
 */
const computeLineTax = async ({
  product,
  outletProduct,
  unitPricePaise,
  quantity,
  discountPaise = 0,
  outletStateCode,
  customerStateCode = null,
  atDate = new Date(),
}) => {
  const gstRate = await resolveGstRate({ outletProduct, product, atDate });
  const taxType = (product && product.taxType) || 'inclusive';
  const hsn = product && product.hsn ? String(product.hsn).toUpperCase() : null;

  const grossPaise = unitPricePaise * quantity - discountPaise;

  let taxablePaise;
  let taxPaise;
  if (taxType === 'none' || gstRate <= 0) {
    taxablePaise = grossPaise;
    taxPaise = 0;
  } else if (taxType === 'exclusive') {
    taxablePaise = grossPaise;
    taxPaise = Math.round((grossPaise * gstRate) / 100);
  } else {
    // inclusive: back the tax out of the shelf price
    taxablePaise = Math.round((grossPaise * 100) / (100 + gstRate));
    taxPaise = grossPaise - taxablePaise;
  }

  const intraState = !customerStateCode || !outletStateCode || customerStateCode === outletStateCode;
  const { cgst, sgst, igst } = splitTax(taxPaise, intraState);

  return {
    hsn,
    gstRate,
    taxType,
    taxablePaise,
    taxPaise,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    lineGrandPaise: taxablePaise + taxPaise,
    intraState,
    outletStateCode: outletStateCode || null,
    customerStateCode: customerStateCode || null,
  };
};

/**
 * Split an integer-paise total across weighted lines. Floors every share and
 * puts the remainder on the heaviest line, so the shares always sum exactly.
 */
const allocateProRata = (totalPaise, weights) => {
  const shares = new Array(weights.length).fill(0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalPaise <= 0 || totalWeight <= 0) return shares;
  let assigned = 0;
  let heaviest = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (weights[i] > weights[heaviest]) heaviest = i;
    shares[i] = Math.floor((totalPaise * weights[i]) / totalWeight);
    assigned += shares[i];
  }
  shares[heaviest] += totalPaise - assigned;
  return shares;
};

module.exports = {
  toPaise,
  toRupees,
  resolveGstRate,
  splitTax,
  computeLineTax,
  allocateProRata,
};
