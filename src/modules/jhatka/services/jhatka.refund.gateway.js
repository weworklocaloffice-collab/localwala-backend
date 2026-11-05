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
 * The settlement resolves the SAME `PaymentConfig` row that took the payment and
 * passes its `credentials` here. This adapter speaks the gateway protocols the rest
 * of the platform already uses (see `localservice.gateway.refund.js` and
 * `src/services/refund.request.service.js`) over HTTP — no provider SDK is required,
 * and the admin-managed config is the source of truth rather than environment
 * variables (env remains a fallback for Razorpay deployments that keep keys there).
 *
 * Amounts are PAISE (integers) in and out. Idempotency key is mandatory.
 *
 * `transport` is injectable so the suite can prove the request shape (URL, auth,
 * amount) without credentials or a network.
 */

const { status: httpStatus } = require('http-status');
const superagent = require('superagent');
const ApiError = require('../../../utils/ApiError');

/**
 * Supported gateway identifiers. PhonePe is accepted by the enum but has no
 * implemented refund API on this deployment; it fails with an actionable error
 * rather than a missing-module stack trace.
 */
const GATEWAYS = ['razorpay', 'cashfree', 'phonepe'];

const CASHFREE_DEFAULT_API_VERSION = '2023-08-01';

// A hung provider must surface as a TIMEOUT, because the settlement treats a
// timeout as UNKNOWN (retry with the same key) rather than a refusal (park).
const RESPONSE_TIMEOUT_MS = 20000;
const DEADLINE_TIMEOUT_MS = 30000;

/**
 * Razorpay credentials from the `PaymentConfig` row, falling back to env for
 * deployments that keep the key pair centrally.
 */
function razorpayAuth(credentials) {
  const fromConfig = credentials && credentials.key && credentials.secret ? credentials : null;
  const key = fromConfig ? fromConfig.key : process.env.RAZORPAY_KEY_ID;
  const secret = fromConfig ? fromConfig.secret : process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      'Razorpay is not configured: the PaymentConfig row has no key/secret and RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are unset',
      true,
      '',
      { code: 'GATEWAY_NOT_CONFIGURED', gateway: 'razorpay' }
    );
  }
  return { key, secret };
}

/** Cashfree credentials from the same admin-managed row. */
function cashfreeAuth(credentials) {
  if (!credentials || !credentials.appId || !credentials.secretKey) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      'Cashfree is not configured: the PaymentConfig row has no appId/secretKey',
      true,
      '',
      { code: 'GATEWAY_NOT_CONFIGURED', gateway: 'cashfree' }
    );
  }
  return {
    appId: credentials.appId,
    secretKey: credentials.secretKey,
    apiVersion: credentials.apiVersion || CASHFREE_DEFAULT_API_VERSION,
  };
}

/**
 * One transport call. The default is superagent; tests inject a function that
 * records `{ method, url, auth, headers, body }` and returns `{ body }`.
 */
async function send({ transport, method, url, auth, headers, body }) {
  if (transport) return transport({ method, url, auth, headers, body });

  let request = method === 'GET' ? superagent.get(url) : superagent.post(url);
  request = request.timeout({ response: RESPONSE_TIMEOUT_MS, deadline: DEADLINE_TIMEOUT_MS });
  if (auth) request = request.auth(auth.key, auth.secret);
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) request = request.set(name, value);
    }
  }
  if (body !== undefined) request = request.send(body);
  return request;
}

/**
 * Refund a payment via the appropriate gateway.
 *
 * @param {object} opts
 * @param {string} opts.gateway — one of GATEWAYS
 * @param {string} opts.gatewayPaymentId — gateway's original payment/charge id
 *   (Cashfree: the order id)
 * @param {number} opts.amountPaise — refund amount in paise (positive integer)
 * @param {string} opts.idempotencyKey — unique key for this refund attempt
 * @param {object} [opts.credentials] — { key, secret } or { appId, secretKey, apiVersion }
 *   from the payment's PaymentConfig row
 * @param {boolean} [opts.environment] — PaymentConfig live flag (Cashfree URL)
 * @param {string} [opts.reason] — refund reason for gateway metadata
 * @param {Function} [opts.transport] — injected HTTP transport, for tests
 * @returns {Promise<{gatewayRefundId: string, status: string, raw: object}>}
 */
async function refundPayment({
  gateway,
  gatewayPaymentId,
  amountPaise,
  idempotencyKey,
  credentials,
  environment,
  reason,
  transport,
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

  if (gateway === 'razorpay') {
    const auth = razorpayAuth(credentials);
    const response = await send({
      transport,
      method: 'POST',
      url: `https://api.razorpay.com/v1/payments/${encodeURIComponent(gatewayPaymentId)}/refund`,
      auth,
      headers: {
        'Content-Type': 'application/json',
        // Razorpay's refund idempotency header (min 10 chars, [A-Za-z0-9_-]).
        // Without it, a timeout retry is a SECOND refund, not the same one.
        'X-Refund-Idempotency': idempotencyKey,
      },
      body: { amount: amountPaise, notes: { idempotencyKey, reason: reason || '' } },
    });
    const body = (response && response.body) || {};
    if (!body.id) {
      throw new ApiError(httpStatus.BAD_GATEWAY, 'Gateway refund returned no refund id');
    }
    return { gatewayRefundId: body.id, status: body.status || 'processed', raw: body };
  }

  if (gateway === 'cashfree') {
    // Cashfree refunds are addressed by ORDER id, and the amount is rupees.
    const auth = cashfreeAuth(credentials);
    const base = environment === true ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    const response = await send({
      transport,
      method: 'POST',
      url: `${base}/pg/orders/${encodeURIComponent(gatewayPaymentId)}/refunds`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': auth.apiVersion,
        'x-client-id': auth.appId,
        'x-client-secret': auth.secretKey,
      },
      body: {
        refund_amount: (amountPaise / 100).toFixed(2),
        refund_id: idempotencyKey,
        refund_note: reason || '',
        refund_speed: 'STANDARD',
      },
    });
    const body = (response && response.body) || {};
    const refundId = body.cf_refund_id || body.refund_id || body.id;
    if (!refundId) {
      throw new ApiError(httpStatus.BAD_GATEWAY, 'Cashfree refund returned no refund id');
    }
    return {
      gatewayRefundId: String(refundId),
      status: body.refund_status || body.status || 'processed',
      raw: body,
    };
  }

  throw new ApiError(
    httpStatus.SERVICE_UNAVAILABLE,
    'PhonePe refunds are not implemented on this deployment',
    true,
    '',
    { code: 'GATEWAY_NOT_CONFIGURED', gateway }
  );
}

/**
 * Get refund status from gateway.
 *
 * Used by operators/reconciliation, not by the settlement queue (which trusts the
 * refund response). Razorpay exposes a refund by id; Cashfree requires the parent
 * order id, which this signature does not carry, so it reports unsupported.
 *
 * @param {object} opts
 * @param {string} opts.gateway
 * @param {string} opts.gatewayRefundId
 * @param {object} [opts.credentials]
 * @param {Function} [opts.transport] — injected HTTP transport, for tests
 * @returns {Promise<{status: string, raw: object}>}
 */
async function getRefundStatus({ gateway, gatewayRefundId, credentials, transport }) {
  if (!GATEWAYS.includes(gateway)) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Unsupported gateway: ${gateway}`);
  }
  if (!gatewayRefundId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'gatewayRefundId required');
  }

  if (gateway === 'razorpay') {
    const auth = razorpayAuth(credentials);
    const response = await send({
      transport,
      method: 'GET',
      url: `https://api.razorpay.com/v1/refunds/${encodeURIComponent(gatewayRefundId)}`,
      auth,
    });
    const body = (response && response.body) || {};
    return { status: body.status || 'unknown', raw: body };
  }

  throw new ApiError(
    httpStatus.SERVICE_UNAVAILABLE,
    `Refund status is not implemented for ${gateway} on this deployment`,
    true,
    '',
    { code: 'GATEWAY_NOT_CONFIGURED', gateway }
  );
}

module.exports = {
  GATEWAYS,
  refundPayment,
  getRefundStatus,
};
