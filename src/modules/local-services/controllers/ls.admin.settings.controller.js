const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const ApiError = require('../../../utils/ApiError');
const LocalServiceSetting = require('../models/localservice.setting.model');

const DEFAULTS = [
  { key: 'defaultBookingMode', value: 'SLOT', description: 'Default booking mode for new services' },
  { key: 'defaultPaymentMode', value: 'gateway', description: 'Default payment mode' },
  { key: 'quoteExpiryHours', value: 48, description: 'Quote expiry in hours' },
  { key: 'slotHoldMinutes', value: 15, description: 'Slot hold duration in minutes' },
  { key: 'maxRefundDays', value: 30, description: 'Max days after completion to request refund' },
  { key: 'platformCommissionPct', value: 10, description: 'Platform commission percentage' },
];

const getSettings = catchAsync(async (req, res) => {
  let docs = await LocalServiceSetting.find({}).lean();
  if (!docs.length) {
    await LocalServiceSetting.insertMany(DEFAULTS);
    docs = await LocalServiceSetting.find({}).lean();
  }
  res.status(httpStatus.OK).send({ settings: docs });
});

const updateSetting = catchAsync(async (req, res) => {
  const { key, value, description } = req.body || {};
  if (!key) throw new ApiError(httpStatus.BAD_REQUEST, 'key required');
  const doc = await LocalServiceSetting.findOneAndUpdate(
    { key },
    { key, value, ...(description != null ? { description } : {}), updatedBy: req.user && req.user._id },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.status(httpStatus.OK).send({ setting: doc });
});

module.exports = { getSettings, updateSetting };
