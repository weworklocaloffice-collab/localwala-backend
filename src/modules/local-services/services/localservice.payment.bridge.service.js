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

/**
 * localservice.payment.bridge.service — gateway -> booking hook point.
 *
 * The gateway controller (payment.initiation.controller.js) stays vertical-
 * agnostic: on verified `paymentFrom:'localServiceBooking'` it calls
 * markBookingPaid() below. Booking itself does NOT auto-confirm — the next
 * explicit transition (PAYMENT_PENDING -> CONFIRMED) still applies, so a
 * verified payment never strands a booking and never confirms one silently.
 * Idempotent: repeat callbacks return the same booking.
 */
async function markBookingPaid({ bookingId, paymentId } = {}, { BookingModel } = {}) {
  if (!bookingId) throw new ApiError(httpStatus.BAD_REQUEST, 'bookingId required');
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (booking.paymentStatus === 'paid' && String(booking.payment || '') === String(paymentId || '')) {
    return { booking, deduped: true };
  }
  booking.paymentStatus = 'paid';
  if (paymentId) booking.payment = paymentId;
  await booking.save();
  return { booking, deduped: false };
}

module.exports = { markBookingPaid };
