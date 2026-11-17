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

const CONFIRMED_STATUSES = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];

const finishPayment = async ({ Booking, Reservation, bookingService, booking, reason }) => {
  if (!booking || booking.status !== 'PAYMENT_PENDING') return booking;
  await Reservation.updateMany(
    { booking: booking._id, status: 'held' },
    { $set: { status: 'confirmed' } }
  );
  const service = bookingService || require('./localservice.booking.service');
  try {
    const { booking: confirmed } = await service.transitionBooking(booking._id, 'CONFIRMED', {
      reason,
      actorType: 'system',
    });
    return confirmed;
  } catch (error) {
    if (error && error.statusCode === httpStatus.CONFLICT) {
      const fresh = await Booking.findById(booking._id);
      if (fresh && CONFIRMED_STATUSES.includes(fresh.status)) return fresh;
    }
    throw error;
  }
};

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
    const finished = await finishPayment({
      Booking,
      Reservation,
      bookingService,
      booking,
      reason: 'payment replayed',
    });
    return {
      booking: finished,
      deduped: true,
      confirmed: CONFIRMED_STATUSES.includes(finished.status),
    };
  }

  const total = Number(booking.serviceValue || 0);
  let paidNow = 0;
  if (paymentKey) {
    try {
      const Initiation = PaymentInitiationModel || require('../../../models/payment.initiation.model');
      const initiation = await Initiation.findById(paymentKey);
      if (initiation) {
        if (
          initiation.localServiceBooking &&
          String(initiation.localServiceBooking) !== String(booking._id)
        ) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Payment does not belong to this booking');
        }
        paidNow = Number(initiation.amount || 0);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
  }
  if (!(paidNow > 0)) paidNow = Number(amount || 0);
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
  try {
    await booking.save();
  } catch (error) {
    if (error && error.name === 'VersionError') {
      const fresh = await Booking.findById(bookingId);
      if (fresh && (fresh.payments || []).some((id) => String(id) === paymentKey)) {
        return {
          booking: fresh,
          deduped: true,
          confirmed: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(fresh.status),
        };
      }
      throw new ApiError(httpStatus.CONFLICT, 'BOOKING_PAYMENT_CONFLICT');
    }
    throw error;
  }

  const finished = await finishPayment({
    Booking,
    Reservation,
    bookingService,
    booking,
    reason: 'payment received',
  });

  return {
    booking: finished,
    deduped: false,
    confirmed: CONFIRMED_STATUSES.includes(finished.status),
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
    transactionId &&
    (booking.walletPayments || []).some((id) => String(id) === String(transactionId));
  if (alreadyRecorded || booking.paymentStatus === 'paid') {
    const finished = await finishPayment({
      Booking,
      Reservation,
      bookingService,
      booking,
      reason: 'wallet payment replayed',
    });
    return {
      booking: finished,
      deduped: true,
      confirmed: CONFIRMED_STATUSES.includes(finished.status),
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
  try {
    await booking.save();
  } catch (error) {
    if (error && error.name === 'VersionError') {
      const fresh = await Booking.findById(bookingId);
      if (
        fresh &&
        transactionId &&
        (fresh.walletPayments || []).some((id) => String(id) === String(transactionId))
      ) {
        return {
          booking: fresh,
          deduped: true,
          confirmed: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(fresh.status),
        };
      }
      throw new ApiError(httpStatus.CONFLICT, 'BOOKING_PAYMENT_CONFLICT');
    }
    throw error;
  }

  const finished = await finishPayment({
    Booking,
    Reservation,
    bookingService,
    booking,
    reason: 'wallet payment received',
  });

  return {
    booking: finished,
    deduped: false,
    confirmed: CONFIRMED_STATUSES.includes(finished.status),
  };
}

module.exports = { markBookingPaid, markBookingPaidFromWallet };
