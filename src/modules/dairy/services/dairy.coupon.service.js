const { status: httpStatus } = require('http-status');
const {
  Business, DairyCoupon, DairyCouponRedemption, DairyCartItem, DairyOrder,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');

const idOf = (value) => String(value?._id || value || '');
const normalizeCode = (code) => String(code || '').trim().toUpperCase();

const calculateDiscount = (coupon, subtotal) => {
  if (subtotal < coupon.minOrderAmount) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Minimum order for this coupon is ₹${coupon.minOrderAmount.toFixed(2)}`);
  }
  let amount = coupon.discountType === 'percentage'
    ? subtotal * Number(coupon.discountValue) / 100
    : Math.min(subtotal, Number(coupon.discountValue));
  if (coupon.maxDiscountAmount != null) amount = Math.min(amount, coupon.maxDiscountAmount);
  amount = Math.min(subtotal, Number(amount.toFixed(2)));
  return amount;
};

const assertCouponUsable = async ({ coupon, businessId, subtotal, userId }) => {
  const now = new Date();
  if (!coupon || coupon.status !== 'active' || coupon.approval?.status !== 'approved' || coupon.startsAt > now || coupon.endsAt <= now) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This Dairy coupon is not active');
  }
  if (idOf(coupon.business) !== idOf(businessId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This coupon is for a different Dairy outlet');
  }
  if (coupon.maxRedemptions != null && (Number(coupon.reservedCount || 0) + Number(coupon.redeemedCount || 0)) >= coupon.maxRedemptions) {
    throw new ApiError(httpStatus.CONFLICT, 'This coupon has reached its redemption limit');
  }
  if (userId) {
    const existing = await DairyCouponRedemption.findOne({ coupon: coupon._id, user: userId });
    if (existing && existing.status !== 'released') {
      throw new ApiError(httpStatus.CONFLICT, 'This coupon has already been used or is reserved on another order');
    }
  }
  const discountAmount = calculateDiscount(coupon, subtotal);
  if (discountAmount <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'This coupon does not apply to this cart');
  return discountAmount;
};

const quoteCartCoupon = async ({ userId, code }) => {
  const cart = await DairyCartItem.find({ user: userId }).select('business price quantity');
  if (!cart.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Cart is empty');
  const businessIds = [...new Set(cart.map((row) => idOf(row.business)))];
  if (businessIds.length !== 1) throw new ApiError(httpStatus.BAD_REQUEST, 'An order can only contain items from one outlet');
  const business = await Business.findOne({ _id: businessIds[0], vertical: 'dairy', status: true }).select('_id');
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Active Dairy outlet not found');
  const subtotal = Number(cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0).toFixed(2));
  const coupon = await DairyCoupon.findOne({ business: business._id, code: normalizeCode(code) }).select('+reservedCount');
  const discountAmount = await assertCouponUsable({ coupon, businessId: business._id, subtotal, userId });
  return {
    code: coupon.code,
    title: coupon.title,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    subtotal,
    discountAmount,
    payableSubtotal: Number((subtotal - discountAmount).toFixed(2)),
    endsAt: coupon.endsAt,
  };
};

const listCartCoupons = async ({ userId }) => {
  const cart = await DairyCartItem.find({ user: userId }).select('business price quantity');
  if (!cart.length) return { coupons: [] };
  const businessIds = [...new Set(cart.map((row) => idOf(row.business)))];
  if (businessIds.length !== 1) return { coupons: [] };
  const subtotal = Number(cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0).toFixed(2));
  const now = new Date();
  const coupons = await DairyCoupon.find({
    business: businessIds[0], status: 'active', 'approval.status': 'approved',
    startsAt: { $lte: now }, endsAt: { $gt: now },
  }).select('+reservedCount').sort({ endsAt: 1 }).limit(50);
  const available = [];
  for (const coupon of coupons) {
    if (coupon.maxRedemptions != null && (coupon.reservedCount + coupon.redeemedCount) >= coupon.maxRedemptions) continue;
    const used = await DairyCouponRedemption.exists({ coupon: coupon._id, user: userId, status: { $ne: 'released' } });
    if (used || subtotal < coupon.minOrderAmount) continue;
    const discountAmount = calculateDiscount(coupon, subtotal);
    available.push({
      code: coupon.code,
      title: coupon.title,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount,
      minOrderAmount: coupon.minOrderAmount,
      endsAt: coupon.endsAt,
    });
  }
  return { coupons: available };
};

const listPartnerCoupons = async ({ businessId, status } = {}) => {
  const filter = { business: businessId };
  if (status) filter.status = status;
  return DairyCoupon.find(filter).sort({ createdAt: -1 }).limit(100);
};

/** Coupon reporting is outlet-scoped and returns no customer-identifying data. */
const getPartnerCouponReport = async ({ businessId, couponId, from, to }) => {
  const coupon = await DairyCoupon.findOne({ _id: couponId, business: businessId }).select('+reservedCount');
  if (!coupon) throw new ApiError(httpStatus.NOT_FOUND, 'Coupon not found');
  const business = await Business.findOne({ _id: businessId, vertical: 'dairy' }).select('dairyOperations.timezone');
  const timezone = business?.dairyOperations?.timezone || 'Asia/Kolkata';
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a valid coupon report date range');
  }
  if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Coupon reports can cover at most 366 days');
  }

  const reportFilter = {
    coupon: coupon._id,
    business: businessId,
    status: 'redeemed',
    redeemedAt: { $gte: start, $lt: end },
  };
  const settleableOrderFilter = {
    coupon: coupon._id,
    business: businessId,
    status: 'delivered',
    paymentStatus: 'paid',
    deliveredAt: { $gte: start, $lt: end },
  };
  const statusFilter = { coupon: coupon._id, business: businessId };
  const joinOrder = {
    $lookup: {
      from: DairyOrder.collection.name,
      localField: 'order',
      foreignField: '_id',
      as: 'orderRecord',
    },
  };
  const [totals, daily, settlementTotals, settlementDaily, reservedCount, releasedCount, cancelledAfterRedemptionCount] = await Promise.all([
    DairyCouponRedemption.aggregate([
      { $match: reportFilter },
      joinOrder,
      { $unwind: { path: '$orderRecord', preserveNullAndEmptyArrays: true } },
      { $group: {
        _id: null,
        redemptions: { $sum: 1 },
        discountPaise: { $sum: { $ifNull: ['$orderRecord.discountAmount', 0] } },
      } },
    ]),
    DairyCouponRedemption.aggregate([
      { $match: reportFilter },
      joinOrder,
      { $unwind: { path: '$orderRecord', preserveNullAndEmptyArrays: true } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$redeemedAt', timezone } },
        redemptions: { $sum: 1 },
        discountPaise: { $sum: { $ifNull: ['$orderRecord.discountAmount', 0] } },
      } },
      { $sort: { _id: 1 } },
    ]),
    DairyOrder.aggregate([
      { $match: settleableOrderFilter },
      { $group: {
        _id: null,
        orders: { $sum: 1 },
        grossItemSalesPaise: { $sum: { $ifNull: ['$itemTotal', 0] } },
        couponDiscountPaise: { $sum: { $ifNull: ['$discountAmount', 0] } },
        netItemSalesPaise: { $sum: { $subtract: [{ $ifNull: ['$itemTotal', 0] }, { $ifNull: ['$discountAmount', 0] }] } },
      } },
    ]),
    DairyOrder.aggregate([
      { $match: settleableOrderFilter },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$deliveredAt', timezone } },
        orders: { $sum: 1 },
        grossItemSalesPaise: { $sum: { $ifNull: ['$itemTotal', 0] } },
        couponDiscountPaise: { $sum: { $ifNull: ['$discountAmount', 0] } },
        netItemSalesPaise: { $sum: { $subtract: [{ $ifNull: ['$itemTotal', 0] }, { $ifNull: ['$discountAmount', 0] }] } },
      } },
      { $sort: { _id: 1 } },
    ]),
    DairyCouponRedemption.countDocuments({ ...statusFilter, status: 'reserved' }),
    DairyCouponRedemption.countDocuments({
      ...statusFilter,
      status: 'released',
      releasedAt: { $gte: start, $lt: end },
    }),
    DairyCouponRedemption.countDocuments({
      ...statusFilter,
      status: 'released',
      redeemedAt: { $gte: start, $lt: end },
    }),
  ]);
  const total = totals[0] || { redemptions: 0, discountPaise: 0 };
  const discountAmount = Number((total.discountPaise / 100).toFixed(2));
  const settlement = settlementTotals[0] || { orders: 0, grossItemSalesPaise: 0, couponDiscountPaise: 0, netItemSalesPaise: 0 };
  return {
    coupon: {
      id: coupon._id,
      code: coupon.code,
      title: coupon.title,
      status: coupon.status,
      startsAt: coupon.startsAt,
      endsAt: coupon.endsAt,
      maxRedemptions: coupon.maxRedemptions,
      redeemedCount: coupon.redeemedCount,
      reservedCount: coupon.reservedCount || 0,
    },
    period: { from: start, to: end, timezone },
    summary: {
      redemptions: total.redemptions,
      discountAmount,
      averageDiscount: total.redemptions ? Number((discountAmount / total.redemptions).toFixed(2)) : 0,
      reservedCount,
      releasedCount,
      cancelledAfterRedemptionCount,
    },
    settlementImpact: {
      basis: 'Delivered and paid orders, matching Dairy settlement eligibility.',
      orders: settlement.orders,
      grossItemSales: Number((settlement.grossItemSalesPaise / 100).toFixed(2)),
      couponDiscount: Number((settlement.couponDiscountPaise / 100).toFixed(2)),
      netItemSalesAfterCoupon: Number((settlement.netItemSalesPaise / 100).toFixed(2)),
      note: 'Merchandise sales after coupon discount, before taxes, delivery charges, commission, and payout adjustments.',
    },
    daily: daily.map((row) => ({
      date: row._id,
      redemptions: row.redemptions,
      discountAmount: Number((row.discountPaise / 100).toFixed(2)),
    })),
    settlementDaily: settlementDaily.map((row) => ({
      date: row._id,
      orders: row.orders,
      grossItemSales: Number((row.grossItemSalesPaise / 100).toFixed(2)),
      couponDiscount: Number((row.couponDiscountPaise / 100).toFixed(2)),
      netItemSalesAfterCoupon: Number((row.netItemSalesPaise / 100).toFixed(2)),
    })),
  };
};

const createPartnerCoupon = async ({ businessId, actorId, ...payload }) => {
  const business = await Business.findOne({ _id: businessId, vertical: 'dairy', status: true }).select('_id');
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Active Dairy outlet not found');
  const code = normalizeCode(payload.code);
  const startsAt = new Date(payload.startsAt);
  const endsAt = new Date(payload.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Coupon end time must be after its start time');
  }
  if (startsAt < new Date(Date.now() - 60_000)) throw new ApiError(httpStatus.BAD_REQUEST, 'Coupon start time cannot be in the past');
  if (payload.discountType === 'percentage' && Number(payload.discountValue) > 100) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Percentage discount cannot exceed 100%');
  }
  if (payload.discountType === 'percentage' && !payload.maxDiscountAmount) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Set a maximum discount amount for percentage coupons');
  }
  try {
    return await DairyCoupon.create({ ...payload, code, business: business._id, createdBy: actorId, status: 'pending_review', approval: { status: 'pending' } });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'This outlet already has a coupon with that code');
    throw error;
  }
};

const disablePartnerCoupon = async ({ businessId, couponId }) => {
  const coupon = await DairyCoupon.findOne({ _id: couponId, business: businessId });
  if (!coupon) throw new ApiError(httpStatus.NOT_FOUND, 'Coupon not found');
  if (coupon.status === 'disabled') return coupon;
  if (!['pending_review', 'active'].includes(coupon.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'Only pending or active coupons can be disabled');
  }
  coupon.status = 'disabled';
  await coupon.save();
  return coupon;
};

const listAdminCoupons = async ({ status, page = 1, limit = 20 } = {}) => {
  const paging = { page: Math.max(1, Number(page) || 1), limit: Math.min(100, Math.max(1, Number(limit) || 20)) };
  const filter = status ? { status } : {};
  const [coupons, totalResults] = await Promise.all([
    DairyCoupon.find(filter).populate('business', 'name code city locality').sort({ createdAt: -1 })
      .skip((paging.page - 1) * paging.limit).limit(paging.limit),
    DairyCoupon.countDocuments(filter),
  ]);
  return { coupons, totalResults, ...paging };
};

const reviewCoupon = async ({ couponId, reviewerId, decision, note = '' }) => {
  const coupon = await DairyCoupon.findById(couponId);
  if (!coupon) throw new ApiError(httpStatus.NOT_FOUND, 'Coupon not found');
  if (coupon.status !== 'pending_review') throw new ApiError(httpStatus.CONFLICT, 'Only coupons awaiting review can be moderated');
  if (decision === 'approve' && coupon.endsAt <= new Date()) throw new ApiError(httpStatus.CONFLICT, 'This coupon has already expired');
  coupon.approval = { status: decision === 'approve' ? 'approved' : 'rejected', by: reviewerId, at: new Date(), note: note.trim() };
  coupon.status = decision === 'approve' ? 'active' : 'rejected';
  await coupon.save();
  return coupon;
};

/** Reserve a coupon limit atomically before the order reserves inventory. */
const reserveForOrder = async ({ code, businessId, userId, orderId, subtotal }) => {
  if (!code) return null;
  const coupon = await DairyCoupon.findOne({ business: businessId, code: normalizeCode(code) }).select('+reservedCount');
  const discountAmount = await assertCouponUsable({ coupon, businessId, subtotal, userId });
  const limitFilter = {
    _id: coupon._id,
    status: 'active',
    'approval.status': 'approved',
    startsAt: { $lte: new Date() },
    endsAt: { $gt: new Date() },
    ...(coupon.maxRedemptions == null ? {} : {
      $expr: { $lt: [{ $add: [{ $ifNull: ['$reservedCount', 0] }, { $ifNull: ['$redeemedCount', 0] }] }, coupon.maxRedemptions] },
    }),
  };
  const reservedCoupon = await DairyCoupon.findOneAndUpdate(limitFilter, { $inc: { reservedCount: 1 } }, { new: true }).select('+reservedCount');
  if (!reservedCoupon) throw new ApiError(httpStatus.CONFLICT, 'This coupon has reached its redemption limit or is no longer active');
  try {
    const prior = await DairyCouponRedemption.findOne({ coupon: coupon._id, user: userId });
    let redemption;
    if (prior) {
      redemption = await DairyCouponRedemption.findOneAndUpdate(
        { _id: prior._id, status: 'released' },
        { $set: { business: businessId, order: orderId, status: 'reserved', reservedAt: new Date(), releasedAt: null, redeemedAt: null } },
        { new: true }
      );
      if (!redemption) throw Object.assign(new Error('Coupon redemption already exists'), { code: 11000 });
    } else {
      redemption = await DairyCouponRedemption.create({ coupon: coupon._id, user: userId, business: businessId, order: orderId, status: 'reserved' });
    }
    return {
      coupon: reservedCoupon,
      redemption,
      discountAmount,
      snapshot: { title: reservedCoupon.title, discountType: reservedCoupon.discountType, discountValue: reservedCoupon.discountValue },
    };
  } catch (error) {
    await DairyCoupon.updateOne({ _id: coupon._id, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 } });
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'This coupon has already been used or is reserved on another order');
    throw error;
  }
};

const finishRedemption = async (orderId) => {
  const redemption = await DairyCouponRedemption.findOneAndUpdate(
    { order: orderId, status: 'reserved' },
    { $set: { status: 'redeemed', redeemedAt: new Date() } },
    { new: true }
  );
  if (!redemption) return false;
  await DairyCoupon.updateOne({ _id: redemption.coupon, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1, redeemedCount: 1 } });
  return true;
};

const releaseRedemption = async (orderId) => {
  const redemption = await DairyCouponRedemption.findOne({ order: orderId, status: { $in: ['reserved', 'redeemed'] } });
  if (!redemption) return false;
  const previousStatus = redemption.status;
  const changed = await DairyCouponRedemption.updateOne(
    { _id: redemption._id, status: previousStatus },
    { $set: { status: 'released', releasedAt: new Date() } }
  );
  if (!changed.modifiedCount) return false;
  if (previousStatus === 'reserved') {
    await DairyCoupon.updateOne({ _id: redemption.coupon, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 } });
  } else {
    await DairyCoupon.updateOne({ _id: redemption.coupon, redeemedCount: { $gt: 0 } }, { $inc: { redeemedCount: -1 } });
  }
  return true;
};

module.exports = {
  quoteCartCoupon,
  listCartCoupons,
  listPartnerCoupons,
  getPartnerCouponReport,
  createPartnerCoupon,
  disablePartnerCoupon,
  listAdminCoupons,
  reviewCoupon,
  reserveForOrder,
  finishRedemption,
  releaseRedemption,
};
