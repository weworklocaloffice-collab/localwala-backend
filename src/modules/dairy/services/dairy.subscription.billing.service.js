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
 * Turns a subscription occurrence into a real, paid order.
 *
 * Why this exists: a recurring delivery is not free. Without this step the nightly
 * job produced a manifest the rider worked from, but no order, no payment and
 * therefore no revenue — so outlet reports and partner settlements silently
 * excluded every subscription customer.
 *
 * The design is deliberately narrow:
 *
 *   1. **Stock is reserved per occurrence, at generation time.** Not per plan.
 *      Holding a month's worth of stock the day a plan is signed blocks units no
 *      one has ordered yet, and cannot react to demand. The cost is that stock
 *      must be returned when an occurrence is dropped.
 *   2. **The order is an ordinary `DairyOrder`.** Same model, same statuses, same
 *      wallet ledger as a one-time checkout, so delivery, refund and settlement
 *      need no special cases. Only `subscription` and `recurringOrder` are extra.
 *   3. **Prepaid or nothing.** The customer's wallet is debited at generation. If
 *      the balance is short the occurrence is skipped and marked, *not* quietly
 *      converted into an unpaid COD delivery — a customer who cannot pay should
 *      hear about it before the rider turns up with the milk.
 *   4. **Every step unwinds.** Stock reserved and then unpaid is returned, and a
 *      later cancellation refunds the order. `stockReserved` exists so a
 *      part-failure returns exactly what was taken, never more.
 *
 * MongoDB here is standalone in development, so transactions are unavailable;
 * every write below is therefore written to be compensatable rather than atomic.
 * See `utils/optionalTransaction.js`.
 */

const { status: httpStatus } = require('http-status');
const {
  DairySku,
  DairyCan,
  DairyOrder,
  DairyOrderStatusHistory,
  DairyRecurringOrder,
  DairyContainerAssignment,
  Wallet,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const transactionService = require('../../../services/transaction.service');
const containerService = require('./dairy.container.service');
const canService = require('./dairy.can.service');
const deliveryHooks = require('../../../kernel/delivery/delivery.hooks');
const { toPaise, debitMoneyField, creditMoneyField } = require('../../../utils/money');
const logger = require('../../../config/logger');

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
    reason: param.reason,
    note: param.note,
  });
};

/**
 * Takes `quantity` units off the SKU's available stock, but only if they are
 * there.
 *
 * The guard is part of the update rather than a prior read, so two occurrences
 * generated in the same run cannot both claim the last unit.
 *
 * @param {DairyRecurringOrder} occurrence
 * @returns {Promise<boolean>} whether the stock was taken
 */
const reserveOccurrenceStock = async (occurrence) => {
  const result = await DairySku.updateOne(
    { _id: occurrence.sku, availableQty: { $gte: occurrence.quantity } },
    { $inc: { availableQty: -occurrence.quantity } }
  );

  if (result.matchedCount === 0) {
    return false;
  }

  occurrence.stockReserved = true;
  await occurrence.save();
  return true;
};

/**
 * Returns stock taken by {@link reserveOccurrenceStock}.
 *
 * Guarded by `stockReserved` rather than trusted from the caller, so a retry
 * after a partial failure cannot credit the same units twice.
 *
 * @param {DairyRecurringOrder} occurrence
 */
const releaseOccurrenceStock = async (occurrence) => {
  if (!occurrence.stockReserved) {
    return false;
  }

  await DairySku.updateOne(
    { _id: occurrence.sku },
    { $inc: { availableQty: occurrence.quantity } }
  );

  occurrence.stockReserved = false;
  await occurrence.save();
  return true;
};

/**
 * Debits the customer's wallet for the occurrence.
 *
 * Goes through the raw collection because the balance is a rupees/paise field and
 * Mongoose would apply that setter to an `$inc`, silently debiting a hundred
 * times too much. See utils/money.js.
 *
 * @param {number} amount rupees, matching every other amount in this service
 * @returns {Promise<Object>} the wallet document
 */
const debitOccurrenceWallet = async (occurrence, order, amount) => {
  const wallet = await Wallet.findOne({ holderId: occurrence.user });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found');
  }

  // `balance` reads in rupees via its getter, same as `amount`.
  if (wallet.balance < amount) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Insufficient prepaid balance for this delivery. Need ₹${amount}, have ₹${wallet.balance}`
    );
  }

  const { debited } = await debitMoneyField(
    Wallet,
    wallet._id,
    'balance',
    toPaise(amount),
    {
      $push: {
        meta: {
          description: `Dairy subscription #${order.orderNo}`,
          amount: -amount,
          date: new Date(),
        },
      },
    }
  );

  if (!debited) {
    // Lost a race with another debit after the read above.
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Prepaid balance changed while this delivery was being prepared'
    );
  }

  return wallet;
};

/**
 * Raises and pays the order for one occurrence.
 *
 * Order of operations is chosen so the failure modes are recoverable: money is
 * only taken once an order exists to attribute it to, and a failed debit leaves a
 * cancelled order rather than an unpaid one that a rider might deliver against.
 *
 * @param {DairyRecurringOrder} occurrence
 * @param {DairySubscription} subscription
 * @returns {Promise<DairyOrder>} the paid order
 */
const billOccurrence = async (occurrence, subscription) => {
  const sku = await DairySku.findById(occurrence.sku);
  if (!sku) {
    throw new ApiError(httpStatus.NOT_FOUND, 'SKU not found');
  }

  const quantity = occurrence.quantity;
  // The price was frozen when the occurrence was generated, so a mid-month price
  // change cannot alter what the customer already agreed to pay.
  const unitPrice = Number(occurrence.unitPrice || 0);
  const amount = Number(occurrence.amount || 0);

  // Check affordability before anything is written. A customer who cannot pay
  // should not accumulate cancelled order documents for deliveries that were
  // never going to happen.
  const wallet = await Wallet.findOne({ holderId: occurrence.user });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found');
  }
  if (wallet.balance < amount) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Insufficient prepaid balance for this delivery. Need ₹${amount}, have ₹${wallet.balance}`
    );
  }

  const orderNo = await nextOrderNo();

  // Created unpaid first. The unique index on `recurringOrder` is the real
  // guarantee that a retried nightly job cannot bill the same date twice.
  const order = await DairyOrder.create({
    orderNo,
    mode: 'subscription',
    user: occurrence.user,
    business: occurrence.business,
    items: [
      {
        sku: sku._id,
        name: sku.name,
        packSize: sku.packSize,
        quantity,
        price: unitPrice,
      },
    ],
    itemTotal: amount,
    // A subscription delivery is prepaid, so there is no door collection and no
    // delivery charge to settle. Adding one here would invent revenue that the
    // customer was never quoted.
    depositTotal: 0,
    serviceCharge: 0,
    grandTotal: amount,
    address: occurrence.address,
    addressRaw: occurrence.addressRaw,
    receiverName: subscription.receiverName,
    receiverContact: subscription.receiverContact,
    deliverySlot: occurrence.deliverySlot,
    paymentMode: 'wallet',
    paymentStatus: 'pending',
    status: 'pending_payments',
    subscription: subscription._id,
    recurringOrder: occurrence._id,
  });

  try {
    const wallet = await debitOccurrenceWallet(occurrence, order, amount);

    await transactionService.saveTransation({
      payableId: occurrence.user,
      walletId: `${wallet._id}`,
      type: 'dairy_subscription',
      amount: `${amount}`,
      confirmed: true,
      meta: [
        {
          reason: `Subscription delivery #${order.orderNo} (${occurrence.occurrenceDate})`,
          order: `${order._id}`,
          subscription: `${subscription._id}`,
        },
      ],
      status: true,
    });

    order.wallet = wallet._id;
    order.walletAmount = amount;
    order.paymentStatus = 'paid';
    order.status = 'confirmed';
    await order.save();

    await recordHistory(order, {
      fromStatus: 'pending_payments',
      toStatus: 'confirmed',
      actorType: 'system',
      note: `Prepaid subscription delivery for ${occurrence.occurrenceDate}`,
    });
  } catch (error) {
    // Nothing was charged, so the order must not survive as deliverable.
    order.status = 'cancelled';
    order.paymentStatus = 'pending';
    order.cancellation = {
      cancelledAt: new Date(),
      cancelledBy: 'system',
      reason: `Prepaid billing failed: ${error.message}`,
    };
    await order.save();
    throw error;
  }

  occurrence.order = order._id;
  occurrence.status = 'billed';
  await occurrence.save();

  return order;
};

/**
 * Puts a subscription onto the two-bottle rotation, once, and remembers it.
 *
 * A reusable *subscription* is the one case where a customer is genuinely
 * enrolled in a cycle, so it needs an assignment. Without this the plan would
 * deliver milk in a bottle nobody was tracking: no rotation, no deposit, and no
 * way to know which bottle is whose.
 *
 * @returns {Promise<Object|null>} the assignment, or null for packaged dairy
 */
const ensureContainerAssignment = async (subscription, sku) => {
  // Packaged dairy (curd, ghee, paneer) is not supplied in bottles. Nothing to do.
  if (!sku.reusableContainer) {
    return null;
  }

  if (subscription.containerAssignment) {
    return DairyContainerAssignment.findById(subscription.containerAssignment);
  }

  // A customer on more than one bottled plan shares one rotation. Rotations are
  // tracked per customer, not per plan — the bottles are the customer's, so
  // starting a second pair would either double-book them or fail outright.
  const existing = await DairyContainerAssignment.findOne({
    customer: subscription.user,
    business: subscription.business,
    status: 'active',
  });
  if (existing) {
    subscription.containerAssignment = existing._id;
    await subscription.save();
    return existing;
  }

  const assignment = await containerService.assignContainers({
    customer: subscription.user,
    business: subscription.business,
    sku: sku._id,
    subscription: subscription._id,
    createdBy: subscription.user,
  });

  subscription.containerAssignment = assignment._id;
  await subscription.save();

  return assignment;
};

/**
 * Plans this delivery's bottle swap and holds the deposit for the bottle going
 * out.
 *
 * The deposit is a hold, exactly as on a one-time order — see the note in
 * `dairy.order.service.js` about why it never becomes part of what the customer
 * pays.
 *
 * @returns {Promise<{collect: string|null, deliver: string|null}>}
 */
const prepareOccurrenceRotation = async (occurrence, subscription, sku) => {
  const assignment = await ensureContainerAssignment(subscription, sku);
  if (!assignment) {
    return null;
  }

  occurrence.containerAssignment = assignment._id;

  // Throws when no sibling bottle is back in service. That is a real operational
  // problem — the wash line is behind — so the caller reports it as a skipped
  // delivery rather than handing over an untracked bottle.
  const swap = await containerService.planSwap({
    customer: subscription.user,
    business: subscription.business,
  });

  const depositHeld = swap.deliver ? swap.deliver.depositAmount || 0 : 0;
  if (depositHeld > 0) {
    await canService.holdDeposit(subscription.user, depositHeld);
  }

  occurrence.rotation = {
    collect: swap.collect ? swap.collect.canCode : undefined,
    deliver: swap.deliver ? swap.deliver.canCode : undefined,
    depositHeld,
  };
  await occurrence.save();

  return occurrence.rotation;
};

/**
 * Undoes a planned rotation for an occurrence that will not be delivered.
 *
 * Only the bottle that was going *out* is touched. The bottle coming *in* is
 * still the customer's property and must stay with them, or cancelling one
 * delivery would confiscate a bottle they legitimately hold.
 */
const unwindOccurrenceRotation = async (occurrence) => {
  const planned = occurrence.rotation;
  if (!planned || !planned.deliver) {
    return false;
  }

  const depositHeld = Number(planned.depositHeld || 0);
  if (depositHeld > 0) {
    await canService.releaseDeposit(occurrence.user, depositHeld);
  }

  // The bottle never left the store, so put its plan back to neutral. Only the
  // lifecycle is reset — `assignedTo` stays, because the customer is still
  // enrolled and the bottle is still theirs.
  const can = await DairyCan.findOne({ canCode: planned.deliver });
  if (can) {
    can.condition = 'ready';
    can.currentHolder = { type: 'store', ref: null };
    can.lastMovementAt = new Date();
    await can.save();
  }

  // `$unset` rather than assigning undefined: Mongoose strips `undefined` from an
  // update, and setting a nested path to undefined makes the next `save()` write
  // a half-empty object (`{depositHeld: 0}`) instead of removing the plan. Null
  // is written through cleanly, so the stored document ends up with nothing.
  await DairyRecurringOrder.updateOne(
    { _id: occurrence._id },
    { $unset: { rotation: 1 } }
  );
  occurrence.rotation = null;

  return true;
};

/**
 * Prepares a freshly created occurrence: reserve stock, then bill.
 *
 * Either both happen or neither does. A skipped occurrence is left on the record
 * with the reason, so the outlet and the customer can both see why a delivery
 * they expected did not appear.
 *
 * @returns {Promise<{billed: boolean, order: Object|null, reason: string|null}>}
 */
const prepareOccurrence = async (occurrence, subscription) => {
  const sku = await DairySku.findById(occurrence.sku);

  const reserved = await reserveOccurrenceStock(occurrence);
  if (!reserved) {
    occurrence.status = 'skipped';
    occurrence.skipReason = 'Not enough stock for this delivery';
    await occurrence.save();
    return { billed: false, order: null, reason: occurrence.skipReason };
  }

  // Plan the bottle swap before taking payment, so a rotation that cannot happen
  // is caught while the delivery can still be called off cleanly.
  let rotationPlanned = false;
  if (sku && sku.reusableContainer) {
    try {
      await prepareOccurrenceRotation(occurrence, subscription, sku);
      rotationPlanned = true;
    } catch (error) {
      // The assignment or the swap may have got part-way in before failing, so
      // unwind whatever was taken and give the stock back before standing down.
      // `unwindOccurrenceRotation` is a no-op when nothing was planned.
      await unwindOccurrenceRotation(occurrence);
      await releaseOccurrenceStock(occurrence);

      occurrence.status = 'skipped';
      occurrence.skipReason = `Container rotation unavailable: ${error.message}`;
      await occurrence.save();
      logger.error(
        `dairy subscription rotation: occurrence ${occurrence._id} skipped — ${error.message}`
      );
      return { billed: false, order: null, reason: occurrence.skipReason };
    }
  }

  try {
    const order = await billOccurrence(occurrence, subscription);
    return { billed: true, order, reason: null };
  } catch (error) {
    // Give back exactly what was taken, in the reverse order it was taken.
    if (rotationPlanned) {
      await unwindOccurrenceRotation(occurrence);
    }
    await releaseOccurrenceStock(occurrence);

    const reason = /balance/i.test(error.message)
      ? 'Customer prepaid balance is too low for this delivery'
      : `Billing failed: ${error.message}`;

    occurrence.status = 'skipped';
    occurrence.skipReason = reason;
    await occurrence.save();

    logger.error(
      `dairy subscription billing: occurrence ${occurrence._id} skipped — ${reason}`
    );
    return { billed: false, order: null, reason };
  }
};

/**
 * Withdraws an occurrence that was already generated and billed.
 *
 * Used when the customer cancels a plan, or asks for a delivery to be dropped,
 * after the nightly job has already charged for it. The order is cancelled, the
 * wallet is refunded and the stock is returned, in that order, so a failure never
 * refunds money for stock that is still held.
 *
 * @param {DairyRecurringOrder} occurrence
 * @param {string} reason
 */
const unwindOccurrence = async (occurrence, reason) => {
  if (occurrence.order) {
    const order = await DairyOrder.findById(occurrence.order);
    if (order && !['cancelled', 'refunded'].includes(order.status)) {
      const refundAmount = Number(order.grandTotal);

      if (order.paymentStatus === 'paid' && refundAmount > 0) {
        const wallet = await Wallet.findOne({ holderId: order.user });
        if (wallet) {
          await creditMoneyField(
            Wallet,
            wallet._id,
            'balance',
            toPaise(refundAmount),
            {
              $push: {
                meta: {
                  description: `Refund — dairy order #${order.orderNo}`,
                  amount: refundAmount,
                  date: new Date(),
                },
              },
            }
          );

          await transactionService.saveTransation({
            payableId: order.user,
            walletId: `${wallet._id}`,
            type: 'dairy_subscription_refund',
            amount: `-${refundAmount}`,
            confirmed: true,
            meta: [
              {
                reason: `Subscription delivery withdrawn: ${reason}`,
                order: `${order._id}`,
              },
            ],
            status: true,
          });

          order.walletAmount = 0;
        }
      }

      const previousStatus = order.status;
      order.status = 'cancelled';
      order.paymentStatus = 'refunded';
      order.cancellation = {
        cancelledAt: new Date(),
        cancelledBy: 'system',
        reason,
      };
      await order.save();

      await recordHistory(order, {
        fromStatus: previousStatus,
        toStatus: 'cancelled',
        actorType: 'system',
        reason,
        note: 'Subscription delivery withdrawn before dispatch',
      });
    }
  }

  // Order matters: the bottle that was going out goes back on the shelf before
  // the stock is credited, so an interruption can never leave the outlet short a
  // unit it is already recorded as holding.
  await unwindOccurrenceRotation(occurrence);
  await releaseOccurrenceStock(occurrence);

  occurrence.status = 'cancelled';
  occurrence.skipReason = reason;
  await occurrence.save();

  return occurrence;
};

/**
 * Marks the billed order delivered when its stop completes.
 *
 * Without this the order stays `confirmed` forever and — because settlements only
 * count delivered *and* paid orders — subscription revenue would be computed but
 * never settled. This is the single point that closes that loop.
 *
 * @param {DairyRecurringOrder} occurrence
 */
const markOccurrenceDelivered = async (occurrence) => {
  if (occurrence.status === 'delivered') {
    return occurrence;
  }

  occurrence.status = 'delivered';
  await occurrence.save();

  if (occurrence.order) {
    const order = await DairyOrder.findById(occurrence.order);
    if (order && !['delivered', 'cancelled', 'refunded'].includes(order.status)) {
      const previousStatus = order.status;
      order.status = 'delivered';
      order.deliveredAt = new Date();
      await order.save();

      await recordHistory(order, {
        fromStatus: previousStatus,
        toStatus: 'delivered',
        actorType: 'system',
        note: 'Subscription delivery completed',
      });
    }
  }

  return occurrence;
};

module.exports = {
  reserveOccurrenceStock,
  releaseOccurrenceStock,
  ensureContainerAssignment,
  prepareOccurrenceRotation,
  unwindOccurrenceRotation,
  billOccurrence,
  prepareOccurrence,
  unwindOccurrence,
  markOccurrenceDelivered,
};

/**
 * Close the subscription loop when the shared delivery kernel reports a stop done.
 *
 * Registration happens on import, so the kernel never imports dairy — it only
 * emits. Loaded for the running app via the manifest service, which the dairy
 * routes require.
 */
deliveryHooks.register('stop.delivered', async ({ stop }) => {
  if (!stop.subscription) {
    return;
  }

  const occurrence = await DairyRecurringOrder.findOne({ stop: stop._id });
  if (occurrence) {
    await markOccurrenceDelivered(occurrence);
  }
});

/**
 * A stop the rider could not complete. If the customer was prepaid, the money is
 * owed back — a delivery that never happened must not stay charged.
 */
deliveryHooks.register('stop.not_delivered', async ({ stop, reason }) => {
  if (!stop.subscription) {
    return;
  }

  const occurrence = await DairyRecurringOrder.findOne({ stop: stop._id });
  if (occurrence && occurrence.status !== 'delivered') {
    await unwindOccurrence(occurrence, `Delivery could not be completed: ${reason}`);
  }
});
