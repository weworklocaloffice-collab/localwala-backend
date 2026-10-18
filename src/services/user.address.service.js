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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const { UserAddress, Restaurant, BusinessSettings } = require('../models');
const ApiError = require('../utils/ApiError');
const { assertUsablePin } = require('../utils/pin.guard');

const saveAddress = async (param) => {
  assertUsablePin(param.longitude, param.latitude, 'Address');
  const addressData = new UserAddress({
    user: param.user,
    title: param.title,
    receiverName: param.receiverName,
    receiverContact: param.receiverContact,
    countryCode: param.countryCode,
    flatHouse: param.flatHouse,
    locality: param.locality,
    landmark: param.landmark,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
  });
  return UserAddress.create(addressData);
};

const getDeliveryAddressList = async (uid) => {
  const addressList = await UserAddress.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(uid) } },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        flatHouse: 1,
        locality: 1,
        landmark: 1,
        location: 1,
      },
    },
  ]);
  const totalSavedAddress = await UserAddress.countDocuments({ user: uid });
  return Promise.all([addressList, totalSavedAddress]).then(() => {
    const result = { list: addressList, total: totalSavedAddress };
    return Promise.resolve(result);
  });
};

const getAddressById = async (id) => {
  return UserAddress.findById(id);
};

const updateAddress = async (addressId, param) => {
  const address = await getAddressById(addressId);
  if (!address) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  assertUsablePin(param.longitude, param.latitude, 'Address');
  const updateBody = {
    user: param.user,
    title: param.title,
    receiverName: param.receiverName,
    countryCode: param.countryCode,
    receiverContact: param.receiverContact,
    flatHouse: param.flatHouse,
    locality: param.locality,
    landmark: param.landmark,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
  };
  Object.assign(address, updateBody);
  await address.save();
  return address;
};

const deleteAddress = async (addressId) => {
  const address = await getAddressById(addressId);
  if (!address) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await address.deleteOne();
  return address;
};

const getMyAddressListFromRestaurant = async (uid, restaurant) => {
  const restaurantInfo = await Restaurant.findById(restaurant, { location: 1, name: 1 });
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantLatitude = restaurantInfo.location.coordinates[1];
  const restaurantLongitude = restaurantInfo.location.coordinates[0];
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const radius = 50000;
  const deliveryArea =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 50;
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34;
  const queryPoint = {
    type: 'Point',
    coordinates: [Number(restaurantLongitude), Number(restaurantLatitude)],
  };

  const addressQuary = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
      query: { user: new mongoose.Types.ObjectId(uid) },
      spherical: true,
    },
  };
  const addressList = await UserAddress.aggregate([
    addressQuary,
    { $sort: { distance: 1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        flatHouse: 1,
        locality: 1,
        landmark: 1,
        location: 1,
        distance: 1,
      },
    },
  ]);
  const totalSavedAddress = await UserAddress.countDocuments({ user: uid });
  return Promise.all([addressList, totalSavedAddress]).then(() => {
    const result = {
      list: addressList,
      total: totalSavedAddress,
      mode: findMode,
      courage: deliveryArea,
    };
    return Promise.resolve(result);
  });
};

const getUserAddressDetailForCheckout = async (id) => {
  const address = await UserAddress.findOne({ _id: new mongoose.Types.ObjectId(id) });
  if (!address) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return address;
};

const customerAddressList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const addressQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        receiverContactNo: {
          $concat: [
            { $substr: ['$receiverContact', 0, 2] },
            'XXXXXX',
            {
              $substr: [
                '$receiverContact',
                { $subtract: [{ $strLenCP: '$receiverContact' }, 2] },
                2,
              ],
            },
          ],
        },
        countryCode: 1,
        flatHouse: 1,
        landmark: 1,
        locality: 1,
        receiverName: 1,
        title: 1,
        createdAt: 1,
      },
    },
  ];
  const address = await UserAddress.aggregate(addressQuery);
  const totalResults = await UserAddress.countDocuments(queryCondition);
  return Promise.all([address, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      address,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  saveAddress,
  getDeliveryAddressList,
  getAddressById,
  updateAddress,
  deleteAddress,
  getMyAddressListFromRestaurant,
  getUserAddressDetailForCheckout,
  customerAddressList,
};

