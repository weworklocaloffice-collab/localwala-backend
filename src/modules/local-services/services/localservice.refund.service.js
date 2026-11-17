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
 * localservice.refund.service — executes refunds, not just records them.
 *
 * ## Why this file exists
 *
 * The refund request used to end at "approved": the ledger was reversed and
 * the customer's money was left wherever it was, with a note saying the
 * gateway refund was manual. A refund the platform never performs is a
 * promise it does not keep.
 *
 * This service owns the cash leg:
 *
 *   gateway booking  -> call the gateway, record the refund id
 *   wallet booking   -> credit the shared wallet back, write the transaction
 *   cod/direct       -> the provider holds the cash; the platform records a
 *                       provider-credit obligation, it does not move money
 *
 * Two rules make it safe to retry:
 *
 *  1. **Never refund more than was collected.** `refundableAmount` caps the
 *     request at what is left of `amountPaid` after earlier refunds.
 *  2. **Never refund twice.** The refund request's status is the lock, and
 *     the booking carries `refundedAmount` so a second request cannot spend
 *     the same money again.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { toPaise, fromPaise } = require('../../../utils/money');
const gatewayRefund = require('./localservice.gateway.refund');

/**
 * Money still refundable on a booking, in rupees.
 *
 * @param {number} amountPaid total collected so far
 * @param {number} refundedAmount already refunded
 * @param {number} requestedAmount what this request asks for
 */
function refundableAmount({ amountPaid, refundedAmount, requestedAmount }) {
  const paid = Number(amountPaid || 0);
  const already = Number(refundedAmount || 0);
  const asked = Number(requestedAmount || 0);
  const remaining = Math.max(0, Number((paid - already).toFixed(2)));
  return Number(Math.min(asked, remaining).toFixed(2));
}

/**
 * Which cash leg applies to a booking.
 *
 * `cod` and `direct` are collected by the provider in the field, so the
 * platform has no money to move back — the obligation is the provider's.
 */
function resolveRefundMode(booking) {
  const mode = String((booking && booking.paymentMode) || 'gateway');
  if (mode === 'gateway') return 'gateway';
  if (mode === 'wallet') return 'wallet';
  return 'provider_credit';
}

/**
 * Load a document, tolerating a model stub without `.lean()`.
 *
 * The unit suite injects plain-object models; production models are real.
 * A missing `.lean()` must not crash a refund.
 */
async function loadDoc(Model, id) {
  if (!id) return null;
  const query = Model.findById(id);
  const doc = query && typeof query.lean === 'function' ? await query.lean() : await query;
  return doc || null;
}

const PROCESSING_LEASE_MS = 30 * 60 * 1000;

async function claimRefund(Refund, refund, refundId) {
  if (typeof Refund.findOneAndUpdate === 'function') {
    const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
    return Refund.findOneAndUpdate(
      {
        _id: refundId,
        $or: [
          { status: { $in: ['approved', 'failed'] } },
          {
            status: 'processing',
            $or: [
              { processingAt: { $lte: staleBefore } },
              { processingAt: null },
              { processingAt: { $exists: false } },
            ],
          },
        ],
      },
      { $set: { status: 'processing', processingAt: new Date(), failureReason: undefined } },
      { new: true }
    );
  }
  if (!['approved', 'failed', 'processing'].includes(refund.status)) return null;
  refund.status = 'processing';
  refund.processingAt = new Date();
  refund.failureReason = undefined;
  await refund.save();
  return refund;
}

async function reserveRefundAmount(Booking, booking, amount) {
  const amountPaise = toPaise(amount);
  if (Booking.collection && typeof Booking.collection.findOneAndUpdate === 'function') {
    const raw = await Booking.collection.findOneAndUpdate(
      {
        _id: booking._id,
        $expr: {
          $lte: [
            { $add: [{ $ifNull: ['$refundedAmount', 0] }, amountPaise] },
            { $ifNull: ['$amountPaid', 0] },
          ],
        },
      },
      { $inc: { refundedAmount: amountPaise } },
      { returnDocument: 'after' }
    );
    const updated = raw && raw.value !== undefined ? raw.value : raw;
    return updated || null;
  }
  const paid = toPaise(booking.amountPaid || 0);
  const already = toPaise(booking.refundedAmount || 0);
  if (already + amountPaise > paid) return null;
  booking.refundedAmount = fromPaise(already + amountPaise);
  if (typeof booking.save === 'function') await booking.save();
  return booking;
}

async function releaseRefundAmount(Booking, bookingId, amount, booking) {
  const amountPaise = toPaise(amount);
  if (Booking.collection && typeof Booking.collection.updateOne === 'function') {
    const result = await Booking.collection.updateOne(
      { _id: bookingId, refundedAmount: { $gte: amountPaise } },
      { $inc: { refundedAmount: -amountPaise } }
    );
    return result.matchedCount === 1;
  }
  if (!booking) return false;
  const next = Math.max(0, Number((Number(booking.refundedAmount || 0) - Number(amount)).toFixed(2)));
  booking.refundedAmount = next;
  if (typeof booking.save === 'function') await booking.save();
  return true;
}

async function markBookingRefundStatus(Booking, bookingId, booking, paymentStatus) {
  if (typeof Booking.updateOne === 'function') {
    await Booking.updateOne({ _id: bookingId }, { $set: { paymentStatus } });
  }
  if (booking) booking.paymentStatus = paymentStatus;
}

/**
 * Execute an approved refund.
 *
 * @param {object} opts
 * @param {string} opts.refundId refund request id
 * @param {string} [opts.actorId] admin who approved it
 * @param {object} [opts.gatewayRefund] injected gateway caller (tests)
 * @param {object} [opts.walletCredit] injected wallet credit (tests)
 * @returns {Promise<{refund: object, booking: object, amount: number, mode: string, reference: string}>}
 */
async function executeRefund(
  { refundId, actorId = null, manualReference = null, gatewayRefund: gatewayCall, walletCredit: walletCall } = {},
  {
    RefundModel,
    BookingModel,
    PaymentInitiationModel,
    PaymentConfigModel,
    gatewayRefund: gatewayCallAlt,
    walletCredit: walletCallAlt,
  } = {}
) {
  const Refund = RefundModel || require('../models/localservice.catalog.ext.model').LocalServiceRefundRequest;
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const PaymentInitiation =
    PaymentInitiationModel || require('../../../models/payment.initiation.model');
  const PaymentConfig = PaymentConfigModel || require('../../../models/payment.config.model');
  const gatewayFn = gatewayCall || gatewayCallAlt || gatewayRefund.refundPayment;
  const walletFn = walletCall || walletCallAlt;

  const loaded = await Refund.findById(refundId);
  if (!loaded) throw new ApiError(httpStatus.NOT_FOUND, 'Refund request not found');
  if (!['approved', 'processing', 'failed'].includes(loaded.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Refund is ${loaded.status}, not executable`);
  }

  const refund = await claimRefund(Refund, loaded, refundId);
  if (!refund) throw new ApiError(httpStatus.CONFLICT, 'Refund is already being processed');

  const booking = await Booking.findById(refund.booking);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');

  const reserved = Number(refund.reservedAmount || 0);
  const requested = Number(refund.approvedAmount || refund.requestedAmount || 0);
  const remaining = Math.max(0, Number((Number(booking.amountPaid || 0) - Number(booking.refundedAmount || 0)).toFixed(2)));
  if (reserved <= 0 && requested > remaining + 0.005) {
    refund.status = 'failed';
    refund.failureReason = 'Refund exceeds the remaining collected amount';
    refund.processingAt = undefined;
    await refund.save();
    throw new ApiError(httpStatus.CONFLICT, 'Refund exceeds the remaining collected amount');
  }
  let amount = reserved > 0
    ? reserved
    : refundableAmount({
      amountPaid: booking.amountPaid,
      refundedAmount: booking.refundedAmount,
      requestedAmount: refund.approvedAmount || refund.requestedAmount,
    });
  if (!(amount > 0)) {
    refund.status = 'failed';
    refund.failureReason = 'Nothing left to refund on this booking';
    refund.processingAt = undefined;
    await refund.save();
    throw new ApiError(httpStatus.CONFLICT, 'Nothing left to refund on this booking');
  }

  const cashAlreadyMoved = Boolean(refund.gatewayRefundReference) && Number(refund.completedAmount || 0) > 0;
  let reservedNow = false;
  if (!cashAlreadyMoved && !(reserved > 0)) {
    const reservedBooking = await reserveRefundAmount(Booking, booking, amount);
    if (!reservedBooking) {
      refund.status = 'failed';
      refund.failureReason = 'Refund exceeds the remaining collected amount';
      refund.processingAt = undefined;
      await refund.save();
      throw new ApiError(httpStatus.CONFLICT, 'Refund exceeds the remaining collected amount');
    }
    reservedNow = true;
    refund.reservedAmount = amount;
    try {
      await refund.save();
    } catch (e) {
      await releaseRefundAmount(Booking, booking._id, amount, booking);
      throw e;
    }
  }

  const mode = resolveRefundMode(booking);
  let reference = refund.gatewayRefundReference || '';
  if (!cashAlreadyMoved) {
    try {
      if (manualReference !== undefined && manualReference !== null) {
        reference = String(manualReference).trim();
        if (!reference) throw new ApiError(httpStatus.BAD_REQUEST, 'gatewayRefundReference required');
      } else if (mode === 'gateway') {
        const initiationId = (booking.payments && booking.payments.length
          ? booking.payments[booking.payments.length - 1]
          : booking.payment) || refund.payment;
        const initiation = await loadDoc(PaymentInitiation, initiationId);
        if (!initiation) throw new ApiError(httpStatus.CONFLICT, 'No payment found to refund');
        const gatewayPaymentId = gatewayRefund.resolveGatewayPaymentId(initiation.payResponse);
        if (!gatewayPaymentId) {
          throw new ApiError(httpStatus.CONFLICT, 'Gateway payment id is missing on this payment');
        }
        const config = await loadDoc(PaymentConfig, initiation.payment);
        if (!config || !config.credentials) {
          throw new ApiError(httpStatus.CONFLICT, 'Payment gateway configuration is missing');
        }
        const call = gatewayFn;
        const result = await call({
          gateway: config.slug || 'razorpay',
          gatewayPaymentId,
          amountPaise: toPaise(amount),
          idempotencyKey: `lsrefund:${refund._id}`,
          credentials: config.credentials,
          reason: refund.reason || 'local-services-refund',
        });
        reference = result.gatewayRefundId || '';
      } else if (mode === 'wallet') {
        const credit = walletFn || require('./localservice.wallet.refund').creditWallet;
        const result = await credit({
          userId: booking.customer,
          amountRupees: amount,
          bookingCode: booking.bookingCode,
          reason: refund.reason || 'local-services-refund',
          idempotencyKey: `LS-WALLET-REFUND:${refund._id}`,
        });
        reference = result.transactionId || result.reference || '';
      } else {
        // COD / direct: the provider collected the cash in the field. The
        // platform records the obligation; it does not move money it never had.
        reference = `provider-credit:${booking.bookingCode}`;
      }
    } catch (e) {
      const released = reserved > 0 || reservedNow
        ? await releaseRefundAmount(Booking, booking._id, amount, booking).catch(() => false)
        : true;
      refund.status = 'failed';
      refund.reservedAmount = released ? 0 : amount;
      refund.processingAt = undefined;
      refund.failureReason = String(e.message || e).slice(0, 500);
      await refund.save();
      throw e;
    }

    refund.gatewayRefundReference = reference;
    refund.completedAmount = amount;
    await refund.save();
  }

  const currentBooking = (await Booking.findById(booking._id)) || booking;
  const refunded = Number(currentBooking.refundedAmount || 0);
  const paid = Number(currentBooking.amountPaid || 0);
  const paymentStatus = refunded + 0.01 >= paid ? 'refunded' : 'partially_refunded';
  await markBookingRefundStatus(Booking, booking._id, currentBooking, paymentStatus);

  refund.status = 'completed';
  refund.reservedAmount = 0;
  refund.processingAt = undefined;
  refund.completedAmount = amount;
  refund.completedAt = new Date();
  refund.failureReason = undefined;
  await refund.save();

  return { refund, booking: currentBooking, amount, mode, reference, actorId };
}

/**
 * Cancel-side refund math: how much of the collected money a cancellation
 * returns, in rupees. Provider cancellations return everything; customer
 * cancellations inside the policy cutoff return everything, and outside it
 * the policy fee is retained.
 */
function cancellationRefundable({ amountPaid, refundedAmount, feeRupees = 0, policyRefund = null }) {
  const paid = Number(amountPaid || 0);
  const already = Number(refundedAmount || 0);
  const remaining = Math.max(0, Number((paid - already).toFixed(2)));
  if (policyRefund != null) {
    return Number(Math.min(Math.max(0, Number(policyRefund)), remaining).toFixed(2));
  }
  const fee = Math.min(Number(feeRupees || 0), remaining);
  return Number((remaining - fee).toFixed(2));
}

module.exports = { executeRefund, refundableAmount, resolveRefundMode, cancellationRefundable, fromPaise };
