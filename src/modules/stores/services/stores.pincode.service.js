const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

const isValidPincode = (pincode) => PINCODE_REGEX.test(String(pincode || '').trim());

const outletsForPincode = async (pincode) => {
  if (!isValidPincode(pincode)) throw new ApiError(httpStatus.BAD_REQUEST, 'INVALID_PINCODE');
  const StoreOutlet = mongoose.model('StoreOutlet');
  const outlets = await StoreOutlet.find({
    status: 'active',
    operational: true,
    servicePinCodes: String(pincode).trim(),
  }).select('name outletCode chain deliveryConfig').lean();
  return outlets;
};

const isServiceable = async (outletId, pincode) => {
  if (!isValidPincode(pincode)) return false;
  const StoreOutlet = mongoose.model('StoreOutlet');
  const outlet = await StoreOutlet.findById(outletId).select('servicePinCodes status operational').lean();
  if (!outlet || outlet.status !== 'active' || !outlet.operational) return false;
  if (!Array.isArray(outlet.servicePinCodes) || !outlet.servicePinCodes.length) return true;
  return outlet.servicePinCodes.includes(String(pincode).trim());
};

module.exports = { isValidPincode, outletsForPincode, isServiceable };
