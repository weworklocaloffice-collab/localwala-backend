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
  { refundId, actorId = null, gatewayRefund: gatewayCall, walletCredit: walletCall } = {},
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

  const refund = await Refund.findById(refundId);
  if (!refund) throw new ApiError(httpStatus.NOT_FOUND, 'Refund request not found');
  if (!['approved', 'processing', 'failed'].includes(refund.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Refund is ${refund.status}, not executable`);
  }

  const booking = await Booking.findById(refund.booking);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');

  const amount = refundableAmount({
    amountPaid: booking.amountPaid,
    refundedAmount: booking.refundedAmount,
    requestedAmount: refund.approvedAmount || refund.requestedAmount,
  });
  if (!(amount > 0)) {
    throw new ApiError(httpStatus.CONFLICT, 'Nothing left to refund on this booking');
  }

  // Claim the request: only one execution may be in flight at a time.
  if (refund.status !== 'processing') {
    refund.status = 'processing';
    await refund.save();
  }

  const mode = resolveRefundMode(booking);
  let reference;
  try {
    if (mode === 'gateway') {
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
      const credit = walletFn || require('./localservice.wallet.refund');
      const result = await credit({
        userId: booking.customer,
        amountRupees: amount,
        bookingCode: booking.bookingCode,
        reason: refund.reason || 'local-services-refund',
      });
      reference = result.transactionId || result.reference || '';
    } else {
      // COD / direct: the provider collected the cash in the field. The
      // platform records the obligation; it does not move money it never had.
      reference = `provider-credit:${booking.bookingCode}`;
    }
  } catch (e) {
    refund.status = 'failed';
    refund.failureReason = String(e.message || e).slice(0, 500);
    await refund.save();
    throw e;
  }

  const refunded = Number((Number(booking.refundedAmount || 0) + amount).toFixed(2));
  booking.refundedAmount = refunded;
  booking.paymentStatus = refunded + 0.01 >= Number(booking.amountPaid || 0) ? 'refunded' : 'partially_refunded';
  await booking.save();

  refund.status = 'completed';
  refund.gatewayRefundReference = reference;
  refund.completedAmount = amount;
  refund.completedAt = new Date();
  refund.failureReason = undefined;
  await refund.save();

  return { refund, booking, amount, mode, reference, actorId };
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
