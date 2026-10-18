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

const { DateTime } = require('luxon');
const { WalletBonus } = require('../models');
const {
  walletService,
  transactionService,
  ordersService,
  fcmNotificationService,
  userPurchasedTiffinSubscriptionService,
  diningBookingService,
  restaurantJoiningRequestService,
  subscriberService,
  adminExpenseService,
} = require('../services');
const storesPaymentService = require('../modules/stores/services/stores.payment.service');
const realEstatePaymentService = require('../modules/realestate/services/realestate.payment.service');
const localServicePaymentService = require('../modules/local-services/services/localservice.payment.service');
const jhatkaPaymentService = require('../modules/jhatka/services/jhatka.payment.service');

/**
 * payment.dispatch.js — the post-success dispatch for the shared payment
 * stack.
 *
 * ## Why this file exists (F-4 in the Real Estate plan)
 *
 * `payment.initiation.controller.js` carried the same `paymentFrom`
 * switch nine times — once per gateway. Six legacy values (wallet,
 * order, tiffinsubscription, booking, restaurant_register,
 * renew_subscription) × 9 gateways = 54 near-identical inline branches.
 * Adding a tenth paymentFrom meant editing the 2 573-line controller
 * in nine places.
 *
 * This module collapses all of that into one entry point. Each gateway
 * verifies the payment (gateway-specific) and then calls
 * `dispatchPaidCallback(payment)`. The dispatch tries the stores
 * module, then the real-estate module, then falls through to the legacy
 * map.
 *
 * ## Adding a new paymentFrom
 *
 *  • If it belongs to an existing vertical (stores, real-estate), add it
 *    to that module's `REAL_*_PAYMENT_SUBJECTS` and to its
 *    `routePaidCallback` switch. The dispatch picks it up automatically.
 *  • If it is a new vertical, copy the stores/real-estate pattern: a
 *    `<vertical>.payment.service.js` with a `routePaidCallback` that
 *    returns `true` when it handled the payment, and a new line in
 *    `dispatchPaidCallback` ahead of the legacy fallback.
 *  • If it is a one-off legacy value, add it to `LEGACY_HANDLERS` below.
 *    Do NOT add it to the controller.
 *
 * The `verify.payment.dispatch.js` script asserts the controller never
 * carries an inline `paymentFrom === 'X'` chain, so a missed step fails
 * the build.
 */

// ---------------------------------------------------------------------------
// Legacy handlers — the six values that predate the per-vertical bridge.
// They run only when neither stores nor real-estate claims the payment.
// ---------------------------------------------------------------------------

/**
 * `wallet` — top up the user's wallet. Honours bonus offers in effect at
 * the moment of the callback, and records the corresponding bonus
 * expense if any.
 */
const handleWalletPayment = async (payment) => {
  const walletInfo = await walletService.getWalletByUserId(payment.users.id);
  if (walletInfo === null || walletInfo.id === null) return;

  const oldBalance = walletInfo.balance;
  const userWalletId = walletInfo.id;

  const currentDate = DateTime.now().toJSDate();
  const walletAmount = parseFloat(parseFloat(payment.amount).toFixed(2) * 100).toFixed(2);
  const bonusOffer = await WalletBonus.findOne(
    {
      minWalletAmount: { $lte: walletAmount },
      start: { $lte: currentDate },
      expires: { $gte: currentDate },
      status: true,
    },
    { name: 1, bonusType: 1, bonusAmount: 1, minWalletAmount: 1, maxBonusAmount: 1 }
  );

  let newBonusAmount = 0;
  if (bonusOffer !== null && bonusOffer.id !== '') {
    if (bonusOffer.bonusType === 'amount') {
      newBonusAmount = bonusOffer.bonusAmount;
    } else if (bonusOffer.bonusType === 'percentage') {
      const minCouponDiscount = parseFloat(
        (parseFloat(payment.amount) * parseFloat(bonusOffer.bonusAmount)) / 100
      ).toFixed(2);
      const maxCouponDiscount = parseFloat(
        (parseFloat(payment.amount) * parseFloat(bonusOffer.maxBonusAmount)) / 100
      ).toFixed(2);
      // The original controller carries an odd check on the offer name's
      // parity to pick between min and max. We keep the behaviour exact
      // so a refactor does not silently change a customer's bonus.
      const lengthOfCouponCode = parseInt(bonusOffer.name.length, 10);
      newBonusAmount = lengthOfCouponCode % 2 === 0
        ? parseFloat(minCouponDiscount)
        : parseFloat(maxCouponDiscount);
    }
  }

  const newBalance = parseFloat(
    parseFloat(oldBalance) + parseFloat(payment.amount) + parseFloat(newBonusAmount)
  ).toFixed(2);
  await walletService.updateWallet(userWalletId, { balance: newBalance });
  await transactionService.saveTransation({
    payableId: payment.users.id,
    walletId: userWalletId,
    type: 'deposite',
    amount: payment.amount,
    confirmed: true,
    meta: payment.payResponse,
    status: true,
  });

  if (parseFloat(newBonusAmount) > 0) {
    await adminExpenseService.saveExpense({
      expenseType: 'wallet_bonus',
      coupon: null,
      diningCoupon: null,
      diningBooking: null,
      order: null,
      user: payment.users.id,
      amount: `${newBonusAmount}`,
    });
  }
};

/**
 * `order` — restaurant food order; flip to `created` and notify the
 * restaurant.
 */
const handleOrderPayment = async (payment) => {
  const orderInfoMeta = await ordersService.getOrderMetaNotification(payment.orders);
  if (
    orderInfoMeta === null ||
    orderInfoMeta.user === null ||
    orderInfoMeta.restaurant === null
  ) {
    return;
  }
  await ordersService.updateOrderStatus(payment.orders, { status: 'created' });
  await fcmNotificationService.restaurantNewOrder(
    payment.orders,
    orderInfoMeta.restaurant,
    orderInfoMeta.user
  );
};

/**
 * `tiffinsubscription` — daily-subscription purchase; flip to `created`
 * and notify the customer.
 */
const handleTiffinSubscriptionPayment = async (payment) => {
  await userPurchasedTiffinSubscriptionService.updateSubscriptionStatus(
    payment.tiffinSubscription,
    { status: 'created' }
  );
  await fcmNotificationService.purchasedTiffinSubscriptionPackage(
    payment.tiffinSubscription
  );
};

/**
 * `booking` — restaurant table booking; flip to `created` and notify the
 * restaurant.
 */
const handleDiningBookingPayment = async (payment) => {
  const meta = await diningBookingService.getDiningBookingMetaNotification(payment.booking);
  if (meta === null || meta.user === null || meta.restaurant === null) return;
  await diningBookingService.updateDiningBookingStatus(payment.booking, { status: 'created' });
  await fcmNotificationService.restaurantNewBooking(
    payment.booking,
    meta.restaurant,
    meta.user,
    meta.userName
  );
};

/**
 * `restaurant_register` — vendor onboarding fee; flip to `created`.
 */
const handleRestaurantRegisterPayment = async (payment) => {
  await restaurantJoiningRequestService.updateRestaurantJoiningRequest(
    payment.restaurantRegisterRequest,
    { status: 'created' }
  );
};

/**
 * `renew_subscription` — platform subscription renewal.
 */
const handleRenewSubscriptionPayment = async (payment) => {
  await subscriberService.renewSubscription(payment.subscribeId);
};

/**
 * The closed set of legacy paymentFrom values. Kept as a closed enum so
 * a typo in a future caller fails fast, instead of silently running
 * nothing and leaving the payment stuck at "paid but unhandled".
 */
const LEGACY_PAYMENT_HANDLERS = Object.freeze({
  wallet: handleWalletPayment,
  order: handleOrderPayment,
  tiffinsubscription: handleTiffinSubscriptionPayment,
  booking: handleDiningBookingPayment,
  restaurant_register: handleRestaurantRegisterPayment,
  renew_subscription: handleRenewSubscriptionPayment,
});

const KNOWN_PAYMENT_SUBJECTS = Object.freeze([
  ...storesPaymentService.STORE_PAYMENT_SUBJECTS,
  ...realEstatePaymentService.REAL_ESTATE_PAYMENT_SUBJECTS,
  ...localServicePaymentService.LS_PAYMENT_SUBJECTS,
  ...jhatkaPaymentService.JHATKA_PAYMENT_SUBJECTS,
  ...Object.keys(LEGACY_PAYMENT_HANDLERS),
]);

/**
 * Dispatch a paid payment initiation to the correct downstream handler.
 *
 * Order matters: per-vertical bridges run first (they own the more
 * recent subjects and may also claim a legacy value if their vertical
 * ever overlaps — currently neither does). The legacy map is the
 * fall-through. Unknown subjects are logged and dropped, so a missing
 * handler cannot leave a payment stuck at "paid" forever.
 *
 * @param {object} payment the initiation document (`paymentInfo.payments`)
 * @returns {Promise<{ handled: boolean, subject: string | null }>}
 */
const dispatchPaidCallback = async (payment) => {
  if (!payment || !payment.paymentFrom) {
    return { handled: false, subject: null };
  }

  if (await storesPaymentService.routePaidCallback(payment)) {
    return { handled: true, subject: payment.paymentFrom };
  }
  if (await realEstatePaymentService.routePaidCallback(payment)) {
    return { handled: true, subject: payment.paymentFrom };
  }
  if (await localServicePaymentService.routePaidCallback(payment)) {
    return { handled: true, subject: payment.paymentFrom };
  }
  if (await jhatkaPaymentService.routePaidCallback(payment)) {
    return { handled: true, subject: payment.paymentFrom };
  }

  const handler = LEGACY_PAYMENT_HANDLERS[payment.paymentFrom];
  if (handler) {
    await handler(payment);
    return { handled: true, subject: payment.paymentFrom };
  }

  // Loud-and-clear: an unknown subject is a configuration bug. The
  // payment is "paid" at the gateway but no service will move it
  // forward. A silent drop would let this fester.
  console.error(
    `[payment.dispatch] no handler for paymentFrom="${payment.paymentFrom}" (known: ${KNOWN_PAYMENT_SUBJECTS.join(', ')})`
  );
  return { handled: false, subject: payment.paymentFrom };
};

/**
 * Dispatch an ABANDONED or DECLINED payment to its vertical.
 *
 * ## Why this is not the same as `dispatchPaidCallback`
 *
 * Every failure branch in the gateway controller does one of two things: redirect to
 * a failed URL, or return a 400. Neither writes `PaymentInitiation.status`, so a
 * declined payment is indistinguishable from one the customer walked away from — both
 * sit at `initiated` forever. That is not a cosmetic gap: an order stuck at
 * `PAYMENT_PENDING` is an order the outlet has already committed stock and labour to,
 * and `PAYMENT_FAILED` is the state that says "this one is retryable".
 *
 * The dominant case is not a decline at all — it is a customer who tapped Pay,
 * got distracted, and closed the app. No gateway ever calls back. So this function
 * exists for the EXPLICIT failure, and the timeout sweep in each vertical exists for
 * the implicit one. Both routes end in the same place.
 *
 * Same contract as the success path: return `true` when claimed, `false` to continue.
 *
 * @param {object} payment the initiation document
 * @param {string} [reason] human-readable, stored on the order
 * @returns {Promise<{handled: boolean, subject: string|null}>}
 */
const dispatchFailedCallback = async (payment, reason) => {
  if (!payment || !payment.paymentFrom) {
    return { handled: false, subject: null };
  }

  if (await jhatkaPaymentService.routeFailedCallback(payment, reason)) {
    return { handled: true, subject: payment.paymentFrom };
  }

  // No other vertical models a failure state. Logging rather than silently dropping,
  // for the same reason the success path logs an unknown subject: a payment stuck in
  // an unhandled state is a configuration bug, and it should be visible.
  console.warn(
    `[payment.dispatch] no failure handler for paymentFrom="${payment.paymentFrom}" (known: ${KNOWN_PAYMENT_SUBJECTS.join(', ')})`
  );
  return { handled: false, subject: payment.paymentFrom };
};

module.exports = {
  LEGACY_PAYMENT_HANDLERS,
  KNOWN_PAYMENT_SUBJECTS,
  dispatchPaidCallback,
  dispatchFailedCallback,
  // Exported for tests + verify scripts.
  _internal: {
    handleWalletPayment,
    handleOrderPayment,
    handleTiffinSubscriptionPayment,
    handleDiningBookingPayment,
    handleRestaurantRegisterPayment,
    handleRenewSubscriptionPayment,
  },
};
