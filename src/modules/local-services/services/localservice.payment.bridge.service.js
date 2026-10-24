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

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

async function markBookingPaid(
  { bookingId, paymentId, amount } = {},
  { BookingModel, ReservationModel, bookingService, PaymentInitiationModel } = {}
) {
  if (!bookingId) throw new ApiError(httpStatus.BAD_REQUEST, 'bookingId required');
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const Reservation = ReservationModel || require('../models/localservice.reservation.model');
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');

  const paymentKey = paymentId ? String(paymentId) : '';
  const alreadyRecorded =
    paymentKey &&
    (booking.payments || []).some((id) => String(id) === paymentKey);
  if (alreadyRecorded || booking.paymentStatus === 'paid') {
    return {
      booking,
      deduped: true,
      confirmed: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status),
    };
  }

  const total = Number(booking.serviceValue || 0);
  let paidNow = Number(amount || 0);
  if (!(paidNow > 0) && paymentKey) {
    try {
      const Initiation = PaymentInitiationModel || require('../../../models/payment.initiation.model');
      const initiation = await Initiation.findById(paymentKey);
      if (initiation) paidNow = Number(initiation.amount || 0);
    } catch {
      // Test stubs / lookup failure: fall through to booking amounts.
    }
  }
  if (!(paidNow > 0)) {
    const previous = Number(booking.amountPaid || 0);
    const deposit = Number(booking.depositAmount || 0);
    paidNow = previous <= 0 && deposit > 0 ? deposit : Math.max(0, total - previous);
  }

  const previousPaid = Number(booking.amountPaid || 0);
  const newPaid = Math.min(total, Number((previousPaid + paidNow).toFixed(2)));
  booking.amountPaid = newPaid;
  booking.paymentStatus = newPaid + 0.01 >= total ? 'paid' : 'partially_paid';
  if (paymentKey) {
    booking.payment = paymentKey;
    booking.payments = [...(booking.payments || []), paymentKey];
  }
  await booking.save();

  await Reservation.updateMany(
    { booking: booking._id, status: 'held' },
    { $set: { status: 'confirmed' } }
  );

  if (booking.status === 'PAYMENT_PENDING') {
    const service = bookingService || require('./localservice.booking.service');
    const { booking: confirmed } = await service.transitionBooking(booking._id, 'CONFIRMED', {
      reason: 'payment received',
      actorType: 'system',
    });
    return { booking: confirmed, deduped: false, confirmed: true };
  }

  return {
    booking,
    deduped: false,
    confirmed: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status),
  };
}

/**
 * Mark a booking paid from the platform wallet.
 *
 * The gateway path records a `PaymentInitiation` id; a wallet debit has no
 * gateway entity, so the wallet `Transactions` row is the reference. The
 * money semantics are identical: `amountPaid` grows, the payment status
 * follows, the capacity hold is confirmed and a pending booking moves to
 * CONFIRMED.
 */
async function markBookingPaidFromWallet(
  { bookingId, amount, transactionId } = {},
  { BookingModel, ReservationModel, bookingService } = {}
) {
  if (!bookingId) throw new ApiError(httpStatus.BAD_REQUEST, 'bookingId required');
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const Reservation = ReservationModel || require('../models/localservice.reservation.model');
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');

  const alreadyRecorded =
    transactionId && (booking.walletPayments || []).some((id) => String(id) === String(transactionId));  if (alreadyRecorded || booking.paymentStatus === 'paid') {
    return {
      booking,
      deduped: true,
      confirmed: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status),
    };
  }

  const total = Number(booking.serviceValue || 0);
  const paidNow = Number(amount || 0);
  if (!(paidNow > 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amount required');
  }
  const previousPaid = Number(booking.amountPaid || 0);
  const newPaid = Math.min(total, Number((previousPaid + paidNow).toFixed(2)));
  booking.amountPaid = newPaid;
  booking.paymentStatus = newPaid + 0.01 >= total ? 'paid' : 'partially_paid';
  if (transactionId) {
    booking.walletPayments = [...(booking.walletPayments || []), transactionId];
  }
  await booking.save();

  await Reservation.updateMany(
    { booking: booking._id, status: 'held' },
    { $set: { status: 'confirmed' } }
  );

  if (booking.status === 'PAYMENT_PENDING') {
    const service = bookingService || require('./localservice.booking.service');
    const { booking: confirmed } = await service.transitionBooking(booking._id, 'CONFIRMED', {
      reason: 'wallet payment received',
      actorType: 'system',
    });
    return { booking: confirmed, deduped: false, confirmed: true };
  }

  return {
    booking,
    deduped: false,
    confirmed: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status),
  };
}

module.exports = { markBookingPaid, markBookingPaidFromWallet };
