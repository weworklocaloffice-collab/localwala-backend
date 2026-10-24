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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const promotionService = require('../services/stores.promotion.service');
const couponService = require('../services/stores.coupon.service');

const validatePromotion = catchAsync(async (req, res) => {
  const promo = await promotionService.validatePromotion({
    chain: req.chainId,
    outlet: req.outletId,
    code: req.body.code,
    cartAmount: req.body.cartAmount,
    customerId: req.user._id,
  });
  const discount = promotionService.calculateDiscount(promo, req.body.cartAmount);
  res.status(httpStatus.OK).send({ promotion: promo, discount });
});

const createPromotion = catchAsync(async (req, res) => {
  const promotion = await promotionService.createPromotion({
    ...req.body,
    chain: req.chainId,
    outlet: req.outletId,
    createdBy: req.user._id,
  });
  res.status(httpStatus.CREATED).send({ promotion });
});

const listPromotions = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'page', 'limit']);
  const result = await promotionService.listPromotions({ ...filter, chain: req.chainId, outlet: req.outletId });
  res.status(httpStatus.OK).send(result);
});

const pausePromotion = catchAsync(async (req, res) => {
  const promotion = await promotionService.pausePromotion({
    promotion: req.params.promotion,
    chain: req.chainId,
    outlet: req.outletId,
  });
  res.status(httpStatus.OK).send({ promotion });
});

const resumePromotion = catchAsync(async (req, res) => {
  const promotion = await promotionService.resumePromotion({
    promotion: req.params.promotion,
    chain: req.chainId,
    outlet: req.outletId,
  });
  res.status(httpStatus.OK).send({ promotion });
});

const createCoupon = catchAsync(async (req, res) => {
  const coupon = await couponService.createCoupon({
    ...req.body,
    chain: req.chainId,
    outlet: req.outletId,
    createdBy: req.user._id,
  });
  res.status(httpStatus.CREATED).send({ coupon });
});

const listCoupons = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'page', 'limit']);
  const result = await couponService.listCoupons({ ...filter, chain: req.chainId, outlet: req.outletId });
  res.status(httpStatus.OK).send(result);
});

module.exports = {
  validatePromotion,
  createPromotion,
  listPromotions,
  pausePromotion,
  resumePromotion,
  createCoupon,
  listCoupons,
};