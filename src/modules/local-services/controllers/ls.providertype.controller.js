const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const ApiError = require('../../../utils/ApiError');
const LocalServiceProviderType = require('../models/localservice.providertype.model');
const service = require('../services/localservice.providertype.service');

const listPartner = catchAsync(async (req, res) => {
  res.status(httpStatus.OK).send({ results: await service.listActive() });
});

const listAdmin = catchAsync(async (req, res) => {
  const results = await service.listAll();
  res.status(httpStatus.OK).send({ results, totalResults: results.length });
});

const create = catchAsync(async (req, res) => {
  await service.ensureDefaults();
  const key = String(req.body.key).trim().toLowerCase();
  if (await LocalServiceProviderType.exists({ key })) {
    throw new ApiError(httpStatus.CONFLICT, 'Provider type already exists');
  }
  const doc = await LocalServiceProviderType.create({
    key,
    label: req.body.label,
    active: req.body.active !== false,
    sortOrder: req.body.sortOrder ?? 0,
  });
  res.status(httpStatus.CREATED).send({ providerType: doc });
});

const update = catchAsync(async (req, res) => {
  const doc = await LocalServiceProviderType.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Provider type not found');
  if (req.body.label !== undefined) doc.label = req.body.label;
  if (req.body.active !== undefined) doc.active = req.body.active;
  if (req.body.sortOrder !== undefined) doc.sortOrder = req.body.sortOrder;
  await doc.save();
  res.status(httpStatus.OK).send({ providerType: doc });
});

module.exports = { listPartner, listAdmin, create, update };
