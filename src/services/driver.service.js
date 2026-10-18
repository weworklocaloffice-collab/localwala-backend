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
  Driver,
  Restaurant,
  BusinessSettings,
  User,
  Wallet,
  Transactions,
  Orders,
  DriverNewOrderStatus,
  DriverOrderReview,
  DeliverymanCashInHand,
  WithdrawalRequest,
} = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const { resolveRiderPool, buildGeoNearStage, resolveDeliveryRadius } = require('../utils/rider.pool');
const { assertUsablePin, assertLocalityInCity, assertPinInCity } = require('../utils/pin.guard');
const zoneService = require('./delivery.zone.service');

/**
 * Refresh a rider's zone tag from their live pin (Batch A-4). Best-effort:
 * heartbeat writes must never fail because the zone lookup did. Supply-side
 * signal for per-zone metrics — never an assignment constraint.
 */
const refreshDriverZone = async (driverId, cityId, longitude, latitude) => {  try {
    const found = await zoneService.resolveZoneForPin(cityId, longitude, latitude);
    await Driver.updateOne(
      { _id: driverId },
      {
        $set: {
          zone: found.zone ? found.zone._id : null,
          zoneUpdatedAt: new Date(),
        },
      }
    );
  } catch {
    /* heartbeat tagging never fails the heartbeat */
  }
};

/**
 * Rider's zone card (Batch G-4): current zone plus live demand around it —
 * open orders and active riders in the zone. Display-only; assignment never
 * reads this. Resolved from the authenticated driver, never from input.
 */
const getMyZoneSummary = async (driverUserId) => {
  if (!driverUserId || !mongoose.Types.ObjectId.isValid(driverUserId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Driver is not valid');
  }
  const driver = await Driver.findOne(
    { userId: new mongoose.Types.ObjectId(driverUserId) },
    { zone: 1, city: 1 }
  )
    .populate('zone', 'name version')
    .lean();
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  if (!driver.zone) {
    return { zone: null, openOrders: 0, activeRiders: 0 };
  }
  const [openOrders, activeRiders] = await Promise.all([
    Orders.countDocuments({ zone: driver.zone._id, driver: null, status: { $in: ['preparing', 'ready'] } }),
    Driver.countDocuments({
      zone: driver.zone._id,
      activeStatus: true,
      status: true,
      isBlocked: { $ne: true },
    }),
  ]);
  return {
    zone: { id: driver.zone._id, name: driver.zone.name, version: driver.zone.version },
    openOrders,
    activeRiders,
  };
};

const updateUserCityLocation = async (userId, cityId) => {
  if (userId && userId !== null && userId !== '' && cityId && cityId !== null && cityId !== '') {
    const user = await User.findById(userId);
    if (user && user.id && user.id !== null && user.id !== '') {
      const updateBody = {
        city: cityId,
      };
      Object.assign(user, updateBody);
      await user.save();
    }
  }
};

const createDriver = async (param) => {
  assertUsablePin(param.longitude, param.latitude, 'Rider');
  await assertLocalityInCity(param.locality, param.city, 'Locality');
  await assertPinInCity(param.city, param.longitude, param.latitude, 'Rider');
  const driverData = new Driver({
    userId: param.userId,
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    restaurant: param && param.restaurant !== '' ? param.restaurant : null,
    vehicle: param && param.vehicle !== '' ? param.vehicle : null,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    type: param.type,
    identity: param.identity,
    identityNumber: param.identityNumber,
    identityProof: param.identityProof,
    drivingLicense: param.drivingLicense,
    age: param.age,
    dob: param.dob,
    rating: 0,
  });
  const result = await Driver.create(driverData);
  await updateUserCityLocation(param.userId, param.city);
  return result;
};

const cityzenCreateDriver = async (masterId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  assertUsablePin(param.longitude, param.latitude, 'Rider');
  await assertLocalityInCity(param.locality, city, 'Locality');
  await assertPinInCity(city, param.longitude, param.latitude, 'Rider');
  const driverData = new Driver({
    userId: param.userId,
    city: `${city}`,
    locality: param && param.locality !== '' ? param.locality : null,
    restaurant: param && param.restaurant !== '' ? param.restaurant : null,
    vehicle: param && param.vehicle !== '' ? param.vehicle : null,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    type: param.type,
    identity: param.identity,
    identityNumber: param.identityNumber,
    identityProof: param.identityProof,
    drivingLicense: param.drivingLicense,
    age: param.age,
    dob: param.dob,
    rating: 0,
  });
  await updateUserCityLocation(param.userId, city);
  const result = await Driver.create(driverData);
  return result;
};

const createVendorDriver = async (param) => {
  assertUsablePin(param.longitude, param.latitude, 'Rider');
  await assertLocalityInCity(param.locality, param.city, 'Locality');
  await assertPinInCity(param.city, param.longitude, param.latitude, 'Rider');
  const driverData = new Driver({
    userId: param.userId,
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    restaurant: param && param.restaurant !== '' ? param.restaurant : null,
    vehicle: param && param.vehicle !== '' ? param.vehicle : null,
    location: { type: 'Point', coordinates: [param.longitude, param.latitude] },
    type: 'freelancer',
    identity: param.identity,
    identityNumber: param.identityNumber,
    identityProof: param.identityProof,
    drivingLicense: param.drivingLicense,
    age: param.age,
    dob: param.dob,
    rating: 0,
  });
  const result = await Driver.create(driverData);
  await updateUserCityLocation(param.userId, param.city);
  return result;
};

const getDriverById = async (id) => {
  return Driver.findById(id);
};

const updateStatus = async (driverId, updateBody) => {
  const driver = await getDriverById(driverId);
  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const driverUserInfo = await User.findOne({ _id: new mongoose.Types.ObjectId(driver.userId) });
  if (driverUserInfo) {
    Object.assign(driverUserInfo, updateBody);
    await driverUserInfo.save();
  }
  Object.assign(driver, updateBody);
  await driver.save();
  return { success: true, driverUserInfo };
};

const getById = async (id) => {
  const driver = await getDriverById(id);
  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return driver;
};

const getByUid = async (id) => {
  const info = await Driver.findOne({ userId: new mongoose.Types.ObjectId(id) });
  return info;
};

const updateDriverById = async (driverId, param) => {
  const driver = await getDriverById(driverId);
  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const driverData = {
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    vehicle: param && param.vehicle !== '' ? param.vehicle : null,
    location: { type: 'Point', coordinates: [param.longitude, param.latitude] },
    type: param.type,
    identity: param.identity,
    identityNumber: param.identityNumber,
    identityProof: param.identityProof,
    drivingLicense: param.drivingLicense,
    age: param.age,
    dob: param.dob,
  };
  Object.assign(driver, driverData);
  await driver.save();
  await updateUserCityLocation(driver.userId, param.city);
  return { success: true };
};

const cityzenUpdateDriverById = async (masterId, driverId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const driver = await getDriverById(driverId);
  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const driverData = {
    city: `${city}`,
    locality: param && param.locality !== '' ? param.locality : null,
    restaurant: param && param.restaurant !== '' ? param.restaurant : null,
    vehicle: param && param.vehicle !== '' ? param.vehicle : null,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    type: param.type,
    identity: param.identity,
    identityNumber: param.identityNumber,
    identityProof: param.identityProof,
    drivingLicense: param.drivingLicense,
    age: param.age,
    dob: param.dob,
  };
  Object.assign(driver, driverData);
  await driver.save();
  await updateUserCityLocation(driver.userId, city);
  return { success: true };
};

const goOffline = async (uid, reasonId) => {
  const driver = await getByUid(uid);
  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const driverData = {
    activeStatus: false,
    offlineReason: reasonId,
  };
  Object.assign(driver, driverData);
  await driver.save();
  return { success: true };
};

const goOnline = async (uid) => {
  const driver = await getByUid(uid);
  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const driverData = {
    activeStatus: true,
    offlineReason: null,
  };
  Object.assign(driver, driverData);
  await driver.save();
  return { success: true };
};

const updateDriverLocation = async (uid, latitude, longitude) => {
  const driver = await getByUid(uid);
  if (driver) {
    const driverData = {
      location: { type: 'Point', coordinates: [longitude, latitude] },
    };
    Object.assign(driver, driverData);
    await driver.save();
    await refreshDriverZone(driver._id, driver.city, longitude, latitude);
  }
};

const getAllDriver = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ restaurant: null }],
  };
  const results = await Driver.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driverofflinemessages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        activeStatus: 1,
        isBlocked: 1,
        orderHandling: 1,
        rating: 1,
        status: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        offline: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
          translations: { $ifNull: ['$driverofflinemessages.translations', []] },
        },
      },
    },
  ]);
  const countResult = await Driver.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenSystemDriver = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ restaurant: null }, { city: new mongoose.Types.ObjectId(city) }],
  };
  const results = await Driver.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driverofflinemessages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        activeStatus: 1,
        isBlocked: 1,
        orderHandling: 1,
        rating: 1,
        status: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        offline: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
          translations: { $ifNull: ['$driverofflinemessages.translations', []] },
        },
      },
    },
  ]);
  const countResult = await Driver.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getAllVendorDriverList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ restaurant: { $ne: null } }],
  };
  const results = await Driver.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driverofflinemessages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        activeStatus: 1,
        isBlocked: 1,
        orderHandling: 1,
        rating: 1,
        status: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        offline: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
          translations: { $ifNull: ['$driverofflinemessages.translations', []] },
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);
  const countResult = await Driver.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenVendorDriverList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });

  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const cityId = cityzen.city;

  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;

  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;

  const skip = (page - 1) * limit;

  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const searchRegExp =
    options.search && options.search.trim() !== '' ? escapeRegex(options.search.trim()) : null;

  const baseMatch = {
    restaurant: { $ne: null },
    city: new mongoose.Types.ObjectId(cityId),
  };

  // ---------------------------
  // RESULTS PIPELINE
  // ---------------------------

  const results = await Driver.aggregate([
    { $match: baseMatch },

    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    { $unwind: { path: '$users', preserveNullAndEmptyArrays: true } },

    ...(searchRegExp
      ? [
          {
            $match: {
              $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }],
            },
          },
        ]
      : []),

    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },

    { $unwind: { path: '$localities', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$driverofflinemessages', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$restaurants', preserveNullAndEmptyArrays: true } },

    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },

    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        activeStatus: 1,
        isBlocked: 1,
        orderHandling: 1,
        rating: 1,
        status: 1,
        totalRating: { $size: '$driverorderreviews' },

        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },

        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: {
            $cond: [
              { $ifNull: ['$users.mobile', false] },
              {
                $concat: [
                  { $substr: ['$users.mobile', 0, 2] },
                  'XXXXXX',
                  {
                    $substr: [
                      '$users.mobile',
                      { $subtract: [{ $strLenCP: '$users.mobile' }, 2] },
                      2,
                    ],
                  },
                ],
              },
              '',
            ],
          },
          contactEmail: {
            $cond: [
              { $ifNull: ['$users.email', false] },
              {
                $concat: [
                  {
                    $substr: [{ $arrayElemAt: [{ $split: ['$users.email', '@'] }, 0] }, 0, 2],
                  },
                  'xxxx@',
                  {
                    $arrayElemAt: [{ $split: ['$users.email', '@'] }, 1],
                  },
                ],
              },
              '',
            ],
          },
        },

        offline: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
          translations: { $ifNull: ['$driverofflinemessages.translations', []] },
        },

        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);

  // ---------------------------
  // COUNT PIPELINE
  // ---------------------------

  const countPipeline = [
    { $match: baseMatch },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    { $unwind: '$users' },
  ];

  if (searchRegExp) {
    countPipeline.push({
      $match: {
        $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }],
      },
    });
  }

  countPipeline.push({ $count: 'totalCount' });

  const countResult = await Driver.aggregate(countPipeline);

  const totalResults = countResult.length > 0 ? countResult[0].totalCount : 0;

  const totalPages = Math.ceil(totalResults / limit);

  return {
    results,
    page,
    limit,
    totalPages,
    totalResults,
    success: true,
  };
};

const cityzenDetail = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return cityzen;
};

const getAllVendorDriver = async (restaurantId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await Driver.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driverofflinemessages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        activeStatus: 1,
        isBlocked: 1,
        orderHandling: 1,
        rating: 1,
        status: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        offline: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
          translations: { $ifNull: ['$driverofflinemessages.translations', []] },
        },
      },
    },
  ]);
  const totalResults = await Driver.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurantId),
  });
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getNearMeActiveDriver = async (vendorId) => {
  // Pool resolution and the eligibility filter live in `utils/rider.pool.js` so
  // this picker and the auto-dispatch engine cannot drift apart again. A derived
  // outlet inherits `ownDriver` from its parent, and its riders are registered
  // against that parent — querying the outlet's own id returned nothing.
  const pool = await resolveRiderPool(vendorId);
  const restaurantInfo = pool.restaurant;
  const { findMode, radiusMeters } = await resolveDeliveryRadius();
  const storeLatitude =
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[1]
      : 0.0;
  const storeLongitude =
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[0]
      : 0.0;
  const nearestDriver = buildGeoNearStage(
    pool,
    [storeLongitude, storeLatitude],
    radiusMeters,
    findMode
  );
  // Identity fields are released ONLY to a restaurant that employs the rider.
  //
  // A restaurant with `ownDriver` is looking at its own staff directory — names
  // and photos are appropriate and the picker is how it picks. A restaurant
  // drawing on the platform pool was previously handed every gig worker's name,
  // photo and precise live distance in the city. That is third-party PII with no
  // operational justification, so those fields are withheld from the platform
  // pool and the response carries distance and load only.
  const userDriverLookup = {
    $lookup: {
      from: 'users',
      localField: 'userId',
      foreignField: '_id',
      as: 'users',
      pipeline: [
        { $match: { status: true } },
        {
          $project: {
            _id: 0,
            id: '$_id',
            // `firstName` / `lastName` / `image` are intentionally absent for the
            // platform pool. See the note above.
            ...(pool.isOwnFleet ? { firstName: 1, lastName: 1, image: 1 } : {}),
            role: 1,
          },
        },
      ],
    },
  };
  const filterOptions = {
    _id: 0,
    id: '$_id',
    distance: 1,
    users: {
      id: { $ifNull: ['$users.id', ''] },
      ...(pool.isOwnFleet
        ? {
            firstName: { $ifNull: ['$users.firstName', ''] },
            lastName: { $ifNull: ['$users.lastName', ''] },
            image: { $ifNull: ['$users.image', ''] },
          }
        : {}),
      role: { $ifNull: ['$users.role', ''] },
    },
  };
  const nearDriver = await Driver.aggregate([
    nearestDriver,
    userDriverLookup,
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $sort: { distance: 1 } },
    { $project: filterOptions },
  ]);
  return Promise.all([restaurantInfo, nearDriver]).then(() => {
    const result = {
      drivers: nearDriver,
      findMode,
      success: !!(nearDriver && nearDriver !== null && nearDriver.length > 0),
    };
    return Promise.resolve(result);
  });
};

const updateMyLocation = async (id, latitude, longitude) => {
  const driver = await Driver.findOne({ userId: new mongoose.Types.ObjectId(id) });
  const userInfo = await User.findOne({ _id: new mongoose.Types.ObjectId(id) });
  if (driver) {
    Object.assign(driver, { location: { type: 'Point', coordinates: [longitude, latitude] } });
    Object.assign(userInfo, { location: { type: 'Point', coordinates: [longitude, latitude] } });
    try {
      await driver.save();
      await userInfo.save();
      // eslint-disable-next-line no-unused-vars
    } catch (err) {
      //
    }
    await refreshDriverZone(driver._id, driver.city, longitude, latitude);
  }
  return { success: true };
};

const getDeliverymanFromCity = async (city) => {
  const deliveryman = await Driver.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
        restaurant: null,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
      },
    },
  ]);
  return Promise.all([deliveryman]).then(() => {
    const result = {
      deliveryman,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenDeliverymanList = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const deliveryman = await Driver.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
        restaurant: null,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
      },
    },
  ]);
  return Promise.all([deliveryman]).then(() => {
    const result = {
      deliveryman,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const addMoneyToWalletAfterDelivery = async (totalEarning, deliveryman, orderId) => {
  const walletInfo = await Wallet.findOne({ holderId: new mongoose.Types.ObjectId(deliveryman) });
  if (walletInfo !== null && walletInfo.id !== null) {
    const businessSettings = await BusinessSettings.findOne({}, { commissionDelivery: 1 });
    let commission = 10;
    if (
      businessSettings &&
      businessSettings !== null &&
      businessSettings.commissionDelivery !== null
    ) {
      commission = businessSettings.commissionDelivery;
    }
    const adminCommission = parseFloat(
      (parseFloat(totalEarning) * parseFloat(commission)) / 100
    ).toFixed(2);
    const earningAfterCommission = parseFloat(totalEarning) - parseFloat(adminCommission);
    const orderInfo = await Orders.findById(orderId);
    if (orderInfo && orderInfo !== null) {
      Object.assign(orderInfo, {
        deliveryCommission: adminCommission,
        driverEarining: totalEarning,
      });
      await orderInfo.save();
    }
    const oldBalance = walletInfo.balance;
    const userWalletId = walletInfo.id;
    const newBalance = parseFloat(
      parseFloat(oldBalance) + parseFloat(earningAfterCommission)
    ).toFixed(2);
    Object.assign(walletInfo, { balance: newBalance });
    await walletInfo.save();
    const transactionBody = {
      payableId: deliveryman,
      walletId: userWalletId,
      type: 'deposite',
      amount: earningAfterCommission,
      confirmed: true,
      meta: [{ reason: `Order Earning From #${orderId}` }],
      status: true,
    };
    await Transactions.create(transactionBody);
  }
};

const deliverymanWalletFundList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const matchQuery = { $match: { $or: [{ role: 'driver' }, { role: 'vendorDriver' }] } };
  const name = options.search;
  if (name && name !== '' && name !== null) {
    matchQuery.$match = {
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverneworderstatuses',
        pipeline: [{ $match: { driverOrderStatus: 'delivered' } }],
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        contactEmail: {
          $concat: [
            { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
            'xxxx@',
            { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
          ],
        },
        createdAt: 1,
        wallets: 1,
        role: 1,
        orderCount: {
          $size: '$driverneworderstatuses',
        },
        orderEarning: {
          $divide: [{ $sum: '$driverneworderstatuses.earning' }, 100],
        },
        status: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await User.aggregate(query);
  const resultCount = await User.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
  return Promise.all([results, totalResults]).then(() => {
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

const deliverymanReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const name = options.search;
  const matchQuery = {
    $match:
      options && options.kind && options.kind !== null && options.kind !== 'all'
        ? {
            role: options.kind,
          }
        : { role: { $in: ['driver', 'vendorDriver'] } },
  };
  if (name && name !== '' && name !== null) {
    const searchRegExp = RegExp(name, 'i');
    matchQuery.$match = {
      role: { $in: ['driver', 'vendorDriver'] },
      $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
    };
  }
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'userId',
        as: 'drivers',
      },
    },
    {
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverneworderstatuses',
        pipeline: [{ $match: { driverOrderStatus: 'delivered' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'rejectedOrders',
        pipeline: [{ $match: { driverOrderStatus: 'rejected' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'cancelledOrders',
        pipeline: [{ $match: { driverOrderStatus: 'cancelled' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'lateAccept',
        pipeline: [{ $match: { driverOrderStatus: 'accepted_another' } }],
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'drivers.city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'drivers.locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'drivers.type':
          options && options.type && options.type !== null && options.type !== 'all'
            ? options.type
            : { $ne: null },
        'drivers.city':
          options && options.city && options.city !== null && options.city !== ''
            ? new mongoose.Types.ObjectId(options.city)
            : { $ne: null },
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        createdAt: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        countryCode: 1,
        contactNumber: {
          $concat: [
            { $substr: ['$mobile', 0, 2] },
            'XXXXXX',
            { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
          ],
        },
        contactEmail: {
          $concat: [
            { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
            'xxxx@',
            { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
          ],
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          type: { $ifNull: ['$drivers.type', ''] },
          rating: { $ifNull: ['$drivers.rating', 0] },
        },
        totalEarning: {
          $divide: [{ $sum: '$driverneworderstatuses.earning' }, 100],
        },
        tipAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.tipAmount' }, 100],
        },
        incentiveAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.incentiveAmount' }, 100],
        },
        extraEarningOnShiftAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.extraEarningOnShiftAmount' }, 100],
        },
        deliveredOrders: {
          $size: '$driverneworderstatuses',
        },
        rejectedOrder: {
          $size: '$rejectedOrders',
        },
        cancelledOrder: {
          $size: '$cancelledOrders',
        },
        delayedOrder: {
          $size: '$lateAccept',
        },
        wallets: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ];
  const countQuery = [
    matchQuery,
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'userId',
        as: 'drivers',
      },
    },
    {
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'drivers.type':
          options && options.type && options.type !== null && options.type !== 'all'
            ? options.type
            : { $ne: null },
        'drivers.city':
          options && options.city && options.city !== null && options.city !== ''
            ? new mongoose.Types.ObjectId(options.city)
            : { $ne: null },
      },
    },
    { $count: 'totalCount' },
  ];
  const results = await User.aggregate(query);
  const resultCount = await User.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
  return Promise.all([results, totalResults]).then(() => {
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

const vendorDeliverymanList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const results = await Driver.aggregate([
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driverofflinemessages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        activeStatus: 1,
        isBlocked: 1,
        orderHandling: 1,
        rating: 1,
        status: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        offline: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
          translations: { $ifNull: ['$driverofflinemessages.translations', []] },
        },
      },
    },
  ]);
  const totalResults = await Driver.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanInformation = async (driverId) => {
  const driverQuery = [
    { $match: { userId: new mongoose.Types.ObjectId(driverId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'vehicles',
        localField: 'vehicle',
        foreignField: '_id',
        as: 'vehicles',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: 'userId',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: 'userId',
        foreignField: 'driver',
        as: 'deliveredOrders',
        pipeline: [{ $match: { driverOrderStatus: 'delivered' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: 'userId',
        foreignField: 'driver',
        as: 'rejectedOrders',
        pipeline: [{ $match: { driverOrderStatus: 'rejected' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: 'userId',
        foreignField: 'driver',
        as: 'cancelledOrders',
        pipeline: [{ $match: { driverOrderStatus: 'cancelled' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: 'userId',
        foreignField: 'driver',
        as: 'lateAccepted',
        pipeline: [{ $match: { driverOrderStatus: 'accepted_another' } }],
      },
    },
    {
      $lookup: {
        from: 'complaints',
        localField: 'userId',
        foreignField: 'driver',
        as: 'complaints',
      },
    },
    {
      $lookup: {
        from: 'restaurantcomplaints',
        localField: 'userId',
        foreignField: 'driver',
        as: 'restaurantcomplaints',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'deliverymandisbursements',
        localField: 'userId',
        foreignField: 'userId',
        as: 'deliverymandisbursements',
      },
    },
    {
      $lookup: {
        from: 'collectcashes',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'collectcashes',
      },
    },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'deliverymanpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'withdrawalrequests',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'withdrawalrequests',
      },
    },
    {
      $lookup: {
        from: 'media',
        localField: 'userId',
        foreignField: 'uid',
        as: 'media',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$vehicles',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driverofflinemessages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        location: 1,
        type: 1,
        identity: 1,
        identityNumber: 1,
        identityProof: 1,
        drivingLicense: 1,
        age: 1,
        dob: 1,
        rating: 1,
        orderHandling: 1,
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        vehicle: {
          id: { $ifNull: ['$vehicles._id', ''] },
          name: { $ifNull: ['$vehicles.name', ''] },
          translations: { $ifNull: ['$vehicles.translations', []] },
        },
        offlineMessage: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
          translations: { $ifNull: ['$driverofflinemessages.translations', []] },
        },
        wallets: 1,
        deliveredOrder: {
          $size: '$deliveredOrders',
        },
        rejectedOrder: {
          $size: '$rejectedOrders',
        },
        cancelledOrder: {
          $size: '$cancelledOrders',
        },
        lateAccept: {
          $size: '$lateAccepted',
        },
        orderComplaints: {
          $size: '$complaints',
        },
        restaurantComplaints: {
          $size: '$restaurantcomplaints',
        },
        disbursements: {
          $size: '$deliverymandisbursements',
        },
        collectedCash: {
          $size: '$collectcashes',
        },
        payoutAccounts: {
          $size: '$deliverymanpayoutmethods',
        },
        withdrawalRequest: {
          $size: '$withdrawalrequests',
        },
        reviews: {
          $size: '$driverorderreviews',
        },
        medias: {
          $size: '$media',
        },
      },
    },
  ];
  const driverResult = await Driver.aggregate(driverQuery);
  if (!driverResult[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const driverInfo = driverResult[0];
  const earnings = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(driverId),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$earning' },
      },
    },
    {
      $project: {
        _id: 0,
        earnings: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ]);
  const earningChart = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(driverId),
        earning: { $exists: true, $ne: null },
        tipAmount: { $exists: true, $ne: null },
        incentiveAmount: { $exists: true, $ne: null },
        extraEarningOnShiftAmount: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: null,
        totalEarnings: { $sum: '$earning' },
        totalTips: { $sum: '$tipAmount' },
        totalBonuses: { $sum: '$incentiveAmount' },
        totalExtraShiftEarning: { $sum: '$extraEarningOnShiftAmount' },
      },
    },
    {
      $project: {
        _id: 0,
        totalEarnings: { $round: [{ $divide: ['$totalEarnings', 100] }, 2] },
        totalTips: { $round: [{ $divide: ['$totalTips', 100] }, 2] },
        totalBonuses: { $round: [{ $divide: ['$totalBonuses', 100] }, 2] },
        totalExtraShiftEarning: { $round: [{ $divide: ['$totalExtraShiftEarning', 100] }, 2] },
      },
    },
  ]);
  const statusName = [
    'ideal',
    'accepted',
    'driver_reached_restaurant',
    'driver_pickpup_order',
    'driver_reached_customer',
    'rejected',
    'cancelled',
    'delivered',
    'accepted_another',
  ];
  const chartCountList = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(driverId),
      },
    },
    {
      $group: {
        _id: '$driverOrderStatus',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        status: '$_id',
        count: 1,
      },
    },
  ]);
  const chartCount = statusName.map((status) => {
    const found = chartCountList.find((item) => item.status === status);
    return {
      status,
      count: found ? found.count : 0,
    };
  });
  const averageDeliveryTime = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(driverId),
        acceptedAt: { $exists: true, $ne: null },
        deliveredAt: { $exists: true, $ne: null },
      },
    },
    {
      $addFields: {
        deliveryTimeInMillis: { $subtract: ['$deliveredAt', '$acceptedAt'] },
      },
    },
    {
      $addFields: {
        deliveryTimeInMinutes: { $divide: ['$deliveryTimeInMillis', 1000 * 60] },
      },
    },
    {
      $match: {
        deliveryTimeInMinutes: { $gte: 0, $lte: 180 }, // Adjust the upper limit if necessary
      },
    },
    {
      $group: {
        _id: null,
        averageDeliveryTimeInMinutes: { $avg: '$deliveryTimeInMinutes' },
      },
    },
    {
      $project: {
        _id: 0,
        averageDeliveryTime: { $round: ['$averageDeliveryTimeInMinutes', 0] },
      },
    },
  ]);
  const starCounts = await DriverOrderReview.aggregate([
    { $match: { driver: new mongoose.Types.ObjectId(driverId) } },
    {
      $group: {
        _id: '$ratingCount',
        count: { $sum: 1 },
      },
    },
    {
      $addFields: {
        star: '$_id',
      },
    },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: '$count' },
        ratings: { $push: { star: '$star', count: '$count' } },
      },
    },
    {
      $addFields: {
        ratings: {
          $map: {
            input: [1, 2, 3, 4, 5],
            as: 'star',
            in: {
              $mergeObjects: [
                { star: '$$star', count: 0 },
                {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: '$ratings',
                        as: 'rating',
                        cond: { $eq: ['$$rating.star', '$$star'] },
                      },
                    },
                    0,
                  ],
                },
              ],
            },
          },
        },
      },
    },
    {
      $unwind: '$ratings',
    },
    {
      $addFields: {
        'ratings.percentage': {
          $cond: [
            { $eq: ['$totalReviews', 0] },
            0,
            {
              $multiply: [{ $divide: ['$ratings.count', '$totalReviews'] }, 100],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        ratings: { $push: '$ratings' },
      },
    },
    {
      $project: {
        _id: 0,
        ratings: 1,
      },
    },
  ]);
  const percentages = checkArrayNotEmpty(starCounts)
    ? starCounts[0].ratings
    : [
        { star: 1, percentage: 0, count: 0 },
        { star: 2, percentage: 0, count: 0 },
        { star: 3, percentage: 0, count: 0 },
        { star: 4, percentage: 0, count: 0 },
        { star: 5, percentage: 0, count: 0 },
      ];
  const cashInHandQuery = [
    { $match: { deliveryman: new mongoose.Types.ObjectId(driverId), status: true } },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        inHandAmount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ];
  const withdrawnQuery = [
    {
      $match: {
        deliveryman: new mongoose.Types.ObjectId(driverId),
        from: 'deliveryman',
        status: 'accepted',
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
      },
    },
    {
      $project: {
        _id: 0,
        withdrawn: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ];
  const totalCashInHand = await DeliverymanCashInHand.aggregate(cashInHandQuery);
  const withdrawn = await WithdrawalRequest.aggregate(withdrawnQuery);
  let inHandAmount = 0;
  if (
    totalCashInHand !== null &&
    totalCashInHand.length > 0 &&
    checkArrayNotEmpty(totalCashInHand)
  ) {
    inHandAmount = parseFloat(totalCashInHand[0].inHandAmount);
  }
  let withdrawnAmount = 0;
  if (withdrawn !== null && checkArrayNotEmpty(withdrawn)) {
    withdrawnAmount = parseFloat(withdrawn[0].withdrawn);
  }
  return Promise.all([
    driverResult,
    earningChart,
    chartCountList,
    earnings,
    averageDeliveryTime,
    starCounts,
    totalCashInHand,
    withdrawn,
  ]).then(() => {
    let averageDeliveryTimeOfDelivery = 0;
    let totalEarning = 0;
    const earningChartData = {
      totalEarnings: 0,
      totalTips: 0,
      totalBonuses: 0,
      totalExtraShiftEarning: 0,
    };
    if (checkArrayNotEmpty(averageDeliveryTime)) {
      averageDeliveryTimeOfDelivery = averageDeliveryTime[0].averageDeliveryTime;
    }
    if (checkArrayNotEmpty(earnings)) {
      totalEarning = earnings[0].earnings;
    }
    if (checkArrayNotEmpty(earningChart)) {
      earningChartData.totalEarnings = earningChart[0].totalEarnings;
      earningChartData.totalTips = earningChart[0].totalTips;
      earningChartData.totalBonuses = earningChart[0].totalBonuses;
      earningChartData.totalExtraShiftEarning = earningChart[0].totalExtraShiftEarning;
    }
    const result = {
      driverInfo,
      inHandAmount,
      withdrawnAmount,
      totalEarning,
      earningChartData,
      chartCount,
      averageDeliveryTimeOfDelivery,
      percentages,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityMapDialogDeliveryman = async (city, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const drivers = await Driver.aggregate([
    { $match: { city: new mongoose.Types.ObjectId(city) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        location: 1,
        rating: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
      },
    },
  ]);
  const totalDeliveryman = await Driver.countDocuments({ city: new mongoose.Types.ObjectId(city) });
  return Promise.all([drivers, totalDeliveryman]).then(() => {
    const result = {
      drivers,
      totalDeliveryman,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const supportTeamDeliverymanList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const name = options.search;
  const matchQuery = {
    $match:
      options && options.kind && options.kind !== null && options.kind !== 'all'
        ? {
            role: options.kind,
          }
        : { role: { $in: ['driver', 'vendorDriver'] } },
  };
  if (name && name !== '' && name !== null) {
    const searchRegExp = RegExp(name, 'i');
    matchQuery.$match = {
      role: { $in: ['driver', 'vendorDriver'] },
      $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
    };
  }
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'userId',
        as: 'drivers',
      },
    },
    {
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverneworderstatuses',
        pipeline: [{ $match: { driverOrderStatus: 'delivered' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'rejectedOrders',
        pipeline: [{ $match: { driverOrderStatus: 'rejected' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'cancelledOrders',
        pipeline: [{ $match: { driverOrderStatus: 'cancelled' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'lateAccept',
        pipeline: [{ $match: { driverOrderStatus: 'accepted_another' } }],
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'drivers.city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'drivers.locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'drivers.type':
          options && options.type && options.type !== null && options.type !== 'all'
            ? options.type
            : { $ne: null },
        'drivers.city':
          options && options.city && options.city !== null && options.city !== ''
            ? new mongoose.Types.ObjectId(options.city)
            : { $ne: null },
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        createdAt: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        countryCode: 1,
        contactNumber: {
          $concat: [
            { $substr: ['$mobile', 0, 2] },
            'XXXXXX',
            { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
          ],
        },
        contactEmail: {
          $concat: [
            { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
            'xxxx@',
            { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
          ],
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          type: { $ifNull: ['$drivers.type', ''] },
          rating: { $ifNull: ['$drivers.rating', 0] },
        },
        totalEarning: {
          $divide: [{ $sum: '$driverneworderstatuses.earning' }, 100],
        },
        tipAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.tipAmount' }, 100],
        },
        incentiveAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.incentiveAmount' }, 100],
        },
        extraEarningOnShiftAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.extraEarningOnShiftAmount' }, 100],
        },
        deliveredOrders: {
          $size: '$driverneworderstatuses',
        },
        rejectedOrder: {
          $size: '$rejectedOrders',
        },
        cancelledOrder: {
          $size: '$cancelledOrders',
        },
        delayedOrder: {
          $size: '$lateAccept',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ];
  const countQuery = [
    matchQuery,
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'userId',
        as: 'drivers',
      },
    },
    {
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'drivers.type':
          options && options.type && options.type !== null && options.type !== 'all'
            ? options.type
            : { $ne: null },
        'drivers.city':
          options && options.city && options.city !== null && options.city !== ''
            ? new mongoose.Types.ObjectId(options.city)
            : { $ne: null },
      },
    },
    { $count: 'totalCount' },
  ];
  const results = await User.aggregate(query);
  const resultCount = await User.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
  return Promise.all([results, totalResults]).then(() => {
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

const exportSystemDeliverymanCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ restaurant: null }],
  };
  const query = [
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driverofflinemessages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        activeStatus: 1,
        isBlocked: 1,
        orderHandling: 1,
        rating: 1,
        status: 1,
        location: 1,
        createdAt: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          email: { $ifNull: ['$users.email', ''] },
        },
        offline: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
        },
      },
    },
  ];
  const results = await Driver.aggregate(query);
  return results;
};

const exportSystemDeliverymanRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ restaurant: null }],
  };
  const results = await Driver.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    {
      $project: {
        users: 0,
      },
    },
  ]);
  return results;
};

const exportVendorDeliverymanCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ restaurant: { $ne: null } }],
  };
  const query = [
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'driverofflinemessages',
        localField: 'offlineReason',
        foreignField: '_id',
        as: 'driverofflinemessages',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driverofflinemessages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        activeStatus: 1,
        isBlocked: 1,
        orderHandling: 1,
        rating: 1,
        status: 1,
        location: 1,
        createdAt: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          email: { $ifNull: ['$users.email', ''] },
        },
        offline: {
          id: { $ifNull: ['$driverofflinemessages._id', ''] },
          name: { $ifNull: ['$driverofflinemessages.name', ''] },
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
      },
    },
  ];
  const results = await Driver.aggregate(query);
  return results;
};

const exportVendorDeliverymanRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ restaurant: { $ne: null } }],
  };
  const results = await Driver.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    {
      $project: {
        users: 0,
      },
    },
  ]);
  return results;
};

const exportDeliverymanFundCollection = async (search) => {
  const matchQuery = { $match: { $or: [{ role: 'driver' }, { role: 'vendorDriver' }] } };
  const name = search;
  if (name && name !== '' && name !== null && name !== 'none') {
    matchQuery.$match = {
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverneworderstatuses',
        pipeline: [{ $match: { driverOrderStatus: 'delivered' } }],
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        email: 1,
        wallets: 1,
        role: 1,
        orderCount: {
          $size: '$driverneworderstatuses',
        },
        orderEarning: {
          $divide: [{ $sum: '$driverneworderstatuses.earning' }, 100],
        },
      },
    },
  ];
  const result = await User.aggregate(query);
  return result;
};

const exportRawDeliverymanFundCollection = async (search) => {
  const matchQuery = { $match: { $or: [{ role: 'driver' }, { role: 'vendorDriver' }] } };
  const name = search;
  if (name && name !== '' && name !== null && name !== 'none') {
    matchQuery.$match = {
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }
  const results = await User.find(matchQuery.$match).lean();
  return results;
};

const exportDeliverymanReportCollection = async (options) => {
  const name = options.search;
  const matchQuery = {
    $match:
      options && options.kind && options.kind !== null && options.kind !== 'all'
        ? {
            role: options.kind,
          }
        : { role: { $in: ['driver', 'vendorDriver'] } },
  };
  if (name && name !== '' && name !== null) {
    const searchRegExp = RegExp(name, 'i');
    matchQuery.$match = {
      role: { $in: ['driver', 'vendorDriver'] },
      $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
    };
  }
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'userId',
        as: 'drivers',
      },
    },
    {
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverneworderstatuses',
        pipeline: [{ $match: { driverOrderStatus: 'delivered' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'rejectedOrders',
        pipeline: [{ $match: { driverOrderStatus: 'rejected' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'cancelledOrders',
        pipeline: [{ $match: { driverOrderStatus: 'cancelled' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'lateAccept',
        pipeline: [{ $match: { driverOrderStatus: 'accepted_another' } }],
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'drivers.city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'drivers.locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'drivers.type':
          options && options.type && options.type !== null && options.type !== 'all'
            ? options.type
            : { $ne: null },
        'drivers.city':
          options && options.city && options.city !== null && options.city !== ''
            ? new mongoose.Types.ObjectId(options.city)
            : { $ne: null },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        createdAt: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        countryCode: 1,
        mobile: 1,
        email: 1,
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          type: { $ifNull: ['$drivers.type', ''] },
          rating: { $ifNull: ['$drivers.rating', 0] },
        },
        totalEarning: {
          $divide: [{ $sum: '$driverneworderstatuses.earning' }, 100],
        },
        tipAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.tipAmount' }, 100],
        },
        incentiveAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.incentiveAmount' }, 100],
        },
        extraEarningOnShiftAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.extraEarningOnShiftAmount' }, 100],
        },
        deliveredOrders: {
          $size: '$driverneworderstatuses',
        },
        rejectedOrder: {
          $size: '$rejectedOrders',
        },
        cancelledOrder: {
          $size: '$cancelledOrders',
        },
        delayedOrder: {
          $size: '$lateAccept',
        },
        wallets: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
        },
      },
    },
  ];
  const result = await User.aggregate(query);
  return result;
};

function generateSecurePassword(length = 10) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';

  const hasLetterAndNumber = (password) => {
    return /[a-zA-Z]/.test(password) && /\d/.test(password);
  };

  let password = '';
  do {
    password = Array.from(
      { length },
      () => charset[Math.floor(Math.random() * charset.length)]
    ).join('');
  } while (!hasLetterAndNumber(password));

  return password;
}

const importSystemDeliverymanCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      let isValid = true;
      if (await User.isEmailTaken(param.email)) {
        isValid = false;
      }
      if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
        isValid = false;
      }
      if (isValid) {
        const longitude =
          param && param.longitude && param.longitude !== null && param.longitude !== ''
            ? param.longitude
            : 0;
        const latitude =
          param && param.latitude && param.latitude !== null && param.latitude !== ''
            ? param.latitude
            : 0;
        const userData = new User({
          email: param.email,
          password: generateSecurePassword(15),
          firstName:
            param && param.firstName && param.firstName !== null && param.firstName !== ''
              ? param.firstName
              : 'NA',
          lastName:
            param && param.lastName && param.lastName !== null && param.lastName !== ''
              ? param.lastName
              : 'NA',
          countryCode: param.countryCode,
          mobile: param.mobile,
          locale:
            param && param.locale && param.locale !== null && param.locale !== ''
              ? param.locale
              : 'en',
          image:
            param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
          gender:
            param && param.gender && param.gender !== null && param.gender !== ''
              ? param.gender
              : 'male',
          role: 'driver',
          location: { type: 'Point', coordinates: [longitude, latitude] },
          city: param && param.city && param.city !== null && param.city !== '' ? param.city : null,
          status: param && (param.status === 'yes' || param.status === 'Yes'),
        });
        const user = await User.create(userData);
        const driverData = new Driver({
          userId: user.id,
          city: param && param.city && param.city !== null && param.city !== '' ? param.city : null,
          locality:
            param &&
            param.locality &&
            param.locality !== null &&
            param.locality !== '' &&
            param.locality !== '-'
              ? param.locality
              : null,
          restaurant: null,
          vehicle:
            param && param.vehicle && param.vehicle !== '' && param.vehicle !== null
              ? param.vehicle
              : null,
          location: { type: 'Point', coordinates: [longitude, latitude] },
          type:
            param && param.type && param.type !== null && param.type !== ''
              ? param.type
              : 'freelancer',
          identity:
            param && param.identity && param.identity !== null && param.identity !== ''
              ? param.identity
              : 'passport',
          identityNumber:
            param &&
            param.identityNumber &&
            param.identityNumber !== null &&
            param.identityNumber !== ''
              ? param.identityNumber
              : 'NA',
          identityProof:
            param &&
            param.identityProof &&
            param.identityProof !== null &&
            param.identityProof !== ''
              ? param.identityProof
              : 'NA',
          drivingLicense:
            param &&
            param.drivingLicense &&
            param.drivingLicense !== null &&
            param.drivingLicense !== ''
              ? param.drivingLicense
              : 'NA',
          age: param && param.age && param.age !== null && param.age !== '' ? param.age : 21,
          dob:
            param && param.dob && param.dob !== null && param.dob !== '' ? param.dob : '1997-07-15',
          rating: 0,
          isBlocked: param && (param.isBlocked === 'yes' || param.isBlocked === 'Yes'),
          activeStatus: true,
          offlineReason:
            param &&
            param.offlineReason &&
            param.offlineReason !== null &&
            param.offlineReason !== '' &&
            param.offlineReason !== '-'
              ? param.offlineReason
              : null,
        });
        await Driver.create(driverData);
        const walletData = new Wallet({
          holderId: user.id,
        });
        if (!(await Wallet.isUserExist(walletData.holderId))) {
          await Wallet.create(walletData);
        }
      }
    });
  }
  return { success: true };
};

const checkPermissionOfRestaurant = async (vendor) => {
  const restaurantInfo = await Restaurant.findOne({ _id: new mongoose.Types.ObjectId(vendor) });
  let ownDeliveryman = false;
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId, {
      ownDriver: 1,
    });
    if (outletManager !== null && outletManager.id !== null) {
      ownDeliveryman = outletManager.ownDriver;
    }
  } else {
    ownDeliveryman = restaurantInfo.ownDriver;
  }
  return { ownDeliveryman };
};

const importVendorDeliverymanCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const permission = await checkPermissionOfRestaurant(param.restaurant);
      if (permission && permission !== null && permission.ownDeliveryman) {
        let isValid = true;
        if (await User.isEmailTaken(param.email)) {
          isValid = false;
        }
        if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
          isValid = false;
        }
        if (isValid) {
          const longitude =
            param && param.longitude && param.longitude !== null && param.longitude !== ''
              ? param.longitude
              : 0;
          const latitude =
            param && param.latitude && param.latitude !== null && param.latitude !== ''
              ? param.latitude
              : 0;
          const userData = new User({
            email: param.email,
            password: generateSecurePassword(15),
            firstName:
              param && param.firstName && param.firstName !== null && param.firstName !== ''
                ? param.firstName
                : 'NA',
            lastName:
              param && param.lastName && param.lastName !== null && param.lastName !== ''
                ? param.lastName
                : 'NA',
            countryCode: param.countryCode,
            mobile: param.mobile,
            locale:
              param && param.locale && param.locale !== null && param.locale !== ''
                ? param.locale
                : 'en',
            image:
              param && param.image && param.image !== null && param.image !== ''
                ? param.image
                : 'NA',
            gender:
              param && param.gender && param.gender !== null && param.gender !== ''
                ? param.gender
                : 'male',
            role: 'vendorDriver',
            location: { type: 'Point', coordinates: [longitude, latitude] },
            city:
              param && param.city && param.city !== null && param.city !== '' ? param.city : null,
            status: param && (param.status === 'yes' || param.status === 'Yes'),
          });
          const user = await User.create(userData);
          const driverData = new Driver({
            userId: user.id,
            city:
              param && param.city && param.city !== null && param.city !== '' ? param.city : null,
            locality:
              param &&
              param.locality &&
              param.locality !== null &&
              param.locality !== '' &&
              param.locality !== '-'
                ? param.locality
                : null,
            restaurant:
              param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
                ? param.restaurant
                : null,
            vehicle:
              param && param.vehicle && param.vehicle !== '' && param.vehicle !== null
                ? param.vehicle
                : null,
            location: { type: 'Point', coordinates: [longitude, latitude] },
            type: 'freelancer',
            identity:
              param && param.identity && param.identity !== null && param.identity !== ''
                ? param.identity
                : 'passport',
            identityNumber:
              param &&
              param.identityNumber &&
              param.identityNumber !== null &&
              param.identityNumber !== ''
                ? param.identityNumber
                : 'NA',
            identityProof:
              param &&
              param.identityProof &&
              param.identityProof !== null &&
              param.identityProof !== ''
                ? param.identityProof
                : 'NA',
            drivingLicense:
              param &&
              param.drivingLicense &&
              param.drivingLicense !== null &&
              param.drivingLicense !== ''
                ? param.drivingLicense
                : 'NA',
            age: param && param.age && param.age !== null && param.age !== '' ? param.age : 21,
            dob:
              param && param.dob && param.dob !== null && param.dob !== ''
                ? param.dob
                : '1997-07-15',
            rating: 0,
            isBlocked: param && (param.isBlocked === 'yes' || param.isBlocked === 'Yes'),
            activeStatus: true,
            offlineReason:
              param &&
              param.offlineReason &&
              param.offlineReason !== null &&
              param.offlineReason !== '' &&
              param.offlineReason !== '-'
                ? param.offlineReason
                : null,
          });
          await Driver.create(driverData);
          const walletData = new Wallet({
            holderId: user.id,
          });
          if (!(await Wallet.isUserExist(walletData.holderId))) {
            await Wallet.create(walletData);
          }
        }
      }
    });
  }
  return { success: true };
};

module.exports = {
  createDriver,
  createVendorDriver,
  getMyZoneSummary,
  getDriverById,
  updateStatus,
  getById,
  updateDriverById,
  goOffline,
  goOnline,
  getAllDriver,
  updateDriverLocation,
  getNearMeActiveDriver,
  getAllVendorDriver,
  updateMyLocation,
  getAllVendorDriverList,
  getDeliverymanFromCity,
  addMoneyToWalletAfterDelivery,
  deliverymanWalletFundList,
  deliverymanReport,
  vendorDeliverymanList,
  deliverymanInformation,
  cityMapDialogDeliveryman,
  supportTeamDeliverymanList,
  cityzenSystemDriver,
  cityzenVendorDriverList,
  cityzenDetail,
  cityzenUpdateDriverById,
  cityzenCreateDriver,
  cityzenDeliverymanList,
  exportSystemDeliverymanCollection,
  exportSystemDeliverymanRawCollection,
  exportVendorDeliverymanCollection,
  exportVendorDeliverymanRawCollection,
  exportDeliverymanFundCollection,
  exportRawDeliverymanFundCollection,
  exportDeliverymanReportCollection,
  importSystemDeliverymanCollection,
  importVendorDeliverymanCollection,
};

