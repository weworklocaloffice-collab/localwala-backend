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
const reviewService = require('../services/stores.review.service');

const createReview = catchAsync(async (req, res) => {
  const review = await reviewService.createReview({
    ...req.body,
    chain: req.chainId,
    outlet: req.outletId,
    customer: req.user._id,
  });
  res.status(httpStatus.CREATED).send({ review });
});

const moderateReview = catchAsync(async (req, res) => {
  const review = await reviewService.moderateReview(req.params.review, {
    ...req.body,
    reply: req.body.reply ? { ...req.body.reply, repliedBy: req.user._id } : undefined,
  });
  res.status(httpStatus.OK).send({ review });
});

const listReviews = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['product', 'status', 'page', 'limit']);
  const result = await reviewService.listReviews({ ...filter, outlet: req.outletId });
  res.status(httpStatus.OK).send(result);
});

const markHelpful = catchAsync(async (req, res) => {
  const review = await reviewService.markHelpful(req.params.review);
  res.status(httpStatus.OK).send({ review });
});

module.exports = {
  createReview,
  moderateReview,
  listReviews,
  markHelpful,
};