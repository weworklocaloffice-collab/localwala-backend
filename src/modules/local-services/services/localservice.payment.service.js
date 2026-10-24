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
const { markBookingPaid, markBookingPaidFromWallet } = require('./localservice.payment.bridge.service');
const { notifyUser } = require('./localservice.notify.service');

const LS_PAYMENT_SUBJECTS = Object.freeze(['localServiceBooking']);
const SELF_PAYABLE_MODES = Object.freeze(['INSTANT', 'SLOT', 'DATE_RANGE']);
const PAYABLE_STATUSES = Object.freeze(['DRAFT', 'ACCEPTED', 'PAYMENT_PENDING', 'CONFIRMED', 'IN_PROGRESS']);
// Modes the platform can actually collect through this service. `cod` and
// `direct` settle in the field and are marked paid at completion.
const COLLECTIBLE_MODES = Object.freeze(['gateway', 'wallet']);

const isLsSubject = (paymentFrom) => LS_PAYMENT_SUBJECTS.includes(paymentFrom);

/**
 * Amount due now: the configured deposit for the first payment, then the
 * remaining balance. No deposit => the full service value.
 */
const payableAmount = (booking) => {
  const total = Number(booking.serviceValue || 0);
  const paid = Number(booking.amountPaid || 0);
  const deposit = Number(booking.depositAmount || 0);
  const balance = Number(booking.balanceAmount || 0);
  if (paid <= 0 && deposit > 0 && balance > 0) return deposit;
  return Number(Math.max(0, total - paid).toFixed(2));
};

const assertBookingPayable = (booking, customerId) => {
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (String(booking.customer) !== String(customerId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  }
  if (!COLLECTIBLE_MODES.includes(booking.paymentMode)) {
    throw new ApiError(httpStatus.CONFLICT, `BOOKING_NOT_COLLECTIBLE: payment mode is ${booking.paymentMode}`);
  }
  if (booking.paymentStatus === 'paid') {
    throw new ApiError(httpStatus.CONFLICT, 'BOOKING_ALREADY_PAID');
  }
  if (booking.status === 'DRAFT' && !SELF_PAYABLE_MODES.includes(booking.bookingMode)) {
    throw new ApiError(httpStatus.CONFLICT, 'Provider must accept the booking before payment');
  }
  if (!PAYABLE_STATUSES.includes(booking.status)) {
    throw new ApiError(httpStatus.CONFLICT, `BOOKING_NOT_PAYABLE: status is ${booking.status}`);
  }
  if (!(Number(booking.serviceValue || 0) > 0)) {
    throw new ApiError(httpStatus.CONFLICT, 'BOOKING_HAS_NO_PAYABLE_AMOUNT');
  }
  const amount = payableAmount(booking);
  if (!(amount > 0)) {
    throw new ApiError(httpStatus.CONFLICT, 'BOOKING_HAS_NO_PAYABLE_AMOUNT');
  }
  return amount;
};

async function initiateBookingPayment(
  { bookingId, customerId, paymentConfigId, paymentRef } = {},
  {
    BookingModel,
    PaymentInitiationModel,
    PaymentConfigModel,
    bookingService,
    debitWallet,
    ReservationModel,
    markPaidFromWallet,
  } = {}
) {
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const PaymentInitiation = PaymentInitiationModel || require('../../../models/payment.initiation.model');
  const PaymentConfig = PaymentConfigModel || require('../../../models/payment.config.model');
  const bookingSvc = bookingService || require('./localservice.booking.service');

  const booking = await Booking.findById(bookingId);
  const amount = assertBookingPayable(booking, customerId);

  // Wallet mode settles immediately against the platform wallet: there is no
  // gateway intent and no redirect, so the debit and the booking update
  // happen in one call.
  if (booking.paymentMode === 'wallet') {
    if (['DRAFT', 'ACCEPTED'].includes(booking.status)) {
      await bookingSvc.transitionBooking(booking._id, 'PAYMENT_PENDING', {
        reason: 'wallet payment started',
        actorType: 'system',
      });
      booking.status = 'PAYMENT_PENDING';
    }
    const debit = debitWallet || require('./localservice.wallet.payment').debitWallet;
    const wallet = await debit({
      amountRupees: amount,
      userId: customerId,
      bookingCode: booking.bookingCode,
      reason: 'Local Services booking payment',
    });
    const paid = (markPaidFromWallet || markBookingPaidFromWallet)(
      {
        bookingId: booking._id,
        amount,
        transactionId: wallet.transactionId,
      },
      { BookingModel, ReservationModel, bookingService: bookingSvc }
    );
    await notifyUser({
      userId: booking.customer,
      title: 'Payment received',
      content: `Payment received for booking ${booking.bookingCode}`,
      payload: { bookingId: String(booking._id), kind: 'local_service_payment' },
    });
    return { initiation: null, booking: paid.booking, wallet };
  }

  const config = paymentConfigId
    ? await PaymentConfig.findById(paymentConfigId)
    : (await PaymentConfig.findOne({ status: true, isDefault: true })) ||
      (await PaymentConfig.findOne({ status: true }));
  if (!config || config.status === false) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment gateway not available');
  }

  const open = await PaymentInitiation.findOne({
    localServiceBooking: booking._id,
    paymentFrom: 'localServiceBooking',
    status: 'initiated',
  }).sort({ createdAt: -1 });

  // Only the pre-confirmation states move to PAYMENT_PENDING. A balance
  // payment on a CONFIRMED/IN_PROGRESS booking leaves the status untouched.
  if (['DRAFT', 'ACCEPTED'].includes(booking.status)) {
    await bookingSvc.transitionBooking(booking._id, 'PAYMENT_PENDING', {
      reason: 'payment initiated',
      actorType: 'system',
    });
    booking.status = 'PAYMENT_PENDING';
  }

  // Reuse an open intent only when it is for the same amount. A stale
  // full-payment intent must not be reused for a deposit (or vice versa).
  if (open && (open.amount == null || Number(open.amount) === amount)) {
    return { initiation: open, booking };
  }
  if (open) {
    open.status = 'cancelled';
    if (typeof open.save === 'function') await open.save();
  }

  const isBalance = Number(booking.amountPaid || 0) > 0;
  const initiation = await PaymentInitiation.create({
    user: customerId,
    payment: config._id,
    localServiceBookingId: String(booking._id),
    localServiceBooking: booking._id,
    amount,
    paymentRef: paymentRef || `LS-BOOKING-${booking.bookingCode}${isBalance ? `-BAL-${Math.round(amount * 100)}` : ''}`,
    paymentFrom: 'localServiceBooking',
  });

  return { initiation, booking };
}

async function getBookingPayment({ bookingId, customerId } = {}, { BookingModel, PaymentInitiationModel } = {}) {
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const PaymentInitiation = PaymentInitiationModel || require('../../../models/payment.initiation.model');
  const booking = await Booking.findOne({ _id: bookingId, customer: customerId });
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  const initiation = await PaymentInitiation.findOne({
    localServiceBooking: booking._id,
    paymentFrom: 'localServiceBooking',
  }).sort({ createdAt: -1 });
  return { booking, initiation: initiation || null };
}

const routePaidCallback = async (payment) => {
  if (!payment || !isLsSubject(payment.paymentFrom)) return false;
  const bookingId = payment.localServiceBookingId || payment.localServiceBooking;
  if (!bookingId) {
    console.error('[ls.payment] localServiceBooking callback without booking id');
    return true;
  }
  const { booking, deduped } = await markBookingPaid({
    bookingId,
    paymentId: payment._id || payment.id,
    amount: payment.amount,
  });
  if (!deduped) {
    await notifyUser({
      userId: booking.customer,
      title: 'Payment received',
      content: `Payment received for booking ${booking.bookingCode}`,
      payload: { bookingId: String(booking._id), kind: 'local_service_payment' },
    });
  }
  return true;
};

const routeFailedCallback = async (
  payment,
  reason,
  { BookingModel, ReservationModel } = {}
) => {
  if (!payment || !isLsSubject(payment.paymentFrom)) return false;
  const bookingId = payment.localServiceBookingId || payment.localServiceBooking;
  if (!bookingId) return true;

  const Booking = BookingModel || require('../models/localservice.booking.model');
  const Reservation = ReservationModel || require('../models/localservice.reservation.model');
  const booking = await Booking.findById(bookingId);
  if (!booking) return true;

  // A failed balance payment must not wipe an already-collected deposit.
  if (!['paid', 'partially_paid'].includes(booking.paymentStatus)) {
    booking.paymentStatus = 'failed';
    await booking.save();
  }
  await Reservation.updateMany(
    { booking: booking._id, status: 'held' },
    { $set: { status: 'released' } }
  );
  if (reason) {
    await notifyUser({
      userId: booking.customer,
      title: 'Payment failed',
      content: `Payment could not be completed for booking ${booking.bookingCode}`,
      payload: { bookingId: String(booking._id), kind: 'local_service_payment_failed', reason },
    });
  }
  return true;
};

module.exports = {
  LS_PAYMENT_SUBJECTS,
  SELF_PAYABLE_MODES,
  isLsSubject,
  assertBookingPayable,
  initiateBookingPayment,
  getBookingPayment,
  routePaidCallback,
  routeFailedCallback,
};
