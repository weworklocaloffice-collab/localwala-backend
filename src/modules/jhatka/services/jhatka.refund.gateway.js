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
 * jhatka.refund.gateway.js — thin refund gateway adapter. Phase 8.
 *
 * This is a SEAM for the future `src/services/gateway/` extraction (Phase 8).
 * Today it calls the existing triplicated refund pattern inline in the
 * codebase (razorpay/cashfree/phonepe branches). When Phase 8 lands,
 * only this file is rewritten to call the new service.
 *
 * All amounts in PAISE (integers). Idempotency key is mandatory.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/**
 * Supported gateway identifiers.
 */
const GATEWAYS = ['razorpay', 'cashfree', 'phonepe'];

/**
 * Resolve a gateway SDK, failing LOUDLY and LATE.
 *
 * The previous version did `require('razorpay')` inline at call time, unguarded. With
 * no SDK installed that throws `Cannot find module 'razorpay'` from inside a refund
 * sweep — a stack trace with no indication that a payment provider is simply not
 * configured. It also meant this file could not be loaded in a test at all.
 *
 * `client` may be injected, which is how `verify.jhatka.integration.js` proves the
 * gateway path works without credentials or a network.
 */
function resolveSdk(gateway, client) {
  if (client) return client;

  if (gateway === 'razorpay') {
    try {
      // eslint-disable-next-line global-require
      const Razorpay = require('razorpay');
      return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
    } catch (e) {
      throw new ApiError(
        httpStatus.SERVICE_UNAVAILABLE,
        'Razorpay is not configured: the razorpay SDK is not installed. Install it or inject a client.',
        true,
        '',
        { code: 'GATEWAY_SDK_MISSING', gateway, cause: e.message }
      );
    }
  }

  if (gateway === 'cashfree') {
    try {
      // eslint-disable-next-line global-require
      return require('../../../services/cashfree');
    } catch (e) {
      throw new ApiError(
        httpStatus.SERVICE_UNAVAILABLE,
        'Cashfree is not configured on this deployment',
        true,
        '',
        { code: 'GATEWAY_SDK_MISSING', gateway, cause: e.message }
      );
    }
  }

  try {
    // eslint-disable-next-line global-require
    return require('../../../services/phonepe');
  } catch (e) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      'PhonePe is not configured on this deployment',
      true,
      '',
      { code: 'GATEWAY_SDK_MISSING', gateway, cause: e.message }
    );
  }
}

/**
 * Refund a payment via the appropriate gateway.
 *
 * @param {object} opts
 * @param {string} opts.gateway — one of GATEWAYS
 * @param {string} opts.gatewayPaymentId — gateway's original payment/charge id
 * @param {number} opts.amountPaise — refund amount in paise (positive integer)
 * @param {string} opts.idempotencyKey — unique key for this refund attempt
 * @param {string} [opts.reason] — refund reason for gateway metadata
 * @param {object} [opts.client] — pre-built SDK instance, for tests
 * @returns {Promise<{gatewayRefundId: string, status: string, raw: object}>}
 */
async function refundPayment({
  gateway,
  gatewayPaymentId,
  amountPaise,
  idempotencyKey,
  reason,
  client,
}) {
  if (!GATEWAYS.includes(gateway)) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Unsupported gateway: ${gateway}`);
  }
  if (!gatewayPaymentId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'gatewayPaymentId required');
  }
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountPaise must be a positive integer');
  }
  if (!idempotencyKey) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'idempotencyKey required');
  }

  const sdk = resolveSdk(gateway, client);

  if (gateway === 'razorpay') {
    const refund = await sdk.payments.refund(gatewayPaymentId, {
      amount: amountPaise,
      notes: { idempotencyKey, reason },
    });
    return { gatewayRefundId: refund.id, status: refund.status, raw: refund };
  }

  if (gateway === 'cashfree') {
    // Cashfree expects amount in rupees (decimal)
    const refund = await sdk.refundPayment({
      orderId: gatewayPaymentId, // Cashfree uses orderId
      refundAmount: (amountPaise / 100).toFixed(2),
      refundId: idempotencyKey,
      refundNote: reason,
    });
    return { gatewayRefundId: refund.refundId, status: refund.refundStatus, raw: refund };
  }

  // phonepe
  const refund = await sdk.initiateRefund({
    transactionId: gatewayPaymentId,
    amount: amountPaise, // PhonePe expects paise
    merchantRefundId: idempotencyKey,
  });
  return { gatewayRefundId: refund.refundId, status: refund.state, raw: refund };
}

/**
 * Get refund status from gateway.
 *
 * @param {object} opts
 * @param {string} opts.gateway
 * @param {string} opts.gatewayRefundId
 * @param {object} [opts.client] — pre-built SDK instance, for tests
 * @returns {Promise<{status: string, raw: object}>}
 */
async function getRefundStatus({ gateway, gatewayRefundId, client }) {
  if (!GATEWAYS.includes(gateway)) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Unsupported gateway: ${gateway}`);
  }
  if (!gatewayRefundId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'gatewayRefundId required');
  }

  const sdk = resolveSdk(gateway, client);

  if (gateway === 'razorpay') {
    const refund = await sdk.refunds.fetch(gatewayRefundId);
    return { status: refund.status, raw: refund };
  }

  if (gateway === 'cashfree') {
    const refund = await sdk.getRefundStatus({ refundId: gatewayRefundId });
    return { status: refund.refundStatus, raw: refund };
  }

  const refund = await sdk.getRefundStatus({ refundId: gatewayRefundId });
  return { status: refund.state, raw: refund };
}

module.exports = {
  GATEWAYS,
  refundPayment,
  getRefundStatus,
};