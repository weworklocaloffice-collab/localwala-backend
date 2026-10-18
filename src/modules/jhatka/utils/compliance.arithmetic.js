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
 * Pure functions for the two state machines that do NOT belong on a model.
 *
 * ## Why these are here and not as statics
 *
 * These are the single implementations. `JhatkaCompliance` and
 * `JhatkaRecall` hold thin methods that DELEGATE here rather than re-deriving the
 * rule, because `JhatkaSupplierDocument` already has `deriveStatus` as its own
 * static and a second home for one rule is exactly the drift this codebase already
 * suffers from. One rule, one home; the verify suite asserts the model and the
 * function return identical results for the same input.
 *
 * ## The two machines
 *
 *   `deriveComplianceStatus`  §12.1 — valid / expiring / expired / pending
 *   `assessRecallScope`       §5.4 — which orders a compromised batch reached
 */

/**
 * Derive a compliance status from an expiry date. §12.1. BR-25.
 *
 * ## Derived, never asserted
 *
 * `DairyCompliance`'s header states the rule and this function is its
 * implementation: *"`status` is derived, not asserted."* A human-entered status
 * drifts from the dates within a day, and a compliance status that has drifted is
 * worse than none.
 *
 * ## No date means `pending`, not `valid`
 *
 * The subtle rule, copied deliberately. "We have not been told it lapses" is not
 * "it is fine". Returning `valid` for an undated document is how a shop turns up in
 * year three trading on a licence that lapsed in year one.
 *
 * ## A rejection outranks a future date
 *
 * A human rejected the document, so it is rejected regardless of its expiry. The
 * reverse — an expired document that a human approved — is NOT overridden, because
 * expiry is a fact and approval is an opinion.
 *
 * @param {object} doc     an object with `expiresAt` and optionally `status`
 * @param {Date}   [now]
 * @param {number} [warningDays]
 * @returns {'pending'|'valid'|'expiring'|'expired'|'rejected'}
 */
function deriveComplianceStatus(doc, now = new Date(), warningDays = 30) {
  if (doc?.status === 'rejected') return 'rejected';
  if (!doc?.expiresAt) return 'pending';

  const days = Math.ceil((new Date(doc.expiresAt).getTime() - now.getTime()) / (24 * 3600 * 1000));
  if (days < 0) return 'expired';
  if (days <= warningDays) return 'expiring';
  return 'valid';
}

/**
 * Days until expiry, or null when there is no date. Null, not zero: "expires today"
 * and "we do not know" are different states and a UI that renders them identically
 * is lying to someone about their compliance.
 *
 * @param {{expiresAt?: Date}} doc
 * @param {Date} [now]
 * @returns {number|null}
 */
function daysToExpiry(doc, now = new Date()) {
  if (!doc?.expiresAt) return null;
  return Math.ceil((new Date(doc.expiresAt).getTime() - now.getTime()) / (24 * 3600 * 1000));
}

/**
 * Does an expired compliance document BLOCK trading? §12.2.
 *
 * ## Granularity matters more than the rule
 *
 * An FSSAI lapse suspends THE OUTLET. It does not suspend the `jhatka` vertical —
 * suspending the vertical because one outlet's trade licence expired would take
 * down every counter in the country.
 *
 * ## What it does NOT block
 *
 * Existing orders. A shop whose licence lapsed at noon still owes the customer the
 * chicken it accepted at 11:55. Blocking fulfilment as well as new commerce turns a
 * compliance problem into a mass of unfulfillable, already-paid orders.
 *
 * @param {string} docType one of fssai | gst_registration | trade_licence | premises_lease
 * @returns {boolean}
 */
function isBlockingDocument(docType) {
  return docType === 'fssai';
}

/**
 * Which orders did a compromised batch reach? §5.4.
 *
 * ## This is the recall function the blueprint does not have
 *
 * The blueprint's §24 asks "which supplier/batch was used for this order?" — the
 * reverse direction. The question that actually gets asked under time pressure is
 * the other one: **batch X is compromised, who ate it?**
 *
 * That answer is one indexed lookup on
 * `JhatkaBatchAllocation {batch: 1, occurredAt: -1}`. Everything else in a recall
 * is notification, and notification needs the list this function produces.
 *
 * ## The filter, and why each clause is there
 *
 *   allocationType CONSUMPTION  — stock actually moved into an order
 *   qtyDelta < 0               — CONSUMPTION is always negative, belt-and-braces
 *   has orderItem              — an allocation with no order item traced nothing
 *   exclude cancelled          — the customer never received it
 *   exclude undelivered        — still in a cold cabinet at the outlet; recoverable
 *   only DELIVERED             — inside the recall window and actually eaten
 *
 * The last two clauses are the judgement. An order that is `ACCEPTED` but not
 * delivered can still be salvaged by destroying the stock at the outlet. One that
 * is `DELIVERED` cannot, and it is the only one worth waking a customer about at
 * 3am.
 *
 * ## "Not yet delivered" is still an action
 *
 * `undeliveredCount` is returned separately from `affectedOrders` precisely so the
 * recall console can say "14 customers notified, 3 more orders blocked at the
 * outlet" rather than dropping the second group on the floor. Those orders still
 * need a `ON_HOLD` transition; they just need a different message.
 *
 * @param {Array} allocations `JhatkaBatchAllocation` documents for one batch
 * @returns {{
 *   totalAllocations: number,
 *   affectedOrders: Array,
 *   affectedCustomers: Array,
 *   undeliveredCount: number,
 *   deliveredCount: number
 * }}
 */
function assessRecallScope(allocations) {
  const rows = Array.isArray(allocations) ? allocations : [];

  const consumptions = rows.filter(
    (a) =>
      a.allocationType === 'CONSUMPTION' &&
      Number(a.qtyDelta || 0) < 0 &&
      a.orderItem &&
      a.order
  );

  // De-duplicate by order: one order may have drawn on this batch across several
  // lines, and notifying a customer once per line is worse than useless.
  const byOrder = new Map();
  for (const a of consumptions) {
    const key = String(a.order);
    if (!byOrder.has(key)) {
      byOrder.set(key, {
        order: a.order,
        orderItem: a.orderItem,
        outlet: a.outlet,
        qty: 0,
        lifecycle: a.orderLifecycle || null,
      });
    }
    byOrder.get(key).qty += Math.abs(Number(a.qtyDelta || 0));
  }

  const affectedOrders = [...byOrder.values()];

  const delivered = affectedOrders.filter((o) => o.lifecycle === 'DELIVERED');
  const undelivered = affectedOrders.filter((o) => o.lifecycle && o.lifecycle !== 'DELIVERED');

  // One entry per customer, carrying the orders so the notification can be specific.
  const byCustomer = new Map();
  for (const o of delivered) {
    const customer = o.customer || o.customerId;
    const key = String(customer || o.order);
    if (!byCustomer.has(key)) {
      byCustomer.set(key, {
        customer,
        orders: [],
        notifiedAt: null,
      });
    }
    byCustomer.get(key).orders.push(o.order);
  }

  return {
    totalAllocations: rows.length,
    affectedOrders,
    affectedCustomers: [...byCustomer.values()],
    deliveredCount: delivered.length,
    undeliveredCount: undelivered.length,
  };
}

module.exports = {
  deriveComplianceStatus,
  daysToExpiry,
  isBlockingDocument,
  assessRecallScope,
};