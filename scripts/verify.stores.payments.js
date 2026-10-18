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
 * verify.stores.payments.js — proves the shared gateway stack routes the two
 * Local Stores subjects (BR-17, BR-16).
 *
 * The gateway controller (`payment.initiation.controller.js`) asks the stores
 * payment bridge FIRST on every paid callback, across all 9 gateways. This
 * suite proves the bridge, not the gateways:
 *
 *   1. subject routing   food subjects return false (gateway keeps them);
 *                        store subjects return true
 *   2. missing refs      a callback for a deleted order/payment row is a logged
 *                        no-op, never a throw that would 500 the gateway redirect
 *   3. storeOrders       a created gateway order walks created -> payment_pending
 *                        -> paid with paidAmount = grandTotal; a replay is a no-op
 *   4. storeSubscription a pending attempt row flips to success and the dunning
 *                        subscription reactivates; a replay is a no-op
 *   5. initiation guards a missing order is 404, another customer's order is 403,
 *                        a non-gateway order is 409
 *
 * Fixtures are synthetic ObjectIds — Mongoose does not enforce ref existence,
 * and the payment bridge never populates the chain/outlet, so no taxonomy,
 * stock, or user rows are needed. Everything created here is deleted in the
 * `finally`, keyed by the run's orderNo prefix.
 *
 * Run: node scripts/verify.stores.payments.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const StoreOrder = require('../src/modules/stores/models/store.order.model');
const StoreOutlet = require('../src/modules/stores/models/store.outlet.model');
const StoreRefund = require('../src/modules/stores/models/store.refund.model');
const StoreSubscription = require('../src/modules/stores/models/store.subscription.model');
const StoreSubscriptionPayment = require('../src/modules/stores/models/store.subscription.payment.model');
const paymentService = require('../src/modules/stores/services/stores.payment.service');
const orderService = require('../src/modules/stores/services/stores.order.service');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

const ORDER_NO = 910000 + Math.floor(Math.random() * 8999);
const STAMP = Date.now();
const created = { orders: [], outlets: [], subscriptions: [], payments: [] };

const cleanup = async () => {
  await StoreRefund.deleteMany({ order: { $in: created.orders } });
  await StoreOrder.deleteMany({ _id: { $in: created.orders } });
  await StoreOutlet.deleteMany({ _id: { $in: created.outlets } });
  await StoreSubscriptionPayment.deleteMany({ _id: { $in: created.payments } });
  await StoreSubscription.deleteMany({ _id: { $in: created.subscriptions } });
};

const run = async () => {
  console.log('\n=== subject routing ===\n');
  ck('storeOrders is a stores subject', paymentService.isStoreSubject('storeOrders') === true);
  ck('storeSubscription is a stores subject', paymentService.isStoreSubject('storeSubscription') === true);
  for (const subject of ['order', 'wallet', 'tiffinsubscription', 'booking', 'restaurant_register', 'renew_subscription', undefined, null, '']) {
    ck(`'${subject}' is not routed to stores`, paymentService.isStoreSubject(subject) === false);
  }
  for (const subject of ['order', 'wallet', 'tiffinsubscription', 'booking', 'restaurant_register', 'renew_subscription']) {
    const handled = await paymentService.routePaidCallback({ paymentFrom: subject });
    ck(`routePaidCallback passes '${subject}' through`, handled === false);
  }

  console.log('\n=== missing refs are a logged no-op ===\n');
  const ghostOrder = await paymentService.routePaidCallback({
    paymentFrom: 'storeOrders',
    storeOrder: new mongoose.Types.ObjectId(),
  });
  ck('callback for a missing order returns true without throwing', ghostOrder === true);
  const ghostSub = await paymentService.routePaidCallback({
    paymentFrom: 'storeSubscription',
    storeSubscriptionPayment: new mongoose.Types.ObjectId(),
  });
  ck('callback for a missing payment row returns true without throwing', ghostSub === true);

  console.log('\n=== storeOrders success + replay ===\n');
  const customer = new mongoose.Types.ObjectId();
  // A real outlet: the paid transition issues the invoice number from the
  // outlet's series, so a dangling outlet id would 404 the whole payment.
  const outlet = await StoreOutlet.create({
    chain: new mongoose.Types.ObjectId(),
    outletCode: 'PAY-TEST-' + STAMP,
    name: 'Payments suite outlet',
  });
  created.outlets.push(outlet._id);
  const order = await StoreOrder.create({
    orderNo: ORDER_NO,
    customer,
    outlet: outlet._id,
    chain: new mongoose.Types.ObjectId(),
    items: [],
    grandTotal: 250.75,
    paymentMode: 'gateway',
    paymentStatus: 'pending',
    lifecycle: 'created',
  });
  created.orders.push(order._id);

  const handled = await paymentService.routePaidCallback({ paymentFrom: 'storeOrders', storeOrder: order._id });
  ck('storeOrders callback is handled', handled === true);
  const paid = await StoreOrder.findById(order._id).select('lifecycle paymentStatus paidAmount').lean();
  ck('order walks to paid', paid.lifecycle === 'paid', paid.lifecycle);
  ck('paymentStatus is paid', paid.paymentStatus === 'paid');
  ck('paidAmount equals grandTotal (money getter is rupees)', Number(paid.paidAmount) === 250.75, paid.paidAmount);

  const replayed = await paymentService.routePaidCallback({ paymentFrom: 'storeOrders', storeOrder: order._id });
  ck('replay returns true', replayed === true);
  const same = await StoreOrder.findById(order._id).select('lifecycle paidAmount').lean();
  ck('replay changes nothing', same.lifecycle === 'paid' && Number(same.paidAmount) === 250.75);

  console.log('\n=== BR-43 invoice issue + void ===\n');
  const invoiced = await StoreOrder.findById(order._id).select('invoiceNo invoiceStatus').lean();
  ck('paid transition issues an invoice number', typeof invoiced.invoiceNo === 'string' && invoiced.invoiceNo.length > 0, invoiced.invoiceNo);
  ck('invoice number carries the outlet prefix', invoiced.invoiceNo.indexOf('PAY-TEST-') === 0, invoiced.invoiceNo);
  ck('invoice status is issued', invoiced.invoiceStatus === 'issued', invoiced.invoiceStatus);

  const voided = await orderService.cancelOrder(order._id, { reason: 'suite void check', cancelledBy: 'customer', cancelledByUserId: customer });
  ck('cancelling a paid order voids the invoice', voided.invoiceStatus === 'void', voided.invoiceStatus);
  ck('the voided number is retained, never reused', voided.invoiceNo === invoiced.invoiceNo, voided.invoiceNo);

  console.log('\n=== storeSubscription success + replay ===\n');
  const sub = await StoreSubscription.create({
    chain: new mongoose.Types.ObjectId(),
    business: new mongoose.Types.ObjectId(),
    plan: 'monthly',
    status: 'payment_due',
    amount: 999,
    totalAmount: 999,
  });
  created.subscriptions.push(sub._id);
  const row = await StoreSubscriptionPayment.create({
    subscription: sub._id,
    chain: sub.chain,
    attemptNo: 1,
    amount: 999,
    status: 'pending',
    paymentMethod: 'upi',
  });
  created.payments.push(row._id);

  const subHandled = await paymentService.routePaidCallback({
    paymentFrom: 'storeSubscription',
    storeSubscriptionPayment: row._id,
    paymentRef: 'UPI-TEST-1',
  });
  ck('storeSubscription callback is handled', subHandled === true);
  const done = await StoreSubscriptionPayment.findById(row._id).select('status paidAt gatewayReference').lean();
  ck('attempt row flips to success', done.status === 'success', done.status);
  ck('paidAt is stamped', !!done.paidAt);
  const revived = await StoreSubscription.findById(sub._id).select('status').lean();
  ck('payment_due reactivates to active', revived.status === 'active', revived.status);

  const subReplay = await paymentService.routePaidCallback({
    paymentFrom: 'storeSubscription',
    storeSubscriptionPayment: row._id,
  });
  ck('subscription replay returns true', subReplay === true);
  const stillActive = await StoreSubscription.findById(sub._id).select('status').lean();
  ck('subscription replay changes nothing', stillActive.status === 'active');

  console.log('\n=== initiation guards ===\n');
  const missing = await paymentService
    .initiateStoreOrderPayment({ orderId: new mongoose.Types.ObjectId(), customerId: customer, paymentConfigId: new mongoose.Types.ObjectId() })
    .then(() => null)
    .catch((e) => e);
  ck('missing order is 404', missing && missing.statusCode === 404, missing && missing.statusCode);

  const otherCustomer = await paymentService
    .initiateStoreOrderPayment({ orderId: order._id, customerId: new mongoose.Types.ObjectId(), paymentConfigId: new mongoose.Types.ObjectId() })
    .then(() => null)
    .catch((e) => e);
  ck("another customer's order is 403", otherCustomer && otherCustomer.statusCode === 403, otherCustomer && otherCustomer.statusCode);

  const codOrder = await StoreOrder.create({
    orderNo: ORDER_NO + 1,
    customer,
    outlet: new mongoose.Types.ObjectId(),
    chain: new mongoose.Types.ObjectId(),
    items: [],
    grandTotal: 100,
    paymentMode: 'cod',
    paymentStatus: 'pending',
    lifecycle: 'created',
  });
  created.orders.push(codOrder._id);
  const notGateway = await paymentService
    .initiateStoreOrderPayment({ orderId: codOrder._id, customerId: customer, paymentConfigId: new mongoose.Types.ObjectId() })
    .then(() => null)
    .catch((e) => e);
  ck('a COD order cannot start a gateway payment (409)', notGateway && notGateway.statusCode === 409, notGateway && notGateway.statusCode);

  const missingSub = await paymentService
    .initiateStoreSubscriptionPayment({
      subscriptionId: new mongoose.Types.ObjectId(),
      chainId: new mongoose.Types.ObjectId(),
      payerId: customer,
      paymentConfigId: new mongoose.Types.ObjectId(),
      paymentMethod: 'upi',
    })
    .then(() => null)
    .catch((e) => e);
  ck('missing subscription is 404', missingSub && missingSub.statusCode === 404, missingSub && missingSub.statusCode);

  console.log('\n--- summary ---');
  console.log(failures === 0 ? 'ALL STORES PAYMENT CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  return failures;
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    const f = await run();
    await cleanup();
    await mongoose.disconnect();
    process.exit(f === 0 ? 0 : 1);
  } catch (e) {
    console.error('could not run:', e.message);
    try {
      await cleanup();
      await mongoose.disconnect();
    } catch {
      // teardown must not mask the original failure
    }
    process.exit(1);
  }
})();
