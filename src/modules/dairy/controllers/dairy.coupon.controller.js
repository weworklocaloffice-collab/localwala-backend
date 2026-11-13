const catchAsync = require('../../../utils/catchAsync');
const couponService = require('../services/dairy.coupon.service');

const quote = catchAsync(async (req, res) => {
  res.send({ quote: await couponService.quoteCartCoupon({ userId: req.user._id, code: req.body.code }) });
});

const available = catchAsync(async (req, res) => {
  res.send(await couponService.listCartCoupons({ userId: req.user._id }));
});

const partnerList = catchAsync(async (req, res) => {
  res.send({ coupons: await couponService.listPartnerCoupons({ businessId: req.outletId, status: req.query.status }) });
});

const partnerReport = catchAsync(async (req, res) => {
  res.send({ report: await couponService.getPartnerCouponReport({
    businessId: req.outletId,
    couponId: req.params.coupon,
    from: req.query.from,
    to: req.query.to,
  }) });
});

const create = catchAsync(async (req, res) => {
  const coupon = await couponService.createPartnerCoupon({ ...req.body, businessId: req.outletId, actorId: req.user._id });
  res.status(201).send({ coupon });
});

const disable = catchAsync(async (req, res) => {
  const coupon = await couponService.disablePartnerCoupon({ businessId: req.outletId, couponId: req.params.coupon });
  res.send({ coupon });
});

const adminList = catchAsync(async (req, res) => {
  res.send(await couponService.listAdminCoupons(req.query));
});

const review = catchAsync(async (req, res) => {
  const coupon = await couponService.reviewCoupon({ couponId: req.params.coupon, reviewerId: req.user._id, ...req.body });
  res.send({ coupon });
});

module.exports = { quote, available, partnerList, partnerReport, create, disable, adminList, review };
