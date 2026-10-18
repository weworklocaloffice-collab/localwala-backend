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
 * jhatka.compliance-gate.service.js — §12.2 as executable code.
 *
 * ## The table, verbatim
 *
 *   FSSAI expired              → blocks NEW orders. Existing orders continue.
 *   FSSAI expiring (≤30 days)  → blocks nothing. Warning banner + notifications.
 *   Trade licence expired      → blocks new orders.
 *   Supplier document expired  → blocks new receipts FROM THAT SUPPLIER.
 *   Outlet suspended           → blocks everything.
 *
 * ## Where suspension is enforced (read this before adding a gate)
 *
 * NOT here, for fulfilment. `requireActiveOutlet` in `jhatka.tenant.js` runs on
 * every partner route and rejects non-active outlets with `OUTLET_NOT_TRADING` —
 * and it runs FIRST, so a per-handler suspension check would be dead code that
 * implies coverage. This module owns DOCUMENT expiry for NEW BUSINESS, and the
 * delivery service (the rider path has no such middleware) for fulfilment.
 * Anything else is a second suspension check, and F-8 is what happens to those.
 *
 * ## Why per-outlet, never per-vertical
 *
 * Suspending the `jhatka` vertical because one counter's trade licence lapsed would
 * take down every outlet in the country. §12.4 is explicit: the granularity is the
 * outlet. `vertical.service.setVerticalStatus` is never called from here.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { deriveComplianceStatus } = require('../utils/compliance.arithmetic');

/**
 * Operations, grouped by what they are allowed to do to a non-fully-compliant outlet.
 *
 * `new_business` — starting something: placing, receiving, accepting, posting a
 *   receipt, generating a subscription occurrence. Blocked by any lapse.
 * `fulfil` — finishing something already started: preparing, weighing, packing,
 *   dispatching, delivering, completing. Blocked ONLY by suspension, because §12.2
 *   says existing orders continue. Stopping a van mid-route over a licence that
 *   lapsed this morning strands meat that is already cut.
 * `settle` — money movement: payouts, payables, refunds. Blocked by suspension, not
 *   by document expiry: money owed is owed regardless of whose licence lapsed, and
 *   refusing to pay a supplier because their document expired is how a platform
 *   ends up keeping money it admits is someone else's.
 */
const OPERATION_CLASSES = Object.freeze({
  place_order: 'new_business',
  receive: 'new_business',
  accept: 'new_business',
  post_receipt: 'new_business',
  generate_occurrence: 'new_business',
  create_subscription: 'new_business',
  prepare: 'fulfil',
  weigh: 'fulfil',
  pack: 'fulfil',
  ready: 'fulfil',
  dispatch: 'fulfil',
  deliver: 'fulfil',
  complete: 'fulfil',
  cancel: 'fulfil',
  reject: 'fulfil',
  pay_payout: 'settle',
  pay_payable: 'settle',
  settle_refund: 'settle',
  read: 'read',
});

/** Warning window in days. §12.1: 30, overridable from settings. */
const EXPIRY_WARNING_DAYS = 30;

/**
 * Assert an outlet may perform an operation.
 *
 * @param {object} p
 * @param {object} p.outlet      HYDRATED or lean `JhatkaOutlet` — needs `status`
 * @param {string} p.operation   one of OPERATION_CLASSES keys
 * @param {object} p.models      `{ JhatkaCompliance }` — required for new_business
 * @param {object} [p.now]       clock, for tests
 * @throws {ApiError} 403 with a machine-readable `code`
 * @returns {Promise<{fssai: string, tradeLicence: string|null}>} the derived statuses
 */
async function assertJhatkaOperational({ outlet, operation, models, now = new Date() } = {}) {
  if (!outlet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  }

  const operationClass = OPERATION_CLASSES[operation];
  if (!operationClass) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Unknown compliance operation '${operation}'`,
      true,
      '',
      { code: 'UNKNOWN_COMPLIANCE_OPERATION', operation }
    );
  }

  if (operationClass === 'read') return { fssai: 'unchecked', tradeLicence: null };

  // Suspension blocks everything including in-flight work. This is the one row of
  // the table with no exceptions, and it is checked first so no later branch can
  // accidentally permit a suspended outlet to trade.
  if (outlet.status === 'suspended' || outlet.status === 'closed') {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `This outlet is ${outlet.status} and cannot trade`,
      true,
      '',
      {
        code: 'OUTLET_NOT_TRADING',
        status: outlet.status,
        reason: outlet.suspensionReason || outlet.statusReason,
      }
    );
  }

  // Starting something new requires a fully ACTIVE outlet. A draft or
  // pending_approval outlet has no licence on file yet, so there is nothing to be
  // "still valid" — and an order placed against it would be an order the outlet may
  // never be allowed to fulfil.
  if (operationClass === 'new_business' && outlet.status !== 'active') {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `This outlet is ${outlet.status} and cannot take new orders`,
      true,
      '',
      { code: 'OUTLET_NOT_ACTIVE', status: outlet.status }
    );
  }

  // Fulfilment and settlement are not gated on document expiry. See the header: an
  // expired FSSAI stops NEW orders, and money owed is owed.
  if (operationClass === 'fulfil' || operationClass === 'settle') {
    return { fssai: 'unchecked', tradeLicence: null };
  }

  // ---- new_business: the full table -----------------------------------------
  const compliance = models?.JhatkaCompliance
    ? await models.JhatkaCompliance.findOne({ outlet: outlet._id })
      .select('fssai tradeLicence status')
      .lean()
    : null;

  // No compliance record at all. A new outlet that has never filed cannot be treated
  // as compliant — but it also cannot be treated as expired, because there is nothing
  // that expired. The answer is the middle one: allowed, flagged, and visible.
  if (!compliance) {
    return { fssai: 'pending', tradeLicence: null };
  }

  const fssai = deriveComplianceStatus(compliance.fssai, now, EXPIRY_WARNING_DAYS);
  if (fssai !== 'valid' && fssai !== 'expiring') {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `This outlet cannot take new orders: FSSAI status is '${fssai}'`,
      true,
      '',
      { code: 'FSSAI_NOT_VALID', fssai }
    );
  }

  let tradeLicence = null;
  if (compliance.tradeLicence?.expiresAt) {
    tradeLicence = deriveComplianceStatus(compliance.tradeLicence, now, EXPIRY_WARNING_DAYS);
    if (tradeLicence !== 'valid' && tradeLicence !== 'expiring') {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        `This outlet cannot take new orders: trade licence status is '${tradeLicence}'`,
        true,
        '',
        { code: 'TRADE_LICENCE_NOT_VALID', tradeLicence }
      );
    }
  }

  return { fssai, tradeLicence };
}

/**
 * Assert a supplier may be received from.
 *
 * ## The blast radius is one supplier
 *
 * §12.2: an expired supplier document blocks new receipts FROM THAT SUPPLIER. It does
 * not block the outlet, the vertical, or other suppliers. One bad supplier must not
 * stop an outlet — and the way to guarantee that is to check the supplier, not the
 * outlet, at receipt time.
 *
 * @throws {ApiError} 403 with `code: SUPPLIER_NOT_RECEIVABLE`
 */
async function assertSupplierReceivable({ supplierId, models, now = new Date() } = {}) {
  const { JhatkaSupplier, JhatkaSupplierDocument } = models || {};
  if (!JhatkaSupplier) return { status: 'unchecked' };

  const supplier = await JhatkaSupplier.findById(supplierId).select('status name').lean();
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }

  if (supplier.status === 'suspended' || supplier.status === 'terminated') {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `Supplier ${supplier.name || supplierId} is ${supplier.status}: no new receipts`,
      true,
      '',
      { code: 'SUPPLIER_NOT_RECEIVABLE', status: supplier.status }
    );
  }

  // An expired FSSAI or GST document on the supplier blocks receipts the same way an
  // expired outlet FSSAI blocks orders. Checked per-document so one lapsed paper does
  // not need a human to suspend the whole supplier first.
  if (JhatkaSupplierDocument) {
    const expired = await JhatkaSupplierDocument.findOne({
      supplier: supplierId,
      status: { $ne: 'verified' },
      expiresAt: { $lt: now },
      type: { $in: ['fssai', 'gst_registration'] },
    })
      .select('type expiresAt')
      .lean();

    if (expired) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        `Supplier ${supplier.name || supplierId} has an expired ${expired.type} document: no new receipts`,
        true,
        '',
        { code: 'SUPPLIER_DOCUMENT_EXPIRED', documentType: expired.type }
      );
    }
  }

  return { status: supplier.status };
}

module.exports = {
  assertJhatkaOperational,
  assertSupplierReceivable,
  OPERATION_CLASSES,
  EXPIRY_WARNING_DAYS,
};