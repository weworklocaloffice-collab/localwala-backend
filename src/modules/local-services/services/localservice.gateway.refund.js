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
 * localservice.gateway.refund — thin gateway refund seam.
 *
 * The shared payment stack verifies and captures payments but exposes no
 * generic "refund this capture" API: food refunds live in
 * `src/services/refund.request.service.js` and jhatka has its own adapter.
 * Rather than reach across a module boundary, Local Services owns a small
 * adapter here that speaks the SAME gateway protocols (Razorpay's documented
 * `POST /v1/payments/:id/refund`), reads credentials from the very same
 * `PaymentConfig` row the capture used, and is injectable so it can be
 * proven without credentials or a network.
 *
 * Amounts are PAISE (integers) in and out. Callers convert.
 */

const { status: httpStatus } = require('http-status');
const superagent = require('superagent');
const ApiError = require('../../../utils/ApiError');

const GATEWAYS = ['razorpay'];

/**
 * Resolve the gateway client.
 *
 * `client` may be injected, which is how the unit suite proves the refund
 * path without credentials. When nothing is injected, the credentials stored
 * on the `PaymentConfig` row that took the payment are used; environment
 * variables are the fallback for deployments that keep them centrally.
 */
function resolveClient(gateway, client, credentials) {
  if (client) return client;
  if (gateway === 'razorpay') {
    const fromConfig = credentials && credentials.key && credentials.secret ? credentials : null;
    const key = fromConfig ? fromConfig.key : process.env.RAZORPAY_KEY_ID;
    const secret = fromConfig ? fromConfig.secret : process.env.RAZORPAY_KEY_SECRET;
    if (!key || !secret) {
      throw new ApiError(
        httpStatus.SERVICE_UNAVAILABLE,
        'Razorpay is not configured: no PaymentConfig credentials and no RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET',
        true,
        '',
        { code: 'GATEWAY_NOT_CONFIGURED', gateway }
      );
    }
    return { key, secret };
  }
  throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, `Unsupported gateway: ${gateway}`, true, '', {
    code: 'GATEWAY_NOT_CONFIGURED',
    gateway,
  });
}

/**
 * Refund a captured payment.
 *
 * @param {object} opts
 * @param {string} opts.gateway — one of GATEWAYS
 * @param {string} opts.gatewayPaymentId — the gateway's captured payment id
 * @param {number} opts.amountPaise — refund amount in paise (positive integer)
 * @param {string} opts.idempotencyKey — unique key for this refund attempt
 * @param {object} opts.credentials — { key, secret } from PaymentConfig
 * @param {string} [opts.reason] — human reason, stored as gateway metadata
 * @param {object} [opts.client] — injected client, for tests
 * @returns {Promise<{gatewayRefundId: string, status: string, raw: object}>}
 */
async function refundPayment({
  gateway,
  gatewayPaymentId,
  amountPaise,
  idempotencyKey,
  credentials,
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

  const resolved = resolveClient(gateway, client, credentials);
  const auth = { key: resolved.key, secret: resolved.secret };

  if (gateway === 'razorpay') {
    const response = await superagent
      .post(`https://api.razorpay.com/v1/payments/${gatewayPaymentId}/refund`)
      .auth(auth.key, auth.secret)
      .send({ amount: amountPaise, notes: { idempotencyKey, reason: reason || '' } });
    const body = response.body || {};
    if (!body.id) {
      throw new ApiError(httpStatus.BAD_GATEWAY, 'Gateway refund returned no refund id');
    }
    return { gatewayRefundId: body.id, status: body.status || 'processed', raw: body };
  }

  throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, `Unsupported gateway: ${gateway}`);
}

/**
 * Pull the captured gateway payment id out of a PaymentInitiation's
 * `payResponse`. The shape differs per gateway and per flow (order creation
 * vs. verification), so every known field is checked.
 */
function resolveGatewayPaymentId(payResponse) {
  if (!payResponse || typeof payResponse !== 'object') return null;
  return (
    payResponse.razorpay_payment_id ||
    payResponse.payment_id ||
    payResponse.paymentId ||
    (payResponse.id && String(payResponse.id).startsWith('pay_') ? payResponse.id : null) ||
    payResponse.id ||
    null
  );
}

module.exports = { GATEWAYS, refundPayment, resolveGatewayPaymentId, resolveClient };
