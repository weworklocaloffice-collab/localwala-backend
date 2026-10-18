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
const {
  City,
  BusinessSettings,
  RestaurantSettings,
  OrderSettings,
  UserSettings,
  User,
  Restaurant,
} = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const { assertUsablePin } = require('../utils/pin.guard');

const sanitizeCityRadius = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return Math.min(50000, Math.max(100, Math.floor(v)));
};

const sanitizeZoneDiameterKm = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  return Math.min(100, Math.max(1, v));
};

const createCity = async (param) => {
  if (await City.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  assertUsablePin(param.longitude, param.latitude, 'City');
  const cityData = new City({
    name: param.name,
    image: param.image,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    translations: param.translations,
    defaultDeliveryRadiusMeters: sanitizeCityRadius(param.defaultDeliveryRadiusMeters) ?? null,
    maxZoneDiameterKm: sanitizeZoneDiameterKm(param.maxZoneDiameterKm) ?? null,
  });
  await City.create(cityData);
  return { success: true };
};

const getAllCitiesAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'localities',
        localField: '_id',
        foreignField: 'city',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: '_id',
        foreignField: 'city',
        as: 'restaurants',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        image: 1,
        location: 1,
        slug: 1,
        name: 1,
        status: 1,
        translations: 1,
        localities: {
          $size: '$localities',
        },
        restaurants: {
          $size: '$restaurants',
        },
      },
    },
  ];
  const results = await City.aggregate(query);
  const countResult = await City.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([results, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const listAllCities = async () => {
  const city = await City.find({ status: true }, { id: 1, name: 1, location: 1, translations: 1 });
  return city;
};

const citiesForPos = async () => {
  const cities = await City.find(
    { status: true },
    { id: 1, name: 1, location: 1, translations: 1 }
  );
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      haveFreeDeliveryInTotal: 1,
      freeDelivery: 1,
      haveFreeDeliveryInDistance: 1,
      freeDeliveryInDistance: 1,
      deliveryChargeMethod: 1,
      deliveryChargeAmount: 1,
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
      partialPayment: 1,
      partialAmountPayment: 1,
      deliveryArea: 1,
      findMode: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  const orderSettings = await OrderSettings.findOne(
    {},
    {
      homeDelivery: 1,
      takeaway: 1,
      scheduleDelivery: 1,
      timeIntervalForScheduleDelivery: 1,
      instantOrder: 1,
      customerOrderDate: 1,
      customerCanOrderWithinDays: 1,
    }
  );
  const customerSettinsg = await UserSettings.findOne(
    {},
    {
      canEarnBuyFromWallet: 1,
      canEarnLoyaltyPointOnOrder: 1,
      loyaltyMinOrderTotal: 1,
      loyaltyPointValue: 1,
    }
  );
  return Promise.all([
    cities,
    businessSettings,
    restaurantSettings,
    orderSettings,
    customerSettinsg,
  ]).then(() => {
    const result = {
      cities,
      business: businessSettings,
      packaging: restaurantSettings,
      orders: orderSettings,
      customer: customerSettinsg,
      success: true,
    };
    return Promise.resolve(result);
  });
};

// "FB|RJ|2026|ENVATO|FOODBITE|ECITAW15071997"

const cityzenPos = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      haveFreeDeliveryInTotal: 1,
      freeDelivery: 1,
      haveFreeDeliveryInDistance: 1,
      freeDeliveryInDistance: 1,
      deliveryChargeMethod: 1,
      deliveryChargeAmount: 1,
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
      partialPayment: 1,
      partialAmountPayment: 1,
      deliveryArea: 1,
      findMode: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  const orderSettings = await OrderSettings.findOne(
    {},
    {
      homeDelivery: 1,
      takeaway: 1,
      scheduleDelivery: 1,
      timeIntervalForScheduleDelivery: 1,
      instantOrder: 1,
      customerOrderDate: 1,
      customerCanOrderWithinDays: 1,
    }
  );
  const customerSettinsg = await UserSettings.findOne(
    {},
    {
      canEarnBuyFromWallet: 1,
      canEarnLoyaltyPointOnOrder: 1,
      loyaltyMinOrderTotal: 1,
      loyaltyPointValue: 1,
    }
  );
  const restaurants = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
        status: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        translations: 1,
      },
    },
  ]);
  return Promise.all([
    cityzen,
    restaurants,
    businessSettings,
    restaurantSettings,
    orderSettings,
    customerSettinsg,
  ]).then(() => {
    const result = {
      restaurants,
      business: businessSettings,
      packaging: restaurantSettings,
      orders: orderSettings,
      customer: customerSettinsg,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getCitiesListForNewRestaurant = async () => {
  const city = await City.find({ status: true }, { id: 1, name: 1, location: 1, translations: 1 });
  return city;
};

const getCityId = async (id) => {
  return City.findById(id);
};

const updateCityById = async (cityId, param) => {
  const city = await getCityId(cityId);
  if (!city) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (param.name && (await City.isNameTaken(param.name, cityId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  assertUsablePin(param.longitude, param.latitude, 'City');
  const updateBody = {
    name: param.name,
    image: param.image,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    translations: param.translations,
  };
  // Present (even null) means "set or clear"; absent means "leave alone", so
  // an update form that doesn't render the field can never wipe it.
  if (param && 'defaultDeliveryRadiusMeters' in param) {
    updateBody.defaultDeliveryRadiusMeters =
      sanitizeCityRadius(param.defaultDeliveryRadiusMeters) ?? null;
  }
  if (param && 'maxZoneDiameterKm' in param) {
    updateBody.maxZoneDiameterKm = sanitizeZoneDiameterKm(param.maxZoneDiameterKm) ?? null;
  }
  Object.assign(city, updateBody);
  await city.save();
  return { success: true };
};

const updateStatus = async (cityId, param) => {
  const city = await getCityId(cityId);
  if (!city) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: param.status,
  };
  Object.assign(city, updateBody);
  await city.save();
  return { success: true };
};

const deleteCityById = async (cityId) => {
  const city = await getCityId(cityId);
  if (!city) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await city.deleteOne();
  return { success: true };
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'localities',
        localField: '_id',
        foreignField: 'city',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: '_id',
        foreignField: 'city',
        as: 'restaurants',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        slug: 1,
        name: 1,
        image: 1,
        status: 1,
        localities: {
          $size: '$localities',
        },
        restaurants: {
          $size: '$restaurants',
        },
        location: 1,
      },
    },
  ];
  const results = await City.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await City.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const longitude =
        param && param.longitude && param.longitude !== null && param.longitude !== ''
          ? param.longitude
          : 0;
      const latitude =
        param && param.latitude && param.latitude !== null && param.latitude !== ''
          ? param.latitude
          : 0;
      const cityData = new City({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        location: { type: 'Point', coordinates: [longitude, latitude] },
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await City.create(cityData);
    });
  }
  return { success: true };
};

module.exports = {
  createCity,
  getAllCitiesAdmin,
  citiesForPos,
  getCityId,
  updateCityById,
  deleteCityById,
  updateStatus,
  listAllCities,
  getCitiesListForNewRestaurant,
  cityzenPos,
  exportCollection,
  exportRawCollection,
  importCollection,
};

