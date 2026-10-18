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

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const ApiError = require('../../../utils/ApiError');
const Agreement = require('../models/localservice.recurring.agreement.model');
const Occurrence = require('../models/localservice.recurring.occurrence.model');

const createAgreement = catchAsync(async (req, res) => {
  const doc = await Agreement.create({
    customer: req.user._id,
    ...pick(req.body, ['service', 'provider', 'cadence', 'intervalCount', 'startDate', 'endDate', 'labourAmount', 'partsAmount']),
    nextOccurrenceDate: req.body.startDate,
    status: 'active',
  });
  res.status(httpStatus.CREATED).send({ agreement: doc });
});

const listAgreements = catchAsync(async (req, res) => {
  const filter = { customer: req.user._id, ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Agreement.paginate(filter, options));
});

const setAgreementStatus = catchAsync(async (req, res) => {
  const allowed = ['paused', 'cancelled', 'active'];
  if (!allowed.includes(req.params.status)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid agreement status');
  const doc = await Agreement.findOne({ _id: req.params.id, customer: req.user._id });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Agreement not found');
  doc.status = req.params.status;
  await doc.save();
  res.status(httpStatus.OK).send({ agreement: doc });
});

const listOccurrences = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['agreement', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Occurrence.paginate(filter, options));
});

module.exports = { createAgreement, listAgreements, setAgreementStatus, listOccurrences };
