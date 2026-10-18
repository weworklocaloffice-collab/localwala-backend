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
 * Verifies the one-time purchase lifecycle against the real DB.
 *
 *   Category → Product → Quantity → Cart → Checkout → Payment → Order → Delivery
 *
 * Asserts the cart:
 *   1. add / merge quantity for the same SKU
 *   2. reject a quantity above available stock
 *   3. one outlet per cart
 *   4. price captured at add time, not at checkout
 *   5. out-of-stock lines reported, not silently dropped
 *   6. price drift reported without mutating, applied only on request
 *
 * Asserts checkout and payment:
 *   7. checkout creates a pending order and reserves stock
 *   8. totals computed (item, deposit, tax, grand)
 *   9. reusable container attaches a can and holds its deposit
 *  10. wallet payment debits and records a transaction
 *  11. insufficient wallet balance refused
 *  12. cart emptied only after successful payment
 *  13. COD confirms without charging
 *
 * Asserts status and cancellation:
 *  14. legal transitions accepted, illegal refused
 *  15. status history is append-only and ordered
 *  16. cancellation returns stock
 *  17. cancellation refunds a paid order
 *  18. cancellation recovers cans and releases their deposit
 *  19. cancellation refused once delivered
 *  20. dispatch folds the order into a run
 *
 * Usage: node scripts/verify.dairy.orders.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  Transactions,
  DairySku,
  DairyCategory,
  DairySubCategory,
  DairyProduct,
  DairyCartItem,
  DairyOrder,
  DairyOrderStatusHistory,
  DairyCan,
  DeliveryRun,
  DeliveryStop,
} = require('../src/models');
const cartService = require('../src/modules/dairy/services/dairy.cart.service');
const orderService = require('../src/modules/dairy/services/dairy.order.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const asha = await User.findOne({ countryCode: '+91', mobile: '9000000001' });
  if (!asha) {
    console.error('Seed data missing. Run: node/scripts/seed.dairy.js');
    process.exit(1);
  }
  const business = await Business.findOne({ owner: asha._id });
  const tag = `O${Date.now().toString().slice(-6)}`;

  const mobile = Number(`97${Date.now().toString().slice(-8)}`);
  const customer = await User.create({
    firstName: 'Shop', lastName: 'Test', countryCode: '+91', mobile,
    email: `shop${Date.now()}@ord.local`, password: 'Customer@123',
    role: 'user', status: true, locale: 'en',
  });
  // ₹1,000 opening balance, enough for the first order.
  const wallet = await Wallet.create({ holderId: customer._id, balance: 1000, status: true });

  const created = { categories: [], products: [], skus: [], cans: [] };

  try {
    const category = await DairyCategory.create({ key: `m_${tag}`, name: `Milk ${tag}` });
    const subCat = await DairySubCategory.create({ category: category._id, name: `Toned ${tag}` });
    created.categories.push(category, subCat);

    const milk = await DairyProduct.create({
      business: business._id, category: category._id, subCategory: subCat._id,
      name: `Cart Milk ${tag}`,
    });
    created.products.push(milk);
    // Packaged milk: no reusable container.
    const milkSku = await DairySku.create({
      business: business._id, product: milk._id, category: category._id, subCategory: subCat._id,
      name: `Cart Milk 1 Litre ${tag}`,
      packSize: { value: '1 Litre', unit: 'litre', quantity: 1 },
      price: 60, availableQty: 100, inStock: true, status: true,
    });
    created.skus.push(milkSku);

    // Reusable-container SKU for the deposit path.
    const bottleProduct = await DairyProduct.create({
      business: business._id, category: category._id, subCategory: subCat._id,
      name: `Bottle Milk ${tag}`,
    });
    created.products.push(bottleProduct);
    const bottleSku = await DairySku.create({
      business: business._id, product: bottleProduct._id, category: category._id, subCategory: subCat._id,
      name: `Bottle Milk 500 ml ${tag}`,
      packSize: { value: '500 ml', unit: 'ml', quantity: 500 },
      reusableContainer: true, price: 30, availableQty: 100, inStock: true, status: true,
    });
    created.skus.push(bottleSku);

    // Five bottles, not two: the reusable path needs a free pair per order, and
    // both the prepaid order and the later cash-with-deposit order take two each.
    for (let i = 0; i < 5; i += 1) {
      const can = await DairyCan.create({
        canCode: `${tag}-C${i + 1}`, business: business._id, canType: 'standard',
        capacityL: 0.5, depositAmount: 40, status: 'in_store',
        currentHolder: { type: 'store', ref: null }, heldAt: business._id, condition: 'ready',
      });
      created.cans.push(can);
    }

    // ---- 1-6. Cart ----
    console.log('\n1. Cart');
    await cartService.addItem({ user: customer._id, sku: milkSku._id, quantity: 2 });
    const afterFirst = await cartService.getCart(customer._id);
    check('line added', afterFirst.lines.length === 1 && afterFirst.lines[0].quantity === 2);
    check('line total = price x qty', afterFirst.lines[0].lineTotal === 120, `got ${afterFirst.lines[0].lineTotal}`);

    await cartService.addItem({ user: customer._id, sku: milkSku._id, quantity: 1 });
    const merged = await cartService.getCart(customer._id);
    check('same SKU merges instead of duplicating', merged.lines.length === 1 && merged.lines[0].quantity === 3,
      `lines=${merged.lines.length} qty=${merged.lines[0] && merged.lines[0].quantity}`);

    let overStockRefused = false;
    try {
      await cartService.updateQuantity(customer._id, merged.lines[0].itemId, 500);
    } catch (e) { overStockRefused = e.statusCode === 400; }
    check('quantity above available stock refused', overStockRefused);

    // Price drift must not silently reprice.
    await DairySku.updateOne({ _id: milkSku._id }, { $set: { price: 70 } });
    const drift = await cartService.refreshPrices(customer._id);
    check('price drift reported', drift.requiresConfirmation && drift.changes.length === 1,
      `changes=${drift.changes.length}`);
    const unchanged = await cartService.getCart(customer._id);
    check('cart price NOT changed without consent', unchanged.lines[0].price === 60,
      `got ${unchanged.lines[0].price}`);

    await cartService.applyPriceChanges(customer._id, [unchanged.lines[0].itemId]);
    const repriced = await cartService.getCart(customer._id);
    check('price applied only on request', repriced.lines[0].price === 70, `got ${repriced.lines[0].price}`);

    // Out of stock must be reported, not dropped.
    await DairySku.updateOne({ _id: milkSku._id }, { $set: { availableQty: 0, inStock: false } });
    const withUnavail = await cartService.getCart(customer._id);
    check('out-of-stock line reported separately', withUnavail.unavailable.length === 1,
      `unavailable=${withUnavail.unavailable.length}`);
    check('unavailable line excluded from totals', withUnavail.lines.length === 0);
    await DairySku.updateOne({ _id: milkSku._id }, { $set: { availableQty: 100, inStock: true } });

    // ---- 7-9. Checkout ----
    console.log('\n2. Checkout');
    await cartService.clear(customer._id);
    await cartService.addItem({ user: customer._id, sku: bottleSku._id, quantity: 2 });

    const stockBefore = (await DairySku.findById(bottleSku._id)).availableQty;
    const order = await orderService.createOrder({
      user: customer._id,
      addressRaw: '1 Test Street', receiverName: 'Shopper',
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
      paymentMode: 'wallet',
    });
    check('order created at pending_payments', order.status === 'pending_payments');
    check('orderNo assigned', !!order.orderNo);
    const stockAfterCheckout = (await DairySku.findById(bottleSku._id)).availableQty;
    check('stock reserved at checkout', stockBefore - stockAfterCheckout === 2,
      `${stockBefore} -> ${stockAfterCheckout}`);

    check('itemTotal = 2 x 30', order.itemTotal === 60, `got ${order.itemTotal}`);
    check('depositTotal = 2 x 40', order.depositTotal === 80, `got ${order.depositTotal}`);
    check('tax computed', order.taxAmount === 3, `got ${order.taxAmount}`);
    // The deposit is a refundable hold, never a sale, so it stays out of the
    // amount the customer pays for goods.
    check('grandTotal = item + tax, deposit EXCLUDED', order.grandTotal === 63, `got ${order.grandTotal}`);
    check('codCollectionAmount = grandTotal + deposit', order.codCollectionAmount === 143,
      `got ${order.codCollectionAmount}`);

    check('two cans issued', order.cansIssued.length === 2, `got ${order.cansIssued.length}`);
    check('the two issued cans are distinct',
      new Set(order.cansIssued).size === 2, `codes=${order.cansIssued.join(',')}`);
    const heldCans = await DairyCan.countDocuments({
      canCode: { $in: order.cansIssued }, status: 'with_customer',
    });
    check('cans now with the customer', heldCans === 2, `got ${heldCans}`);
    const depositWallet = await Wallet.findById(wallet._id);
    check('can deposit held in wallet', depositWallet.balance === 920, `got ${depositWallet.balance}`);

    // ---- 10-12. Payment ----
    console.log('\n3. Payment');
    const cartBeforePay = (await cartService.getCart(customer._id)).lines.length;
    const paid = await orderService.payOrder(order._id, { user: customer._id });
    check('wallet payment confirms the order', paid.status === 'confirmed');
    check('paymentStatus = paid', paid.paymentStatus === 'paid');
    // 63, not 143. The 80 deposit is already held, so charging it again here is
    // what used to leave the customer permanently 80 short once the hold was
    // released on return.
    check('wallet debited the grand total only', paid.walletAmount === 63, `got ${paid.walletAmount}`);

    const walletAfterPay = await Wallet.findById(wallet._id);
    // 1000 − 80 (deposit held at checkout) − 63 (goods and tax) = 857
    check('wallet balance reduced by goods + deposit hold only', walletAfterPay.balance === 857,
      `got ${walletAfterPay.balance}`);

    const txn = await Transactions.findOne({ payableId: customer._id, type: 'dairy_order' });
    check('transaction recorded', !!txn);
    check('transaction amount correct', txn && Number(txn.amount) === 63, `got ${txn && txn.amount}`);

    const cartAfterPay = await cartService.getCart(customer._id);
    check('cart emptied after payment', cartAfterPay.lines.length === 0 && cartBeforePay === 1);

    // Insufficient balance.
    await Wallet.updateOne({ _id: wallet._id }, { $set: { balance: 10 } });
    await cartService.addItem({ user: customer._id, sku: milkSku._id, quantity: 2 });
    const order2 = await orderService.createOrder({
      user: customer._id, addressRaw: '1 Test Street',
      paymentMode: 'wallet', deliverySlot: { startTime: '06:00', endTime: '08:00' },
    });
    let insufficientRefused = false;
    try {
      await orderService.payOrder(order2._id, { user: customer._id });
    } catch (e) { insufficientRefused = e.statusCode === 400; }
    check('insufficient wallet balance refused', insufficientRefused);
    const stillPending = await DairyOrder.findById(order2._id);
    check('order stays pending_payments after failed payment', stillPending.status === 'pending_payments');
    const cartAfterFail = await cartService.getCart(customer._id);
    check('cart preserved after failed payment', cartAfterFail.lines.length === 1);

    // ---- 13. COD ----
    console.log('\n4. COD');
    await cartService.clear(customer._id);
    await cartService.addItem({ user: customer._id, sku: milkSku._id, quantity: 1 });
    const codOrder = await orderService.createOrder({
      user: customer._id, addressRaw: '1 Test Street', paymentMode: 'cod',
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
    });
    const walletBeforeCod = (await Wallet.findById(wallet._id)).balance;
    const codPaid = await orderService.payOrder(codOrder._id, { user: customer._id });
    check('COD confirms without charging', codPaid.status === 'confirmed');
    check('COD leaves paymentStatus pending', codPaid.paymentStatus === 'pending');
    check('COD leaves the wallet untouched',
      (await Wallet.findById(wallet._id)).balance === walletBeforeCod);

    // Cash on delivery is the one case with no wallet hold behind it, so the
    // rider does ask for the deposit. Proving it here is what stops someone
    // "simplifying" the two figures back into one and reintroducing the double
    // charge on prepaid orders.
    await cartService.clear(customer._id);
    await cartService.addItem({ user: customer._id, sku: bottleSku._id, quantity: 2 });
    // Issuing bottles holds a deposit whatever the payment mode, and the wallet
    // was drained on purpose above, so give it the ₹80 this hold needs.
    await Wallet.updateOne({ _id: wallet._id }, { $set: { balance: 500 } });
    const codCans = await orderService.createOrder({
      user: customer._id, addressRaw: '1 Test Street', paymentMode: 'cod',
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
    });
    check('COD grandTotal still excludes the deposit', codCans.grandTotal === 63,
      `got ${codCans.grandTotal}`);
    check('COD collection figure adds the deposit', codCans.codCollectionAmount === 143,
      `got ${codCans.codCollectionAmount}`);
    await orderService.payOrder(codCans._id, { user: customer._id });
    const codDispatch = await orderService.assignToRun(codCans._id, {
      slot: { startTime: '06:00', endTime: '08:00' },
    });
    const codStop = await DeliveryStop.findOne({ run: codDispatch.run._id });
    check('rider collects the deposit on a cash order', Number(codStop.amountDue) === 143,
      `got ${codStop.amountDue}`);

    // ---- 14-15. Status transitions ----
    console.log('\n5. Status and history');
    await orderService.updateStatus(codOrder._id, 'preparing', { actorType: 'partner' });
    await orderService.updateStatus(codOrder._id, 'out_for_delivery', { actorType: 'partner' });
    const delivered = await orderService.updateStatus(codOrder._id, 'delivered', {
      actorType: 'driver', note: 'Handed over',
    });
    check('delivered reached', delivered.status === 'delivered');
    check('deliveredAt stamped', !!delivered.deliveredAt);

    let illegalRefused = false;
    try {
      await orderService.updateStatus(codOrder._id, 'preparing', {});
    } catch (e) { illegalRefused = e.statusCode === 400; }
    check('illegal transition delivered -> preparing refused', illegalRefused);

    const history = await orderService.listHistory(codOrder._id, {});
    check('history is ordered oldest first',
      history[0].toStatus === 'pending_payments' && history[history.length - 1].toStatus === 'delivered',
      `${history[0] && history[0].toStatus} .. ${history[history.length - 1] && history[history.length - 1].toStatus}`);
    check('history records every step', history.length >= 5, `got ${history.length}`);

    let cancelDeliveredRefused = false;
    try {
      await orderService.cancelOrder(codOrder._id, { reason: 'too late' });
    } catch (e) { cancelDeliveredRefused = e.statusCode === 400; }
    check('cancelling a delivered order refused', cancelDeliveredRefused);

    // ---- 16-18. Cancellation unwind ----
    console.log('\n6. Cancellation');
    const beforeCancelStock = (await DairySku.findById(bottleSku._id)).availableQty;
    const beforeCancelWallet = (await Wallet.findById(wallet._id)).balance;

    const cancelled = await orderService.cancelOrder(order._id, {
      reason: 'changed mind', actorType: 'customer',
    });
    check('cancel sets status', cancelled.status === 'cancelled');
    check('cancel records reason', cancelled.cancellation.reason === 'changed mind');

    const afterCancelStock = (await DairySku.findById(bottleSku._id)).availableQty;
    check('stock returned', afterCancelStock === beforeCancelStock + 2,
      `${beforeCancelStock} -> ${afterCancelStock}`);

    const refundTxn = await Transactions.findOne({ type: 'dairy_order_refund' });
    check('refund transaction recorded', !!refundTxn);
    // Only what was actually taken is returned: the ₹63 goods-and-tax charge.
    check('refund amount equals the payment', refundTxn && Number(refundTxn.amount) === 63,
      `got ${refundTxn && refundTxn.amount}`);

    const recovered = await DairyCan.countDocuments({
      canCode: { $in: order.cansIssued }, status: 'in_store',
    });
    check('cans recovered to the store', recovered === 2, `got ${recovered}`);

    // Two separate sums come back, and neither is double-counted: the ₹63 that
    // was charged for goods, and the ₹80 deposit that was only ever held.
    const afterCancelWallet = (await Wallet.findById(wallet._id)).balance;
    check('wallet refunded payment and released both can deposits',
      afterCancelWallet === beforeCancelWallet + 63 + 80,
      `${beforeCancelWallet} -> ${afterCancelWallet}`);

    // ---- 19. Dispatch ----
    console.log('\n7. Dispatch');
    // Top the wallet up and settle order2, which failed payment earlier.
    await Wallet.updateOne({ _id: wallet._id }, { $set: { balance: 500 } });
    await orderService.payOrder(order2._id, { user: customer._id });
    const dispatched = await orderService.assignToRun(order2._id, {
      slot: { startTime: '06:00', endTime: '08:00' },
    });
    check('order linked to a run', !!dispatched.order.run);
    check('run has one stop', (await DeliveryStop.countDocuments({ run: dispatched.run._id })) === 1);

    let doubleDispatchRefused = false;
    try {
      await orderService.assignToRun(order2._id, {});
    } catch (e) { doubleDispatchRefused = e.statusCode === 400; }
    check('dispatching twice refused', doubleDispatchRefused);

    const summary = await orderService.getOrderSummary(business._id, {});
    // Statuses nest under `byStatus`, matching `getCustomerOrderSummary`, so a
    // client reading the same key works on both the customer and partner screens.
    check('order summary reports cancelled orders',
      !!(summary.byStatus && summary.byStatus.cancelled),
      Object.keys(summary.byStatus || {}).join(','));
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message}`);
  } finally {
    await DairyOrderStatusHistory.deleteMany({});
    await DairyCartItem.deleteMany({ user: customer._id });
    await DairyOrder.deleteMany({ user: customer._id });
    await DeliveryStop.deleteMany({});
    await DeliveryRun.deleteMany({});
    await Transactions.deleteMany({ payableId: customer._id });
    const canIds = created.cans.map((c) => c._id);
    await DairyCan.deleteMany({ _id: { $in: canIds } });
    await DairySku.deleteMany({ _id: { $in: created.skus.map((s) => s._id) } });
    await DairyProduct.deleteMany({ _id: { $in: created.products.map((p) => p._id) } });
    await DairySubCategory.deleteMany({ _id: { $in: created.categories.map((c) => c._id) } });
    await DairyCategory.deleteMany({ _id: { $in: created.categories.map((c) => c._id) } });
    await Wallet.deleteMany({ _id: wallet._id });
    await User.deleteMany({ _id: customer._id });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL ORDER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});