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
 * verify.localservices.refund.units.js — refund execution units (no DB).
 * Run: node scripts/verify.localservices.refund.units.js
 */

const refundService = require('../src/modules/local-services/services/localservice.refund.service');
const gateway = require('../src/modules/local-services/services/localservice.gateway.refund');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` – ${detail}` : ''}`);
  }
};

// ---- 1. Refundable money is capped by what was collected -------------------
ok('refund cannot exceed collected', refundService.refundableAmount({ amountPaid: 500, refundedAmount: 0, requestedAmount: 900 }) === 500);
ok('refund subtracts earlier refunds', refundService.refundableAmount({ amountPaid: 500, refundedAmount: 200, requestedAmount: 900 }) === 300);
ok('refund honours a smaller request', refundService.refundableAmount({ amountPaid: 500, refundedAmount: 0, requestedAmount: 120 }) === 120);
ok('fully refunded booking refunds nothing', refundService.refundableAmount({ amountPaid: 500, refundedAmount: 500, requestedAmount: 500 }) === 0);

// ---- 2. Cancellation refund math -------------------------------------------
ok(
  'cancellation returns the collected money',
  refundService.cancellationRefundable({ amountPaid: 800, refundedAmount: 0, feeRupees: 0 }) === 800
);
ok(
  'cancellation retains the policy fee',
  refundService.cancellationRefundable({ amountPaid: 800, refundedAmount: 0, feeRupees: 100 }) === 700
);
ok(
  'cancellation never returns refunded money twice',
  refundService.cancellationRefundable({ amountPaid: 800, refundedAmount: 300, feeRupees: 0 }) === 500
);
ok(
  'cancellation respects a policy refund amount',
  refundService.cancellationRefundable({ amountPaid: 800, refundedAmount: 0, feeRupees: 0, policyRefund: 250 }) === 250
);

// ---- 3. Refund mode routing -----------------------------------------------
ok('gateway booking refunds at the gateway', refundService.resolveRefundMode({ paymentMode: 'gateway' }) === 'gateway');
ok('wallet booking refunds to the wallet', refundService.resolveRefundMode({ paymentMode: 'wallet' }) === 'wallet');
ok('cod booking is a provider credit', refundService.resolveRefundMode({ paymentMode: 'cod' }) === 'provider_credit');
ok('direct booking is a provider credit', refundService.resolveRefundMode({ paymentMode: 'direct' }) === 'provider_credit');

// ---- 4. Gateway payment id resolution --------------------------------------
ok('razorpay payment id is read from payResponse', gateway.resolveGatewayPaymentId({ id: 'pay_123' }) === 'pay_123');
ok('explicit razorpay_payment_id wins', gateway.resolveGatewayPaymentId({ razorpay_payment_id: 'pay_9', id: 'order_3' }) === 'pay_9');
ok('missing payResponse yields null', gateway.resolveGatewayPaymentId(null) === null);

// ---- 5. Execution: the money actually moves --------------------------------
const makeBooking = (over = {}) => ({
  _id: 'b1',
  bookingCode: 'LS260101AAAA',
  customer: 'c1',
  paymentMode: 'gateway',
  payment: 'p1',
  payments: ['p1'],
  amountPaid: 1000,
  refundedAmount: 0,
  paymentStatus: 'paid',
  save: async function save() {
    this.saved = true;
  },
  ...over,
});

const makeRefund = (over = {}) => ({
  _id: 'r1',
  booking: 'b1',
  status: 'approved',
  requestedAmount: 400,
  approvedAmount: 400,
  reason: 'provider cancelled',
  save: async function save() {
    this.saved = true;
  },
  ...over,
});

const runExecution = async () => {
  const booking = makeBooking();
  const refund = makeRefund();
  const calls = [];
  const result = await refundService.executeRefund(
    { refundId: 'r1' },
    {
      RefundModel: { findById: async () => refund },
      BookingModel: { findById: async () => booking },
      PaymentInitiationModel: {
        findById: async () => ({ _id: 'p1', payResponse: { id: 'pay_777' }, payment: 'pc1' }),
      },
      PaymentConfigModel: {
        findById: async () => ({ _id: 'pc1', slug: 'razorpay', credentials: { key: 'k', secret: 's' } }),
      },
      gatewayRefund: async (args) => {
        calls.push(args);
        return { gatewayRefundId: 'rf_1', status: 'processed' };
      },
    },
  );
  ok('gateway refund was called', calls.length === 1);
  ok('gateway refund used the captured payment id', calls[0] && calls[0].gatewayPaymentId === 'pay_777');
  ok('gateway refund amount is paise', calls[0] && calls[0].amountPaise === 40000);
  ok('gateway refund carries an idempotency key', calls[0] && String(calls[0].idempotencyKey).includes('r1'));
  ok('refund is completed', refund.status === 'completed');
  ok('refund records the gateway reference', refund.gatewayRefundReference === 'rf_1');
  ok('booking refunded amount is tracked', Number(booking.refundedAmount) === 400);
  ok('booking payment status is partially refunded', booking.paymentStatus === 'partially_refunded');
  ok('execution reports the amount', result.amount === 400);
};

const runFullRefund = async () => {
  const booking = makeBooking({ amountPaid: 400 });
  const refund = makeRefund({ requestedAmount: 400, approvedAmount: 400 });
  await refundService.executeRefund(
    { refundId: 'r1' },
    {
      RefundModel: { findById: async () => refund },
      BookingModel: { findById: async () => booking },
      PaymentInitiationModel: {
        findById: async () => ({ _id: 'p1', payResponse: { id: 'pay_777' }, payment: 'pc1' }),
      },
      PaymentConfigModel: {
        findById: async () => ({ _id: 'pc1', slug: 'razorpay', credentials: { key: 'k', secret: 's' } }),
      },
      gatewayRefund: async () => ({ gatewayRefundId: 'rf_2', status: 'processed' }),
    },
  );
  ok('fully refunded booking is marked refunded', booking.paymentStatus === 'refunded');
};

const runOverRefund = async () => {
  const booking = makeBooking({ amountPaid: 1000, refundedAmount: 900 });
  const refund = makeRefund({ requestedAmount: 400, approvedAmount: 400 });
  let threw = false;
  try {
    await refundService.executeRefund(
      { refundId: 'r1' },
      {
        RefundModel: { findById: async () => refund },
        BookingModel: { findById: async () => booking },
        PaymentInitiationModel: { findById: async () => ({ payResponse: { id: 'pay_1' } }) },
        PaymentConfigModel: { findById: async () => ({ slug: 'razorpay', credentials: {} }) },
        gatewayRefund: async () => ({ gatewayRefundId: 'rf_x' }),
      },
    );
  } catch (e) {
    threw = e.statusCode === 409;
  }
  ok('a refund beyond the collected money is refused', threw);
};

const runFailure = async () => {
  const booking = makeBooking();
  const refund = makeRefund();
  let threw = false;
  try {
    await refundService.executeRefund(
      { refundId: 'r1' },
      {
        RefundModel: { findById: async () => refund },
        BookingModel: { findById: async () => booking },
        PaymentInitiationModel: { findById: async () => ({ payResponse: { id: 'pay_777' }, payment: 'pc1' }) },
        PaymentConfigModel: { findById: async () => ({ slug: 'razorpay', credentials: { key: 'k' } }) },
        gatewayRefund: async () => {
          throw new Error('gateway down');
        },
      },
    );
  } catch (e) {
    threw = true;
  }
  ok('a failed gateway refund surfaces the error', threw);
  ok('a failed refund is recorded as failed', refund.status === 'failed');
  ok('a failed refund records why', String(refund.failureReason || '').includes('gateway down'));
  ok('a failed refund does not move money', Number(booking.refundedAmount || 0) === 0);
};

const runWalletRefund = async () => {
  const booking = makeBooking({ paymentMode: 'wallet' });
  const refund = makeRefund();
  const result = await refundService.executeRefund(
    { refundId: 'r1' },
    {
      RefundModel: { findById: async () => refund },
      BookingModel: { findById: async () => booking },
      walletCredit: async ({ amountRupees }) => ({ transactionId: 'txn_1', amount: amountRupees }),
    },
  );
  ok('wallet refund credits the wallet', result.mode === 'wallet');
  ok('wallet refund records the transaction', refund.gatewayRefundReference === 'txn_1');
};

const runProviderCredit = async () => {
  const booking = makeBooking({ paymentMode: 'cod' });
  const refund = makeRefund();
  const result = await refundService.executeRefund(
    { refundId: 'r1' },
    {
      RefundModel: { findById: async () => refund },
      BookingModel: { findById: async () => booking },
    },
  );
  ok('cod refund is a provider credit', result.mode === 'provider_credit');
  ok('cod refund records the booking reference', String(refund.gatewayRefundReference || '').includes('LS260101AAAA'));
};

(async () => {
  await runExecution();
  await runFullRefund();
  await runOverRefund();
  await runFailure();
  await runWalletRefund();
  await runProviderCredit();
  console.log(failures === 0 ? '\nAll local-services refund units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
