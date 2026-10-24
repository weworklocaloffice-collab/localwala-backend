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

const crypto = require('crypto');
const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { BOOKING_TRANSITIONS } = require('../constants/booking.modes');

/**
 * localservice.booking.service — owns status transitions + revenue hook.
 *
 * - Transitions validated against BOOKING_TRANSITIONS table (409 on illegal).
 * - Every transition writes LocalServiceStatusHistory.
 * - COMPLETED fires the revenue hook: applyRevenueForBooking() on
 *   COMPLETION_VERIFIED semantics (completion = verified collection event).
 *   Hook is idempotent — replay returns the same entry (deduped:true).
 * - Cancel/no-show does NOT delete; reversal entries handled by revenue service.
 */

function canTransition(from, to) {
  return (BOOKING_TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new ApiError(httpStatus.CONFLICT, `Illegal booking transition ${from} -> ${to}`);
  }
}

/**
 * Actor-scoped transitions. The global table says which transitions are
 * structurally legal; these tables say which actor may perform them. Without
 * this split a customer can walk a booking through CONFIRMED and COMPLETED.
 */
const ACTOR_TRANSITIONS = Object.freeze({
  customer: Object.freeze({
    DRAFT: Object.freeze(['REQUESTED', 'CANCELLED']),
    REQUESTED: Object.freeze(['CANCELLED']),
    PENDING_PROVIDER: Object.freeze(['CANCELLED']),
    ACCEPTED: Object.freeze(['CANCELLED']),
    PAYMENT_PENDING: Object.freeze(['CANCELLED']),
    CONFIRMED: Object.freeze(['CANCELLED']),
    IN_PROGRESS: Object.freeze(['DISPUTED']),
    COMPLETED: Object.freeze(['DISPUTED']),
  }),
  provider: Object.freeze({
    PENDING_PROVIDER: Object.freeze(['ACCEPTED', 'CANCELLED']),
    ACCEPTED: Object.freeze(['CONFIRMED', 'CANCELLED']),
    CONFIRMED: Object.freeze(['IN_PROGRESS', 'NO_SHOW', 'CANCELLED']),
    IN_PROGRESS: Object.freeze(['COMPLETED', 'CANCELLED']),
  }),
});

function canActorTransition(actorType, from, to) {
  const table = ACTOR_TRANSITIONS[actorType];
  // Unknown actors (system, admin, background jobs) are governed by the
  // global state table only.
  if (!table) return true;
  return (table[from] || []).includes(to);
}

function assertActorTransition(actorType, from, to) {
  if (!canActorTransition(actorType, from, to)) {
    throw new ApiError(httpStatus.FORBIDDEN, `Actor ${actorType} cannot move booking ${from} -> ${to}`);
  }
}

/**
 * Collision-resistant reference. The previous in-memory counter reset on every
 * process start, so a restart re-issued LSyymmdd0001 and hit the unique index.
 */
function buildBookingCode() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `LS${ymd}${suffix}`;
}

async function transitionBooking(bookingId, to, { reason, actorType, actorId } = {}, { BookingModel, HistoryModel, revenueHook } = {}) {
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const History = HistoryModel || require('../models/localservice.status.history.model');
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  assertTransition(booking.status, to);
  assertActorTransition(actorType, booking.status, to);
  if (
    actorType === 'provider' &&
    to === 'CONFIRMED' &&
    !['paid', 'partially_paid'].includes(booking.paymentStatus) &&
    !['cod', 'direct'].includes(booking.paymentMode)
  ) {
    throw new ApiError(httpStatus.CONFLICT, 'Payment must be collected before confirmation');
  }
  if (
    actorType === 'provider' &&
    to === 'COMPLETED' &&
    booking.paymentMode === 'gateway' &&
    booking.paymentStatus !== 'paid'
  ) {
    throw new ApiError(httpStatus.CONFLICT, 'Balance payment must be collected before completion');
  }
  const from = booking.status;
  booking.status = to;
  if (to === 'CANCELLED' || to === 'DISPUTED') booking.cancelReason = reason || booking.cancelReason;
  if (to === 'COMPLETED') {
    booking.completedAt = new Date();
    // COD/direct: money changed hands off-gateway — mark paid so revenue and
    // settlement proceed; commission is collected via settlement netting (§14-C).
    if ((booking.paymentMode === 'cod' || booking.paymentMode === 'direct') && booking.paymentStatus === 'pending') {
      booking.paymentStatus = 'paid';
    }
  }
  await booking.save();
  await History.create({ booking: booking._id, from, to, actorType: actorType || 'system', actor: actorId || undefined, reason: reason || undefined });
  if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(to) && mongoose.Types.ObjectId.isValid(bookingId)) {
    const { LocalServiceAssignment } = require('../models/localservice.fulfilment.model');
    const Reservation = require('../models/localservice.reservation.model');
    const releasedAt = new Date();
    await Promise.all([
      LocalServiceAssignment.updateMany(
        { booking: booking._id, status: 'assigned' },
        { $set: { status: 'released', releasedAt } }
      ),
      Reservation.updateMany(
        { booking: booking._id, status: { $in: ['held', 'confirmed'] } },
        { $set: { status: 'released' } }
      ),
    ]);
  }
  // Revenue hook: completion qualifies earnings (COMPLETION_VERIFIED event).
  let revenue = null;
  if (to === 'COMPLETED' && revenueHook !== false) {
    const { applyRevenueForBooking } = require('./localservice.revenue.booking.service');
    revenue = await applyRevenueForBooking({
      bookingId: String(booking._id),
      scope: { categoryKey: booking.categoryKey, subcategoryKey: booking.subcategoryKey, serviceKey: booking.serviceKey, provider: booking.provider },
      amounts: { labourAmount: booking.labourAmount, partsAmount: booking.partsAmount, discountAmount: booking.discountAmount, serviceValue: booking.serviceValue },
      paymentId: booking.payment || null,
      event: 'COMPLETION_VERIFIED',
      actorId: actorId || null,
    });
    booking.revenueEntry = revenue.entry._id || revenue.entry.idempotencyKey;
    booking.revenueAppliedAt = new Date();
    await booking.save();
    // Invoice: frozen bill from items (or amounts fallback). Never regenerated.
    try {
      const { LocalServiceInvoice } = require('../models/localservice.fulfilment.model');
      const lines = (booking.items || []).length
        ? booking.items.map((i) => ({ label: i.label, amount: i.lineTotal }))
        : [
            { label: 'Labour', amount: booking.labourAmount },
            { label: 'Parts', amount: booking.partsAmount },
          ];
      const total = Number(lines.reduce((s, l) => s + Number(l.amount || 0), 0).toFixed(2));
      await LocalServiceInvoice.findOneAndUpdate(
        { booking: booking._id },
        { booking: booking._id, lines, total, status: 'issued' },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.error('LocalServices invoice failed:', e.message);
    }
  }
  // Cancel path: compute policy refund and open a RefundRequest (requested,
  // never auto-approved). Reversal entries follow only after approval.
  let refundRequest = null;
  if (to === 'CANCELLED') {
    try {
      const policy = require('./localservice.policy.service');
      const policyConfig = require('./localservice.policy.config.service');
      const { LocalServiceRefundRequest } = require('../models/localservice.catalog.ext.model');
      const total = Number(booking.serviceValue || Number(booking.labourAmount || 0) + Number(booking.partsAmount || 0));
      const recordedPaid = Number(booking.amountPaid || 0);
      const paid = recordedPaid > 0
        ? recordedPaid
        : ['paid', 'partially_paid'].includes(booking.paymentStatus)
          ? total
          : 0;
      // Money already returned is not refundable again.
      const refunded = Number(booking.refundedAmount || 0);
      const netPaid = Math.max(0, Number((paid - refunded).toFixed(2)));

      // The cancellation cutoff and the retained fee come from the effective
      // policy, so Admin configures them instead of the code.
      let effectivePolicy = null;
      try {
        const Service = require('../models/localservice.service.model');
        const service = booking.serviceKey
          ? await Service.findOne({ key: booking.serviceKey }).lean()
          : null;
        effectivePolicy = await policyConfig.loadEffectivePolicy(
          {
            categoryKey: booking.categoryKey || (service && service.categoryKey) || null,
            subcategoryKey: booking.subcategoryKey || null,
            serviceKey: booking.serviceKey || null,
            provider: booking.provider || null,
          },
          {
            depositPercent: service ? service.depositPercent : 0,
            allowedPaymentModes: service ? service.allowedPaymentModes : [],
          }
        );
      } catch (e) {
        console.error('LocalServices policy lookup failed:', e.message);
      }

      const cutoffHours = effectivePolicy ? effectivePolicy.cancellationCutoffHours : 24;
      const feeRupees = effectivePolicy ? effectivePolicy.cancellationFee : 0;
      const providerRefundable = effectivePolicy
        ? effectivePolicy.providerCancellationRefundable !== false
        : true;
      const calc = policy.cancelCalc({
        totalRupees: total,
        paidRupees: netPaid,
        feeRupees: actorType === 'provider' && !providerRefundable ? 0 : feeRupees,
        cutoffHours,
        startAt: booking.startAt || booking.scheduledAt || booking.createdAt,
        cancelledBy: actorType === 'provider' ? 'provider' : 'customer',
      });
      if (calc.refund > 0) {
        refundRequest = await LocalServiceRefundRequest.create({
          booking: booking._id,
          payment: booking.payment || undefined,
          requestedAmount: calc.refund,
          reason: reason || 'cancelled',
          status: 'requested',
        });
      }
    } catch (e) {
      console.error('LocalServices refund request failed:', e.message);
    }
  }
  // Notifications: best-effort, never fail the transition.
  try {
    const { notifyUser } = require('./localservice.notify.service');
    const titles = { CONFIRMED: 'Booking confirmed', IN_PROGRESS: 'Service started', COMPLETED: 'Service completed', CANCELLED: 'Booking cancelled', DISPUTED: 'Booking disputed', ACCEPTED: 'Provider accepted' };
    if (titles[to]) {
      await notifyUser({ userId: booking.customer, title: titles[to], content: `${titles[to]} — ${booking.bookingCode}`, payload: { bookingId: String(booking._id), status: to } });
    }
  } catch (e) {
    console.error('LocalServices notify failed:', e.message);
  }
  return { booking, revenue, refundRequest };
}

module.exports = { canTransition, assertTransition, canActorTransition, assertActorTransition, ACTOR_TRANSITIONS, buildBookingCode, transitionBooking };
