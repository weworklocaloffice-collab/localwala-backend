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

const { markBookingPaid } = require('./localservice.payment.bridge.service');
const { notifyUser } = require('./localservice.notify.service');

/**
 * localservice.payment.service — gateway dispatch bridge (stores pattern).
 * Handles `paymentFrom:'localServiceBooking'`. Returns true when handled;
 * dispatch continues to real-estate/legacy otherwise. Replay-safe via bridge.
 */
const LS_PAYMENT_SUBJECTS = Object.freeze(['localServiceBooking']);

const isLsSubject = (paymentFrom) => LS_PAYMENT_SUBJECTS.includes(paymentFrom);

const routePaidCallback = async (payment) => {
  if (!payment || !isLsSubject(payment.paymentFrom)) return false;
  const bookingId = payment.localServiceBookingId || payment.localServiceBooking;
  if (!bookingId) {
    console.error('[ls.payment] localServiceBooking callback without booking id');
    return true;
  }
  const { booking } = await markBookingPaid({ bookingId, paymentId: payment._id || payment.id });
  await notifyUser({
    userId: booking.customer,
    title: 'Payment received',
    content: `Payment received for booking ${booking.bookingCode}`,
    payload: { bookingId: String(booking._id), kind: 'local_service_payment' },
  });
  return true;
};

module.exports = { LS_PAYMENT_SUBJECTS, isLsSubject, routePaidCallback };
