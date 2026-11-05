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
 * localservice.gateway.payout — thin RazorpayX payout seam.
 *
 * Transfers settled funds to a provider's bank account via RazorpayX.
 * Reads credentials from the PaymentConfig row. Amounts are PAISE (integers).
 */

const { status: httpStatus } = require('http-status');
const superagent = require('superagent');
const ApiError = require('../../../utils/ApiError');

const GATEWAYS = ['razorpay'];

function resolveClient(gateway, client, credentials) {
  if (client) return client;
  if (gateway === 'razorpay') {
    const fromConfig = credentials && credentials.key && credentials.secret ? credentials : null;
    const key = fromConfig ? fromConfig.key : process.env.RAZORPAYX_KEY_ID;
    const secret = fromConfig ? fromConfig.secret : process.env.RAZORPAYX_KEY_SECRET;
    if (!key || !secret) {
      throw new ApiError(
        httpStatus.SERVICE_UNAVAILABLE,
        'RazorpayX is not configured: no PaymentConfig credentials and no RAZORPAYX_KEY_ID/RAZORPAYX_KEY_SECRET',
        true,
        '',
        { code: 'GATEWAY_NOT_CONFIGURED', gateway }
      );
    }
    return { key, secret };
  }
  throw new ApiError(httpStatus.BAD_REQUEST, `Unsupported gateway: ${gateway}`);
}

async function payout({ gateway, fundAccountId, amountPaise, referenceId, narration, accountNumber, client, credentials } = {}) {
  if (!GATEWAYS.includes(gateway)) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Unsupported gateway: ${gateway}`);
  }
  if (!fundAccountId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'fundAccountId required');
  }
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountPaise must be a positive integer');
  }
  if (!referenceId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'referenceId required');
  }

  const resolved = resolveClient(gateway, client, credentials);
  const auth = { key: resolved.key, secret: resolved.secret };

  if (gateway === 'razorpay') {
    const response = await superagent
      .post('https://api.razorpay.com/v1/payouts')
      .auth(auth.key, auth.secret)
      .send({
        account_number: accountNumber || process.env.RAZORPAYX_ACCOUNT_NUMBER,
        fund_account_id: fundAccountId,
        amount: amountPaise,
        currency: 'INR',
        mode: 'IMPS',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: referenceId,
        narration: narration || 'Local Services settlement payout',
      });
    const body = response.body || {};
    if (!body.id) {
      throw new ApiError(httpStatus.BAD_GATEWAY, 'Gateway payout returned no payout id');
    }
    return { gatewayPayoutId: body.id, status: body.status || 'processing', raw: body };
  }

  throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, `Unsupported gateway: ${gateway}`);
}

module.exports = { payout, resolveClient, GATEWAYS };
