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
const { Coupon, City, Restaurant, BusinessSettings, Orders, User } = require('../models');
const ApiError = require('../utils/ApiError');
const cartIteService = require('./cart.item.service');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createCoupon = async (param) => {
  const couponData = new Coupon({
    name: param.name,
    city: param.city,
    createdById:
      param && param.createdById && param.createdById !== null && param.createdById !== ''
        ? param.createdById
        : null,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    couponType: param.couponType,
    allRestaurants: param.allRestaurants,
    restaurant: param.restaurant,
    allUsers: param.allUsers,
    user: param.user,
    code: param.code,
    limitSameUser:
      param !== null && param.limitSameUser !== null && param.limitSameUser !== ''
        ? param.limitSameUser
        : 0,
    start: param.start,
    expires: param.expires,
    discountType: param.discountType,
    minDiscount:
      param !== null && param.minDiscount !== null && param.minDiscount !== ''
        ? param.minDiscount
        : 0,
    maxDiscount:
      param !== null && param.maxDiscount !== null && param.maxDiscount !== ''
        ? param.maxDiscount
        : 0,
    minCartTotal:
      param !== null && param.minCartTotal !== null && param.minCartTotal !== ''
        ? param.minCartTotal
        : 0,
    loyalityPoints:
      param !== null && param.loyalityPoints !== null && param.loyalityPoints !== ''
        ? param.loyalityPoints
        : 0,
    translations: param.translations,
    status: 'live',
    createdBy: 'admin',
  });
  await Coupon.create(couponData);
  return { success: true };
};

const cityzenCreateCoupon = async (masterId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const cityDetail = await City.findById(city);
  if (!cityDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const locationType = cityDetail.location.type;
  const latitude = cityDetail.location.coordinates[1];
  const longitude = cityDetail.location.coordinates[0];
  const couponData = new Coupon({
    name: param.name,
    city: `${city}`,
    createdById:
      param && param.createdById && param.createdById !== null && param.createdById !== ''
        ? param.createdById
        : null,
    location: { type: locationType, coordinates: [longitude, latitude] },
    couponType: param.couponType,
    allRestaurants: param.allRestaurants,
    restaurant: param.restaurant,
    allUsers: param.allUsers,
    user: param.user,
    code: param.code,
    limitSameUser:
      param !== null && param.limitSameUser !== null && param.limitSameUser !== ''
        ? param.limitSameUser
        : 0,
    start: param.start,
    expires: param.expires,
    discountType: param.discountType,
    minDiscount:
      param !== null && param.minDiscount !== null && param.minDiscount !== ''
        ? param.minDiscount
        : 0,
    maxDiscount:
      param !== null && param.maxDiscount !== null && param.maxDiscount !== ''
        ? param.maxDiscount
        : 0,
    minCartTotal:
      param !== null && param.minCartTotal !== null && param.minCartTotal !== ''
        ? param.minCartTotal
        : 0,
    loyalityPoints:
      param !== null && param.loyalityPoints !== null && param.loyalityPoints !== ''
        ? param.loyalityPoints
        : 0,
    translations: param.translations,
    status: 'live',
    createdBy: 'cityzen',
  });
  await Coupon.create(couponData);
  return { success: true };
};

const requestNewCoupon = async (param) => {
  const restaurantQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(param.restaurantId) } },
    { $limit: 1 },
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
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        cityInfo: {
          id: { $ifNull: ['$cities._id', ''] },
          location: { $ifNull: ['$cities.location', null] },
        },
        users: {
          id: { $ifNull: ['$users._id', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];

  const info = await Restaurant.aggregate(restaurantQuery);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantInfo = info[0];
  if (
    restaurantInfo &&
    restaurantInfo !== null &&
    restaurantInfo.cityInfo &&
    restaurantInfo.cityInfo !== null &&
    restaurantInfo.cityInfo.id &&
    restaurantInfo.cityInfo.id !== null &&
    restaurantInfo.cityInfo.id !== ''
  ) {
    const cityId = restaurantInfo.cityInfo.id;
    let cityLatitude = 0;
    let cityLongitude = 0;
    let userRole = '';
    if (
      restaurantInfo.users &&
      restaurantInfo.users !== null &&
      restaurantInfo.users.role &&
      restaurantInfo.users.role !== null
    ) {
      userRole = restaurantInfo.users.role;
    }
    if (
      restaurantInfo.cityInfo.location &&
      checkArrayNotEmpty(restaurantInfo.cityInfo.location.coordinates)
    ) {
      const { coordinates } = restaurantInfo.cityInfo.location;
      cityLatitude = coordinates[1];
      cityLongitude = coordinates[0];
    }
    const couponData = new Coupon({
      name: param.name,
      city: cityId,
      createdById:
        param && param.createdById && param.createdById !== null && param.createdById !== ''
          ? param.createdById
          : null,
      location: { type: 'Point', coordinates: [cityLongitude, cityLatitude] },
      couponType: 'default',
      allRestaurants: false,
      restaurant: [param.restaurantId],
      allUsers: true,
      user: [],
      code: param.code,
      limitSameUser:
        param !== null && param.limitSameUser !== null && param.limitSameUser !== ''
          ? param.limitSameUser
          : 0,
      start: param.start,
      expires: param.expires,
      discountType: param.discountType,
      minDiscount:
        param !== null && param.minDiscount !== null && param.minDiscount !== ''
          ? param.minDiscount
          : 0,
      maxDiscount:
        param !== null && param.maxDiscount !== null && param.maxDiscount !== ''
          ? param.maxDiscount
          : 0,
      minCartTotal:
        param !== null && param.minCartTotal !== null && param.minCartTotal !== ''
          ? param.minCartTotal
          : 0,
      loyalityPoints: 0,
      translations: param.translations,
      status: 'requested',
      createdBy: userRole,
    });
    return Coupon.create(couponData);
  }
  return { success: false };
};

const getCouponById = async (id) => {
  return Coupon.findById(id);
};

const updateCoupon = async (id, param) => {
  const coupon = await getCouponById(id);
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const couponData = {
    name: param.name,
    city: param.city,
    createdById:
      param && param.createdById && param.createdById !== null && param.createdById !== ''
        ? param.createdById
        : null,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    couponType: param.couponType,
    allRestaurants: param.allRestaurants,
    restaurant: param.restaurant,
    allUsers: param.allUsers,
    user: param.user,
    code: param.code,
    limitSameUser:
      param !== null && param.limitSameUser !== null && param.limitSameUser !== ''
        ? param.limitSameUser
        : 0,
    start: param.start,
    expires: param.expires,
    discountType: param.discountType,
    minDiscount:
      param !== null && param.minDiscount !== null && param.minDiscount !== ''
        ? param.minDiscount
        : 0,
    maxDiscount:
      param !== null && param.maxDiscount !== null && param.maxDiscount !== ''
        ? param.maxDiscount
        : 0,
    minCartTotal:
      param !== null && param.minCartTotal !== null && param.minCartTotal !== ''
        ? param.minCartTotal
        : 0,
    loyalityPoints:
      param !== null && param.loyalityPoints !== null && param.loyalityPoints !== ''
        ? param.loyalityPoints
        : 0,
    translations: param.translations,
  };
  Object.assign(coupon, couponData);
  await coupon.save();
  return { success: true };
};

const cityzenUpdateCoupon = async (id, param) => {
  const coupon = await getCouponById(id);
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const couponData = {
    name: param.name,
    createdById:
      param && param.createdById && param.createdById !== null && param.createdById !== ''
        ? param.createdById
        : null,
    couponType: param.couponType,
    allRestaurants: param.allRestaurants,
    restaurant: param.restaurant,
    allUsers: param.allUsers,
    user: param.user,
    code: param.code,
    limitSameUser:
      param !== null && param.limitSameUser !== null && param.limitSameUser !== ''
        ? param.limitSameUser
        : 0,
    start: param.start,
    expires: param.expires,
    discountType: param.discountType,
    minDiscount:
      param !== null && param.minDiscount !== null && param.minDiscount !== ''
        ? param.minDiscount
        : 0,
    maxDiscount:
      param !== null && param.maxDiscount !== null && param.maxDiscount !== ''
        ? param.maxDiscount
        : 0,
    minCartTotal:
      param !== null && param.minCartTotal !== null && param.minCartTotal !== ''
        ? param.minCartTotal
        : 0,
    loyalityPoints:
      param !== null && param.loyalityPoints !== null && param.loyalityPoints !== ''
        ? param.loyalityPoints
        : 0,
    translations: param.translations,
  };
  Object.assign(coupon, couponData);
  await coupon.save();
  return { success: true };
};

const updateVendorCoupon = async (id, param) => {
  const userId = param.createdById ? param.createdById : '';
  const coupon = await Coupon.findOne({
    _id: new mongoose.Types.ObjectId(id),
    createdById: new mongoose.Types.ObjectId(userId),
  });
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const couponData = {
    name: param.name,
    code: param.code,
    limitSameUser:
      param !== null && param.limitSameUser !== null && param.limitSameUser !== ''
        ? param.limitSameUser
        : 0,
    start: param.start,
    expires: param.expires,
    discountType: param.discountType,
    minDiscount:
      param !== null && param.minDiscount !== null && param.minDiscount !== ''
        ? param.minDiscount
        : 0,
    maxDiscount:
      param !== null && param.maxDiscount !== null && param.maxDiscount !== ''
        ? param.maxDiscount
        : 0,
    minCartTotal:
      param !== null && param.minCartTotal !== null && param.minCartTotal !== ''
        ? param.minCartTotal
        : 0,
    translations: param.translations,
  };
  Object.assign(coupon, couponData);
  await coupon.save();
  return { success: true };
};

const deleteCoupon = async (id) => {
  const coupon = await getCouponById(id);
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await coupon.deleteOne();
  return { success: true };
};

const deleteVendorCoupon = async (id, userId) => {
  const coupon = await Coupon.findOne({
    _id: new mongoose.Types.ObjectId(id),
    createdById: new mongoose.Types.ObjectId(userId),
  });
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await coupon.deleteOne();
  return { success: true };
};

const updateMetaInfo = async (id, updateBody) => {
  const coupon = await getCouponById(id);
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(coupon, updateBody);
  await coupon.save();
  return { success: true };
};

const getAllCoupon = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: { $ne: 'requested' } }],
      },
    },
    {
      $sort: {
        createdAt: -1,
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'coupon',
        as: 'orders',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        start: 1,
        expires: 1,
        couponType: 1,
        minCartTotal: 1,
        status: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        redeem: {
          $size: '$orders',
        },
      },
    },
  ];
  const coupons = await Coupon.aggregate(query);
  const countResult = await Coupon.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: { $ne: 'requested' } }],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([coupons, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      coupons,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const cityzenCouponList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: { $ne: 'requested' } }, { city: new mongoose.Types.ObjectId(city) }],
      },
    },
    {
      $sort: {
        createdAt: -1,
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'coupon',
        as: 'orders',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        start: 1,
        expires: 1,
        couponType: 1,
        minCartTotal: 1,
        status: 1,
        translations: 1,
        redeem: {
          $size: '$orders',
        },
      },
    },
  ];
  const coupons = await Coupon.aggregate(query);
  const countResult = await Coupon.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: { $ne: 'requested' } }, { city: new mongoose.Types.ObjectId(city) }],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([coupons, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      coupons,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const getInfo = async (id) => {
  const couponQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
              email: 1,
              role: 1,
            },
          },
        ],
        as: 'users',
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
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        users: 1,
        allRestaurants: 1,
        allUsers: 1,
        city: 1,
        cityInfo: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          image: { $ifNull: ['$cities.image', ''] },
          location: { $ifNull: ['$cities.location', null] },
          slug: { $ifNull: ['$cities.slug', ''] },
          status: { $ifNull: ['$cities.status', true] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        code: 1,
        couponType: 1,
        discountType: 1,
        expires: 1,
        limitSameUser: {
          $round: [{ $divide: ['$limitSameUser', 100] }, 2],
        },
        location: 1,
        loyalityPoints: {
          $round: [{ $divide: ['$loyalityPoints', 100] }, 2],
        },
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minCartTotal: {
          $round: [{ $divide: ['$minCartTotal', 100] }, 2],
        },
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        restaurant: 1,
        start: 1,
        status: 1,
        translations: 1,
      },
    },
  ];
  const info = await Coupon.aggregate(couponQuery);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const city = await City.find({ status: true }, { id: 1, name: 1, location: 1, translations: 1 });
  const restaurant = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(info[0].city),
        status: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'owner',
      },
    },
    {
      $unwind: {
        path: '$owner',
        preserveNullAndEmptyArrays: true,
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        translations: 1,
        slug: 1,
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        ownerInfo: {
          id: { $ifNull: ['$owner._id', ''] },
          firstName: { $ifNull: ['$owner.firstName', ''] },
          lastName: { $ifNull: ['$owner.lastName', ''] },
        },
      },
    },
  ]);
  return { info: info[0], cities: city, restaurants: restaurant };
};

const cityzenCouponDetail = async (id) => {
  const couponQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
              email: 1,
              role: 1,
            },
          },
        ],
        as: 'users',
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
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        users: 1,
        allRestaurants: 1,
        allUsers: 1,
        city: 1,
        cityInfo: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          image: { $ifNull: ['$cities.image', ''] },
          location: { $ifNull: ['$cities.location', null] },
          slug: { $ifNull: ['$cities.slug', ''] },
          status: { $ifNull: ['$cities.status', true] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        code: 1,
        couponType: 1,
        discountType: 1,
        expires: 1,
        limitSameUser: {
          $round: [{ $divide: ['$limitSameUser', 100] }, 2],
        },
        location: 1,
        loyalityPoints: {
          $round: [{ $divide: ['$loyalityPoints', 100] }, 2],
        },
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minCartTotal: {
          $round: [{ $divide: ['$minCartTotal', 100] }, 2],
        },
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        restaurant: 1,
        start: 1,
        status: 1,
        translations: 1,
      },
    },
  ];
  const info = await Coupon.aggregate(couponQuery);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const restaurant = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(info[0].city),
        status: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'owner',
      },
    },
    {
      $unwind: {
        path: '$owner',
        preserveNullAndEmptyArrays: true,
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        translations: 1,
        slug: 1,
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        ownerInfo: {
          id: { $ifNull: ['$owner._id', ''] },
          firstName: { $ifNull: ['$owner.firstName', ''] },
          lastName: { $ifNull: ['$owner.lastName', ''] },
        },
      },
    },
  ]);

  return { info: info[0], restaurants: restaurant };
};

const getUserCoupon = async (latitude, longitude) => {
  const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };

  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const radius =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 10;
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
  const currentDate = new Date();
  const couponQuery = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
      query: { status: 'live', start: { $lte: currentDate }, expires: { $gte: currentDate } },
    },
  };
  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    allRestaurants: 1,
    allUsers: 1,
    code: 1,
    couponType: 1,
    discountType: 1,
    limitSameUser: {
      $round: [{ $divide: ['$limitSameUser', 100] }, 2],
    },
    loyalityPoints: {
      $round: [{ $divide: ['$loyalityPoints', 100] }, 2],
    },
    maxDiscount: {
      $round: [{ $divide: ['$maxDiscount', 100] }, 2],
    },
    minCartTotal: {
      $round: [{ $divide: ['$minCartTotal', 100] }, 2],
    },
    minDiscount: {
      $round: [{ $divide: ['$minDiscount', 100] }, 2],
    },
    restaurant: 1,
    user: 1,
    translations: 1,
  };
  const coupons = await Coupon.aggregate([couponQuery, { $project: filterOptions }]);
  if (coupons !== null && coupons.length > 0) {
    const totalCountResult = await Coupon.aggregate([
      {
        $geoNear: {
          near: queryPoint,
          maxDistance: radiusInMeters,
          distanceField: 'distance',
          spherical: true,
          query: {
            status: 'live',
            start: { $lte: currentDate },
            expires: { $gte: currentDate },
          },
        },
      },
      {
        $count: 'total',
      },
    ]);
    const totalResults = totalCountResult.length ? totalCountResult[0].total : 0;
    return Promise.all([coupons, totalCountResult]).then(() => {
      const result = {
        coupons,
        totalResults,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const redeemCoupon = async (userId, couponId, tracking, restaurant) => {
  const coupon = await getCouponById(couponId);
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const orderRedeemCoupons = await Orders.countDocuments({ user: userId, coupon: couponId });
  if (orderRedeemCoupons <= coupon.limitSameUser) {
    if (coupon.couponType === 'firstorder') {
      const firstOrder = await Orders.countDocuments({ user: userId });
      if (firstOrder <= 0) {
        return { success: true };
      }
      throw new ApiError(httpStatus.FAILED_DEPENDENCY, 'Coupon Already redemeed');
    } else if (coupon.couponType === 'bogo') {
      const checkCartItem = await cartIteService.checkBOGOOffer(tracking, restaurant);
      if (
        checkCartItem &&
        checkCartItem.quantity !== null &&
        parseInt(checkCartItem.quantity, 10) >= 2
      ) {
        return { success: true };
      }
      throw new ApiError(
        httpStatus.FAILED_DEPENDENCY,
        'Please add one more item to validate BOGO offer'
      );
    }
    return { success: true };
  }
  throw new ApiError(httpStatus.FAILED_DEPENDENCY, 'Coupon Limit Crossed');
};

const getCouponInfo = async (couponId) => {
  const couponData = await Coupon.findOne(
    {
      _id: new mongoose.Types.ObjectId(couponId),
    },
    { loyalityPoints: 1, couponType: 1 }
  );
  return couponData;
};

const getVendorCoupons = async (options) => {
  const vendorId = options.vendorId ? options.vendorId : '';
  const userId = options.userId ? options.userId : '';
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    $and: [
      {
        restaurant: { $in: [new mongoose.Types.ObjectId(vendorId)] },
        allRestaurants: false,
        couponType: 'default',
        createdById: new mongoose.Types.ObjectId(userId),
      },
    ],
  };
  const query = [
    { $match: queryCondition },
    {
      $sort: {
        createdAt: -1,
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        code: 1,
        limitSameUser: 1,
        start: 1,
        expires: 1,
        discountType: 1,
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        couponType: 1,
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minCartTotal: {
          $round: [{ $divide: ['$minCartTotal', 100] }, 2],
        },
        status: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          image: { $ifNull: ['$cities.image', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
          slug: { $ifNull: ['$cities.slug', ''] },
          status: { $ifNull: ['$cities.status', ''] },
          location: { $ifNull: ['$cities.location', null] },
        },
      },
    },
  ];
  const coupons = await Coupon.aggregate(query);
  const totalResults = await Coupon.countDocuments(queryCondition);
  return Promise.all([coupons, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      coupons,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const getVendorCouponInfo = async (options) => {
  const id = options.id ? options.id : '';
  const userId = options.userId ? options.userId : '';
  const coupon = await Coupon.findOne(
    {
      _id: new mongoose.Types.ObjectId(id),
      createdById: new mongoose.Types.ObjectId(userId),
    },
    {
      name: 1,
      code: 1,
      limitSameUser: 1,
      start: 1,
      expires: 1,
      discountType: 1,
      minDiscount: 1,
      maxDiscount: 1,
      minCartTotal: 1,
      translations: 1,
    }
  );
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return { info: coupon, success: true };
};

const getVendorCouponRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: 'requested' }],
      },
    },
    {
      $sort: {
        createdAt: -1,
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'restaurants',
        localField: 'createdById',
        foreignField: 'userId',
        as: 'restaurants',
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
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        code: 1,
        limitSameUser: 1,
        start: 1,
        expires: 1,
        discountType: 1,
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        couponType: 1,
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minCartTotal: {
          $round: [{ $divide: ['$minCartTotal', 100] }, 2],
        },
        status: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        restaurantInfo: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const coupons = await Coupon.aggregate(query);
  const countResult = await Coupon.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: 'requested' }],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([coupons, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      coupons,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const cityzenCouponRequest = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: 'requested' }, { city: new mongoose.Types.ObjectId(city) }],
      },
    },
    {
      $sort: {
        createdAt: -1,
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'createdById',
        foreignField: 'userId',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        code: 1,
        limitSameUser: 1,
        start: 1,
        expires: 1,
        discountType: 1,
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        couponType: 1,
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minCartTotal: {
          $round: [{ $divide: ['$minCartTotal', 100] }, 2],
        },
        status: 1,
        translations: 1,
        restaurantInfo: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const coupons = await Coupon.aggregate(query);
  const countResult = await Coupon.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: 'requested' }, { city: new mongoose.Types.ObjectId(city) }],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([coupons, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      coupons,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const getCouponInfoForCheckout = async (couponId) => {
  const couponData = await Coupon.findOne({
    _id: new mongoose.Types.ObjectId(couponId),
  });
  if (!couponData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return couponData;
};

const couponDetail = async (id) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
        pipeline: [
          { $match: { status: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              translations: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          { $match: { status: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
            },
          },
        ],
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
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        allRestaurants: 1,
        allUsers: 1,
        code: 1,
        couponType: 1,
        discountType: 1,
        expires: 1,
        limitSameUser: {
          $round: [{ $divide: ['$limitSameUser', 100] }, 2],
        },
        loyalityPoints: {
          $round: [{ $divide: ['$loyalityPoints', 100] }, 2],
        },
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minCartTotal: {
          $round: [{ $divide: ['$minCartTotal', 100] }, 2],
        },
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        start: 1,
        translations: 1,
        restaurants: 1,
        users: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
      },
    },
  ];
  const couponInfo = await Coupon.aggregate(query);
  if (!couponInfo[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = couponInfo[0];
  return detail;
};

const exportCollection = async (requested, search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: requested ? [{ status: 'requested' }] : [{ status: { $ne: 'requested' } }],
      },
    },
    {
      $sort: { createdAt: -1 },
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
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'coupon',
        as: 'orders',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        start: 1,
        expires: 1,
        couponType: 1,
        status: 1,
        allRestaurants: 1,
        restaurantCount: { $size: '$restaurant' },
        allUsers: 1,
        userCount: { $size: '$user' },
        code: 1,
        limitSameUser: {
          $round: [{ $divide: ['$limitSameUser', 100] }, 2],
        },
        loyalityPoints: {
          $round: [{ $divide: ['$loyalityPoints', 100] }, 2],
        },
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minCartTotal: {
          $round: [{ $divide: ['$minCartTotal', 100] }, 2],
        },
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        discountType: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        redeem: {
          $size: '$orders',
        },
      },
    },
  ];
  const results = await Coupon.aggregate(query);
  return results;
};

const exportRawCollection = async (requested, search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: requested ? [{ status: 'requested' }] : [{ status: { $ne: 'requested' } }],
      },
    },
    {
      $sort: { createdAt: -1 },
    },
  ];
  const results = await Coupon.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const cityId =
        param && param.city && param.city !== null && param.city !== '' ? param.city : null;
      const longitude =
        param && param.longitude && param.longitude !== null && param.longitude !== ''
          ? param.longitude
          : 0;
      const latitude =
        param && param.latitude && param.latitude !== null && param.latitude !== ''
          ? param.latitude
          : 0;
      const couponTypeArray = [
        'default',
        'restaurant',
        'freedelivery',
        'firstorder',
        'loyality',
        'bogo',
      ];
      const statusArray = ['hold', 'live', 'hide', 'requested'];
      if (
        cityId !== null &&
        couponTypeArray.includes(param.couponType) &&
        statusArray.includes(param.status)
      ) {
        const couponData = new Coupon({
          name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
          city: cityId,
          createdById: null,
          location: { type: 'Point', coordinates: [longitude, latitude] },
          couponType: param.couponType,
          allRestaurants:
            param && (param.allRestaurants === 'yes' || param.allRestaurants === 'Yes'),
          restaurant:
            param &&
            param.restaurant &&
            param.restaurant !== null &&
            param.restaurant !== '' &&
            param.restaurant !== '-'
              ? param.restaurant.split(',')
              : [],
          allUsers: param && (param.allUsers === 'yes' || param.allUsers === 'Yes'),
          user:
            param && param.user && param.user !== null && param.user !== '' && param.user !== '-'
              ? param.user.split(',')
              : [],
          code:
            param && param.code && param.code !== null && param.code !== ''
              ? param.code
              : 'XXXXXXX',
          limitSameUser:
            param !== null && param.limitSameUser !== null && param.limitSameUser !== ''
              ? param.limitSameUser
              : 0,
          start:
            param && param.start && param.start !== null && param.start !== ''
              ? param.start
              : '2025-08-02',
          expires:
            param && param.expires && param.expires !== null && param.expires !== ''
              ? param.expires
              : '2025-08-30',
          discountType:
            param &&
            param.discountType &&
            param.discountType !== null &&
            param.discountType !== '' &&
            param.discountType === 'amount'
              ? 'amount'
              : 'percentage',
          minDiscount:
            param !== null && param.minDiscount !== null && param.minDiscount !== ''
              ? param.minDiscount
              : 0,
          maxDiscount:
            param !== null && param.maxDiscount !== null && param.maxDiscount !== ''
              ? param.maxDiscount
              : 0,
          minCartTotal:
            param !== null && param.minCartTotal !== null && param.minCartTotal !== ''
              ? param.minCartTotal
              : 0,
          loyalityPoints:
            param !== null && param.loyalityPoints !== null && param.loyalityPoints !== ''
              ? param.loyalityPoints
              : 0,
          translations: [],
          status: param.status,
          createdBy: 'admin',
        });
        await Coupon.create(couponData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  createCoupon,
  updateCoupon,
  deleteCoupon,
  updateMetaInfo,
  getAllCoupon,
  getInfo,
  getUserCoupon,
  redeemCoupon,
  getCouponInfo,
  requestNewCoupon,
  getVendorCoupons,
  getVendorCouponInfo,
  updateVendorCoupon,
  deleteVendorCoupon,
  getVendorCouponRequest,
  getCouponInfoForCheckout,
  couponDetail,
  cityzenCouponList,
  cityzenCreateCoupon,
  cityzenCouponDetail,
  cityzenUpdateCoupon,
  cityzenCouponRequest,
  exportCollection,
  exportRawCollection,
  importCollection,
};

