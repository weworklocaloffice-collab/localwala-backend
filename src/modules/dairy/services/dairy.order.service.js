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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const {
  DairyOrder,
  DairyOrderStatusHistory,
  DairyCartItem,
  DairySku,
  DairyCan,
  DairyMilkBatch,
  DairyBatchLedger,
  Wallet,
  Business,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const transactionService = require('../../../services/transaction.service');
const notificationService = require('./dairy.notification.service');
const verticalService = require('../../../kernel/vertical/services/vertical.service');
const dairyCanService = require('./dairy.can.service');
const deliveryRunService = require('../../../kernel/delivery/services/delivery.run.service');
const procurementService = require('./dairy.procurement.service');
const logger = require('../../../config/logger');

/**
 * SKUs whose stock comes from raw-milk batches rather than a simple SKU count.
 *
 * These need FEFO allocation at checkout so the oldest milk is sold first. Every
 * other SKU draws on `DairySku.availableQty`, which the catalog already tracks.
 *
 * Set per outlet, because whether an outlet sells its own collected milk is a
 * business decision — many just buy finished product from a supplier.
 */
const batchTrackedSkuFlag = 'batchTracked';

/**
 * One-time dairy purchase: cart → checkout → payment → order → delivery.
 *
 * Payment reuses the platform's `Wallet` and `Transactions` rather than a dairy
 * balance, so a customer's dairy spend and their existing wallet never drift
 * apart. Deposits are held in the same wallet — see `dairy.can.service`.
 *
 * Cancellation is the subtle part: money, stock and cans must all unwind, and a
 * part failure must not leave a customer charged for something they did not
 * receive.
 */

/** Legal order transitions. Anything else is rejected rather than silently applied. */
const ORDER_TRANSITIONS = {
  pending_payments: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'out_for_delivery', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

const assertTransition = (from, to) => {
  const allowed = ORDER_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Illegal order transition: ${from} -> ${to}. Allowed from ${from}: ${allowed.join(', ') || 'none'}`
    );
  }
};

const nextOrderNo = async () => {
  const latest = await DairyOrder.findOne().sort({ orderNo: -1 }).select('orderNo');
  return latest && latest.orderNo ? latest.orderNo + 1 : 1;
};

const recordHistory = async (order, param) => {
  return DairyOrderStatusHistory.create({
    order: order._id,
    fromStatus: param.fromStatus,
    toStatus: param.toStatus,
    actorType: param.actorType || 'system',
    actor: param.actor,
    reason: param.reason,
    note: param.note,
    location: param.location,
    proof: param.proof,
  });
};

/**
 * Builds an order from the cart, reserving stock and holding any can deposits.
 *
 * Stock and cans are committed here rather than at payment, because a customer
 * who abandons checkout must not be able to hold the last litre indefinitely.
 * `cancelOrder` unwinds exactly what this reserved.
 *
 * @param {Object} param
 */
const createOrder = async (param) => {
  // The vertical gate goes first, before the cart is even read. A halted vertical
  // is the reason *no* order can start, so it should say so — not report whatever
  // the cart happened to contain, and not do the reads to find out.
  await verticalService.assertTradingOpen('dairy', 'a new order cannot be placed');

  const cartItems = await DairyCartItem.find({ user: param.user }).populate(
    'sku',
    // `batchTracked` and `litresPerUnit` must be in this list or FEFO silently
    // never runs — the SKU reads as a plain stock item and batches are ignored.
    'name packSize price availableQty inStock status reusableContainer depositAmount batchTracked litresPerUnit'
  );

  if (cartItems.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cart is empty');
  }

  const businessIds = new Set(cartItems.map((i) => i.business.toString()));
  if (businessIds.size > 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'An order can only contain items from one outlet');
  }
  const business = cartItems[0].business;

  // Validate and reserve stock before taking any money.
  for (const item of cartItems) {
    const sku = item.sku;
    if (!sku || sku.status === false) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${item.sku ? sku.name : 'An item'} is no longer available`);
    }
    if (!sku.inStock || sku.availableQty < item.quantity) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Only ${sku.availableQty} of ${sku.name} available`
      );
    }
  }

  const orderNo = await nextOrderNo();
  const items = cartItems.map((item) => ({
    sku: item.sku._id,
    name: item.sku.name,
    packSize: item.sku.packSize,
    quantity: item.quantity,
    price: item.price,
    canCodes: item.canCodes || [],
  }));

  const itemTotal = Number(items.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2));

  // Reusable containers on a one-time order are tracked but NOT rotated, per
  // the specification: a single purchase is not enrolled in a two-bottle cycle.
  let depositTotal = 0;
  const cansIssued = [];

  for (const item of cartItems) {
    if (!item.sku.reusableContainer) continue;

    // Already picked in this loop. Without this the same `findOne` keeps
    // returning the same can, because nothing mutates it until `issueCans`
    // runs afterwards — the customer would be charged two deposits and issued
    // one can.
    const taken = cansIssued.slice();

    for (let i = 0; i < item.quantity; i += 1) {
      const free = await DairyCan.findOne({
        business: item.business,
        'assignedTo.type': null,
        // Dotted path, not `{ currentHolder: { type: 'store' } }`. Because
        // `currentHolder.type` is itself a schema key, Mongoose casts the object
        // form into a whole-document equality match, which fails as soon as
        // `ref` is also present. Verified: object form returns 0 rows.
        'currentHolder.type': 'store',
        condition: 'ready',
        ...(taken.length > 0 ? { canCode: { $nin: taken } } : {}),
      });
      if (!free) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'No reusable container available for this item');
      }
      taken.push(free.canCode);
      cansIssued.push(free.canCode);
      depositTotal += free.depositAmount || 0;
    }
  }

  const serviceCharge = param.serviceCharge || 0;
  const taxAmount = Number((itemTotal * 0.05).toFixed(2));
  const discountAmount = param.discountAmount || 0;

  // What the customer pays for the goods and the delivery. The can deposit is
  // NOT added here.
  //
  // The deposit is already being taken as a wallet hold by `issueCans` further
  // down, and it comes back when the cans are returned. Adding it to this figure
  // as well meant a prepaid customer paid for the deposit twice: once as a hold
  // and once as part of the amount charged, so the released hold never made them
  // whole again.
  const grandTotal = Number(
    Math.max(itemTotal + serviceCharge + taxAmount - discountAmount, 0).toFixed(2)
  );

  // Cash-on-delivery is the one case with no wallet hold behind it, so the rider
  // asks for the deposit on top. Prepaid orders ignore this entirely.
  const codCollectionAmount = Number((grandTotal + depositTotal).toFixed(2));

  const order = await DairyOrder.create({
    orderNo,
    mode: 'one_time',
    user: param.user,
    business,
    items,
    itemTotal,
    depositTotal,
    serviceCharge,
    taxAmount,
    discountAmount,
    grandTotal,
    codCollectionAmount,
    address: param.address,
    addressRaw: param.addressRaw,
    receiverName: param.receiverName,
    receiverContact: param.receiverContact,
    location: param.location,
    deliverySlot: param.deliverySlot,
    payment: param.payment,
    paymentMode: param.paymentMode || 'wallet',
    cansIssued,
    cartItemRaw: JSON.stringify(items),
    status: 'pending_payments',
  });

  // Commit stock and attach cans. Failures unwind everything reserved so far.
  const batchCommits = [];
  try {
    for (const item of cartItems) {
      await DairySku.updateOne(
        { _id: item.sku._id, availableQty: { $gte: item.quantity } },
        { $inc: { availableQty: -item.quantity } }
      );

      // Raw-milk SKUs additionally draw from `DairyMilkBatch`, FEFO.
      if (item.sku[batchTrackedSkuFlag]) {
        const litres = Number((item.quantity * (item.sku.litresPerUnit || 1)).toFixed(2));
        const allocations = await procurementService.allocateByFEFO(item.business, litres, {
          recordedBy: param.user,
        });
        const covered = allocations.reduce((sum, a) => sum + a.quantityL, 0);
        if (covered < litres) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Not enough raw milk in date for ${item.sku.name}. Need ${litres}L, ${covered}L available.`
          );
        }
        const committed = await procurementService.commitAllocations(allocations, {
          order: order._id,
          recordedBy: param.user,
          note: `Order #${order.orderNo}`,
        });
        batchCommits.push(...committed);
      }
    }

    if (cansIssued.length > 0) {
      // This is the *only* place the deposit is taken for a one-time order, and
      // it is a hold, not a charge: `grandTotal` deliberately excludes it. The
      // matching release happens when the cans are returned — see `cancelOrder`
      // and the can-return path.
      await dairyCanService.issueCans({
        clientRef: `order-${order._id}`,
        order: order._id,
        customer: param.user,
        agent: param.user,
        createdBy: param.user,
        canCodes: cansIssued,
      });
    }
  } catch (error) {
    // Unwind, then report.
    for (const item of cartItems) {
      await DairySku.updateOne({ _id: item.sku._id }, { $inc: { availableQty: item.quantity } });
    }
    // Return any batches already committed.
    for (const commit of batchCommits) {
      const batch = await DairyMilkBatch.findById(commit.batchId);
      if (!batch) continue;
      batch.availableQtyL = Number((batch.availableQtyL + commit.quantityL).toFixed(2));
      batch.consumedQtyL = Number((batch.consumedQtyL - commit.quantityL).toFixed(2));
      if (batch.status === 'consumed') {
        batch.status = 'source';
      }
      await batch.save();
      await DairyBatchLedger.create({
        batch: batch._id,
        business: batch.business,
        eventType: 'released',
        quantityL: commit.quantityL,
        order: order._id,
        note: 'Order creation failed — allocation returned',
        createdBy: param.user,
      });
    }
    if (cansIssued.length > 0) {
      await DairyCan.updateMany(
        { canCode: { $in: cansIssued } },
        { $set: { status: 'in_store', condition: 'ready', 'currentHolder.type': 'store' } }
      );
    }
    await order.deleteOne();
    // Preserve the original status code. Wrapping everything as 500 would turn a
    // deliberate "not enough milk in date" 400 into a server error, and hide real
    // faults behind a generic message.
    throw error instanceof ApiError
      ? error
      : new ApiError(httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }

  // Record which batches this order drew from, for traceability.
  if (batchCommits.length > 0) {
    order.items[0].batchAllocation = batchCommits;
    await order.save();
  }

  // Link the reserved cans to their lines so the rider's scan knows which is which.
  for (const item of order.items) {
    const reusable = cartItems.find((c) => c.sku._id.toString() === item.sku.toString());
    if (reusable && reusable.sku.reusableContainer) {
      item.canCodes = cansIssued.slice(0, item.quantity);
    }
  }
  await order.save();

  await recordHistory(order, {
    fromStatus: null,
    toStatus: 'pending_payments',
    actorType: 'customer',
    actor: param.user,
  });

  return order;
};

/**
 * Settles an order.
 *
 * `wallet` debits the customer and records through the platform's transaction
 * ledger. `cod` marks it payable at the door. A gateway order is marked paid by
 * the gateway webhook, not here.
 *
 * The amount taken here is `grandTotal`, which covers goods, delivery and tax but
 * **not** the can deposit — that is already held in the wallet by `issueCans` and
 * is returned when the cans come back. Charging it again at payment is what used
 * to leave a prepaid customer out of pocket by the deposit amount.
 *
 * @param {Object} param
 */
const payOrder = async (orderId, param) => {
  const order = await getOrder(orderId, { userId: param.user });

  if (order.status !== 'pending_payments') {
    throw new ApiError(httpStatus.BAD_REQUEST, `Order is ${order.status}, not awaiting payment`);
  }

  if (order.paymentMode === 'cod') {
    // Nothing to collect now; the rider takes payment at the door.
    order.status = 'confirmed';
    order.paymentStatus = 'pending';
    await order.save();

    await recordHistory(order, {
      fromStatus: 'pending_payments',
      toStatus: 'confirmed',
      actorType: 'customer',
      actor: param.user,
      note: 'Confirmed with cash on delivery',
    });

    await announceOrderConfirmed(order);

    return order;
  }

  if (order.paymentMode !== 'wallet') {
    // Gateway settlement arrives via webhook; do not guess here.
    order.paymentStatus = 'pending';
    await order.save();
    return order;
  }

  const wallet = await Wallet.findOne({ holderId: order.user });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found');
  }

  // `balance` reads in rupees; so does `grandTotal`. The can deposit is not part
  // of `grandTotal` — it is already held, so this is the only charge made here.
  if (wallet.balance < order.grandTotal) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Insufficient wallet balance. Need ₹${order.grandTotal}, have ₹${wallet.balance}`
    );
  }

  wallet.balance = Number((wallet.balance - order.grandTotal).toFixed(2));
  wallet.meta = [
    ...(wallet.meta || []),
    {
      description: `Dairy order #${order.orderNo}`,
      amount: -order.grandTotal,
      date: new Date(),
    },
  ];
  await wallet.save();

  await transactionService.saveTransation({
    payableId: order.user,
    walletId: `${wallet._id}`,
    type: 'dairy_order',
    amount: `${order.grandTotal}`,
    confirmed: true,
    meta: [{ reason: `Dairy order #${order.orderNo}`, order: `${order._id}` }],
    status: true,
  });

  order.wallet = wallet._id;
  order.walletAmount = order.grandTotal;
  order.paymentStatus = 'paid';
  order.status = 'confirmed';
  await order.save();

  await recordHistory(order, {
    fromStatus: 'pending_payments',
    toStatus: 'confirmed',
    actorType: 'customer',
    actor: param.user,
    note: 'Paid from wallet',
  });

  // Empty the cart only after payment succeeds, so a failed payment leaves the
  // customer's cart intact to retry.
  await DairyCartItem.deleteMany({ user: order.user });

  await announceOrderConfirmed(order);

  return order;
};

/**
 * Tells the outlet and the customer that an order is now live.
 *
 * Called from every path that confirms an order - wallet, cash on delivery and
 * gateway webhook - because "the outlet now owes a delivery" is the same event
 * however it was paid for. Notices are best-effort: a failure is logged by the
 * notification service and never reaches the customer who just paid.
 *
 * @param {Document} order a saved order with `business` and `user` populated
 */
const announceOrderConfirmed = async (order) => {
  const business = order.business;

  // `business` is populated on the order document, but may be a bare id.
  const businessId = business && business._id ? business._id : business;

  if (businessId) {
    const outlet = await Business.findById(businessId).select('owner vertical');
    if (outlet && outlet.vertical === 'dairy' && outlet.owner) {
      await notificationService.notifyOrderPlaced({
        business: businessId,
        partnerUserId: outlet.owner,
        order: {
          _id: order._id,
          id: order.id || String(order._id),
          orderNo: order.orderNo,
          grandTotal: order.grandTotal,
        },
      });
    }
  }

  const customerId = order.user && order.user._id ? order.user._id : order.user;
  if (customerId) {
    await notificationService.notifyOrderStatus({
      userId: customerId,
      business: businessId,
      order: {
        _id: order._id,
        id: order.id || String(order._id),
        orderNo: order.orderNo,
      },
      status: 'confirmed',
    });
  }
};

/**
 * Confirms a gateway order once the webhook reports success.
 */
const markGatewayPaid = async (orderId, gatewayRef) => {
  const order = await DairyOrder.findById(orderId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (order.paymentStatus === 'paid') {
    return order;
  }

  // Captured before the overwrite. Reading `order.status` afterwards recorded
  // `confirmed -> confirmed`, which is a history row that tells an auditor
  // nothing about how the order got there.
  const fromStatus = order.status;

  order.paymentStatus = 'paid';
  order.status = 'confirmed';
  await order.save();

  await recordHistory(order, {
    fromStatus,
    toStatus: 'confirmed',
    actorType: 'system',
    note: `Gateway payment confirmed${gatewayRef ? ` (${gatewayRef})` : ''}`,
  });

  await DairyCartItem.deleteMany({ user: order.user });
  await announceOrderConfirmed(order);
  return order;
};

/**
 * Advances order status with a transition check and a history entry.
 */
const updateStatus = async (orderId, toStatus, param) => {
  const order = await getOrder(orderId, { businessId: param.businessId });

  if (order.status === toStatus) {
    return order;
  }

  assertTransition(order.status, toStatus);

  const fromStatus = order.status;
  order.status = toStatus;
  if (toStatus === 'delivered') {
    order.deliveredAt = new Date();
  }
  await order.save();

  await recordHistory(order, {
    fromStatus,
    toStatus,
    actorType: param.actorType || 'system',
    actor: param.actor,
    reason: param.reason,
    note: param.note,
    location: param.location,
    proof: param.proof,
  });

  // The customer is the one waiting on a status change, so it is told directly.
  // `delivered` and `cancelled` are skipped: both have their own paths that
  // already narrate what happened.
  if (toStatus !== 'delivered' && toStatus !== 'cancelled') {
    const customerId = order.user && order.user._id ? order.user._id : order.user;
    if (customerId) {
      const businessId =
        order.business && order.business._id ? order.business._id : order.business;
      await notificationService.notifyOrderStatus({
        userId: customerId,
        business: businessId,
        order: {
          _id: order._id,
          id: order.id || String(order._id),
          orderNo: order.orderNo,
        },
        status: toStatus,
      });
    }
  }

  return order;
};

/**
 * Cancels an order and unwinds everything it reserved.
 *
 * Each unwind step is isolated: a failure on one is logged and the rest still
 * run, because a customer who cancelled must not be left charged, out of stock,
 * or holding a phantom can deposit. Steps that could not complete are recorded
 * on the order so support can reconcile.
 */
const cancelOrder = async (orderId, param) => {
  const order = await getOrder(orderId);
  const fromStatus = order.status;

  assertTransition(fromStatus, 'cancelled');
  const unresolved = [];

  // 1. Return stock.
  for (const item of order.items) {
    try {
      await DairySku.updateOne({ _id: item.sku }, { $inc: { availableQty: item.quantity } });
    } catch (error) {
      unresolved.push(`stock:${item.sku}`);
      logger.error(`dairy order ${order.orderNo}: stock return failed — ${error.message}`);
    }
  }

  // 2. Recover cans and release their deposits.
  if (order.cansIssued && order.cansIssued.length > 0) {
    try {
      const cans = await DairyCan.find({ canCode: { $in: order.cansIssued } });
      let refund = 0;
      for (const can of cans) {
        if (can.currentHolder?.type !== 'customer') continue;
        refund += can.depositAmount || 0;
        can.status = 'in_store';
        can.condition = 'ready';
        can.currentHolder = { type: 'store', ref: null };
        can.lastMovementAt = new Date();
        await can.save();
      }
      if (refund > 0) {
        await dairyCanService.releaseDeposit(order.user, refund);
      }
    } catch (error) {
      unresolved.push('cans');
      logger.error(`dairy order ${order.orderNo}: can recovery failed — ${error.message}`);
    }
  }

  // 3. Refund a paid order.
  if (order.paymentStatus === 'paid' && order.wallet) {
    try {
      const wallet = await Wallet.findById(order.wallet);
      if (wallet) {
        wallet.balance = Number((wallet.balance + order.walletAmount).toFixed(2));
        wallet.meta = [
          ...(wallet.meta || []),
          {
            description: `Refund for cancelled dairy order #${order.orderNo}`,
            amount: order.walletAmount,
            date: new Date(),
          },
        ];
        await wallet.save();

        await transactionService.saveTransation({
          payableId: order.user,
          walletId: `${wallet._id}`,
          type: 'dairy_order_refund',
          amount: `${order.walletAmount}`,
          confirmed: true,
          meta: [{ reason: `Cancelled dairy order #${order.orderNo}`, order: `${order._id}` }],
          status: true,
        });

        order.paymentStatus = 'refunded';
        order.walletAmount = 0;
      }
    } catch (error) {
      unresolved.push('refund');
      logger.error(`dairy order ${order.orderNo}: refund failed — ${error.message}`);
    }
  }

  order.status = 'cancelled';
  order.cancellation = {
    cancelledAt: new Date(),
    cancelledBy: param.actorType || 'customer',
    reason: param.reason,
  };
  if (unresolved.length > 0) {
    // Surfaced to support rather than swallowed.
    order.cancellation.reason = `${param.reason || 'Cancelled'} [needs reconciliation: ${unresolved.join(', ')}]`;
  }
  await order.save();

  await recordHistory(order, {
    fromStatus,
    toStatus: 'cancelled',
    actorType: param.actorType || 'customer',
    actor: param.actor,
    reason: param.reason,
    note: unresolved.length > 0 ? `Unresolved: ${unresolved.join(', ')}` : undefined,
  });

  // Drop the cancelled items from the cart so a retry starts clean.
  await DairyCartItem.deleteMany({ user: order.user, sku: { $in: order.items.map((i) => i.sku) } });

  return order;
};

/**
 * Folds a confirmed one-time order into a delivery run.
 *
 * Shares the run engine with subscription deliveries, so a rider sees one
 * combined route rather than separate subscription and ad-hoc manifests.
 */
const assignToRun = async (orderId, param) => {
  const order = await getOrder(orderId, { businessId: param.businessId });

  if (order.run) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order is already assigned to a run');
  }
  if (!['confirmed', 'preparing'].includes(order.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Cannot dispatch an order that is ${order.status}`);
  }

  const run = await deliveryRunService.createRun({
    business: order.business,
    serviceDate: param.serviceDate || new Date(),
    slot: param.slot || order.deliverySlot || { startTime: '06:00', endTime: '08:00' },
    stops: [
      {
        customer: order.user,
        address: order.address,
        addressRaw: order.addressRaw,
        receiverName: order.receiverName,
        receiverContact: order.receiverContact,
        location: order.location,
        order: order._id,
        cansOut: order.cansIssued.length > 0 ? order.items[0].quantity : 0,
        // Cash orders carry the deposit too: there is no wallet hold to fall back
        // on, so the rider collects `codCollectionAmount`. Prepaid orders are
        // already paid and owe the rider nothing.
        amountDue: order.paymentMode === 'cod' ? order.codCollectionAmount : 0,
        paymentMode: order.paymentMode === 'cod' ? 'cod' : 'prepaid',
      },
    ],
  });

  order.run = run._id;
  order.stop = run.stops && run.stops[0] ? run.stops[0]._id : undefined;
  await order.save();

  return { order, run };
};

const getOrder = async (orderId, options = {}) => {
  const order = await DairyOrder.findById(orderId)
    .populate('business', 'name businessModel ownDeliveryPartner verified')
    .populate('user', 'firstName lastName mobile countryCode')
    .populate('items.sku', 'name packSize image');
  
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (options.userId && order.user._id.toString() !== options.userId.toString()) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }
  
  // A partner may only touch orders belonging to their own outlet. Supplied by
  // the partner routes, where it comes from the token. Reported as "not found"
  // rather than 403, so the endpoint does not confirm that another outlet's order
  // exists.
  if (options.businessId) {
    const orderBusiness = order.business && order.business._id ? order.business._id : order.business;
    if (!orderBusiness || orderBusiness.toString() !== options.businessId.toString()) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    }
  }
  
  return order;
};

/**
 * Status/revenue breakdown for one customer's own orders.
 *
 * Distinct from {@link getOrderSummary}, which is scoped to an *outlet* and is
 * what the partner dashboard uses. This is the customer's view of their own
 * history, so it is scoped to the user and never to a business.
 *
 * @param {string} userId
 * @param {Object} options from / to
 */
const getCustomerOrderSummary = async (userId, options = {}) => {
  const match = { user: new mongoose.Types.ObjectId(userId) };
  if (options.from || options.to) {
    match.createdAt = {};
    if (options.from) match.createdAt.$gte = new Date(options.from);
    if (options.to) match.createdAt.$lte = new Date(options.to);
  }

  const rows = await DairyOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        orders: { $sum: 1 },
        // Raw paise out of the aggregation; the getter does not apply here, so the
        // division is explicit. See the same note in `getOrderSummary`.
        spend: { $sum: '$grandTotal' },
      },
    },
  ]);

  // Everything nests under `byStatus`. Spreading the status keys at the top level
  // as well produced a response with `byStatus: {}` sitting next to `confirmed`,
  // which reads as two different shapes depending on the status.
  return rows.reduce(
    (acc, row) => ({
      ...acc,
      byStatus: {
        ...acc.byStatus,
        [row._id]: {
          orders: row.orders,
          spend: Number((row.spend / 100).toFixed(2)),
        },
      },
    }),
    { byStatus: {} }
  );
};

const listOrders = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = {};
  if (options.user) query.user = options.user;
  if (options.business) query.business = options.business;
  if (options.status) query.status = options.status;
  if (options.orderNo) query.orderNo = options.orderNo;

  const [orders, totalResults] = await Promise.all([
    DairyOrder.find(query)
      .populate('business', 'name businessModel')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyOrder.countDocuments(query),
  ]);

  return { orders, totalResults, page, limit };
};

const listHistory = async (orderId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 50;
  return DairyOrderStatusHistory.find({ order: orderId }).sort({ createdAt: 1 }).limit(limit);
};

/**
 * Status/revenue breakdown for one outlet.
 *
 * Returns the same shape as `getCustomerOrderSummary` — everything under
 * `byStatus`. The two used to differ, with this one spreading statuses at the top
 * level, so a client reading `summary.byStatus` got `null` depending on which
 * screen asked.
 *
 * @param {string} businessId
 * @param {Object} options from / to
 */
const getOrderSummary = async (businessId, options) => {
  const match = { business: new mongoose.Types.ObjectId(businessId) };
  if (options.from || options.to) {
    match.createdAt = {};
    if (options.from) match.createdAt.$gte = new Date(options.from);
    if (options.to) match.createdAt.$lte = new Date(options.to);
  }

  const rows = await DairyOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$status',
        orders: { $sum: 1 },
        revenue: { $sum: '$grandTotal' },
      },
    },
  ]);

  return rows.reduce(
    (acc, row) => ({
      ...acc,
      byStatus: {
        ...acc.byStatus,
        [row._id]: {
          orders: row.orders,
          revenue: Number((row.revenue / 100).toFixed(2)),
        },
      },
    }),
    { byStatus: {} }
  );
};

module.exports = {
  ORDER_TRANSITIONS,
  assertTransition,
  createOrder,
  payOrder,
  markGatewayPaid,
  updateStatus,
  cancelOrder,
  assignToRun,
  getOrder,
  listOrders,
  listHistory,
  getOrderSummary,
  getCustomerOrderSummary,
  recordHistory,
};