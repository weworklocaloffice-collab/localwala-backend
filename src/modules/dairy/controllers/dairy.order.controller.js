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

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const dairyCartService = require('../services/dairy.cart.service');
const dairyOrderService = require('../services/dairy.order.service');

// //// Cart ////

const addToCart = catchAsync(async (req, res) => {
  const item = await dairyCartService.addItem({ ...req.body, user: req.user._id });
  res.send({ item });
});

const getCart = catchAsync(async (req, res) => {
  const cart = await dairyCartService.getCart(req.user._id);
  res.send(cart);
});

const updateCartQuantity = catchAsync(async (req, res) => {
  const item = await dairyCartService.updateQuantity(req.user._id, req.params.item, req.body.quantity);
  res.send({ item, removed: item === null });
});

const removeCartItem = catchAsync(async (req, res) => {
  await dairyCartService.removeItem(req.user._id, req.params.item);
  res.send({ success: true });
});

const clearCart = catchAsync(async (req, res) => {
  await dairyCartService.clear(req.user._id);
  res.send({ success: true });
});

/** Reports price drift without mutating, so the customer chooses. */
const refreshPrices = catchAsync(async (req, res) => {
  const result = await dairyCartService.refreshPrices(req.user._id);
  res.send(result);
});

const applyPriceChanges = catchAsync(async (req, res) => {
  const result = await dairyCartService.applyPriceChanges(req.user._id, req.body.itemIds);
  res.send(result);
});

// //// Checkout and payment ////

/**
 * Turns the cart into a pending order, reserving stock and can deposits.
 *
 * Nothing is charged here — the order sits at `pending_payments` so a failed
 * payment leaves the cart intact to retry.
 */
const checkout = catchAsync(async (req, res) => {
  const order = await dairyOrderService.createOrder({
    ...req.body,
    user: req.user._id,
    location: req.body.coordinates ? { type: 'Point', coordinates: req.body.coordinates } : undefined,
  });
  res.send({ order });
});

const pay = catchAsync(async (req, res) => {
  const order = await dairyOrderService.payOrder(req.params.order, {
    ...req.body,
    user: req.user._id,
  });
  res.send({ order });
});

const orderDetail = catchAsync(async (req, res) => {
  // The owner comes from the token, not `?user=`. Reading it from the query meant
  // omitting the parameter skipped the ownership check entirely, so any customer
  // could read any order by guessing its id.
  const order = await dairyOrderService.getOrder(req.params.order, { userId: req.user._id });
  res.send({ order });
});

const orderList = catchAsync(async (req, res) => {
    const result = await dairyOrderService.listOrders({
      ...req.query,
      // Last write wins, so a `?business=` in the query cannot widen the list.
      business: req.outletId,
    });
    res.send(pick(result, ['orders', 'totalResults', 'page', 'limit']));
  });

const orderHistory = catchAsync(async (req, res) => {
  const history = await dairyOrderService.listHistory(req.params.order, req.query);
  res.send({ history, totalResults: history.length });
});

const updateStatus = catchAsync(async (req, res) => {
   // `businessId` is the token's outlet, so a partner can only move their own
   // outlet's orders along. It is deliberately not read from the body.
   const order = await dairyOrderService.updateStatus(req.params.order, req.params.status, {
     ...req.body,
     businessId: req.outletId,
     actor: req.user._id,
     actorType: req.outletId ? 'partner' : req.body.actorType,
   });
   res.send({ order });
   });

const cancel = catchAsync(async (req, res) => {
  const order = await dairyOrderService.cancelOrder(req.params.order, req.body);
  res.send({ order });
});

const dispatch = catchAsync(async (req, res) => {
   // Scoped to the token's outlet: a partner cannot dispatch another outlet's
   // order onto one of their runs.
   const result = await dairyOrderService.assignToRun(req.params.order, {
     ...req.body,
     businessId: req.outletId,
   });
   res.send(result);
   });

const orderSummary = catchAsync(async (req, res) => {
  // Scoped to the caller. This used to pass the user id into `getOrderSummary`,
  // whose parameter is a *business* id — so it silently aggregated orders for a
  // "business" whose id happened to be a customer's user id.
  const summary = await dairyOrderService.getCustomerOrderSummary(req.user._id, req.query);
  res.send({ summary });
});

/**
 * Revenue and order counts for one outlet.
 *
 * A separate handler from {@link orderSummary} because the two are opposites: a
 * customer asks about their own history, a partner asks about the outlet's whole
 * book. Sharing one handler meant the customer fix silently broke the partner
 * dashboard into returning the partner's own orders.
 */
const partnerOrderSummary = catchAsync(async (req, res) => {
  const summary = await dairyOrderService.getOrderSummary(req.outletId, req.query);
  res.send({ summary });
});

module.exports = {
  addToCart,
  getCart,
  updateCartQuantity,
  removeCartItem,
  clearCart,
  refreshPrices,
  applyPriceChanges,
  checkout,
  pay,
  orderDetail,
  orderList,
  orderHistory,
  updateStatus,
  cancel,
  dispatch,
  orderSummary,
  partnerOrderSummary,
};