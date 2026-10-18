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
const { DiningCoupon, City, Restaurant, DiningBooking, User } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createCoupon = async (param) => {
  const couponData = new DiningCoupon({
    name: param.name,
    city: param.city,
    createdById:
      param && param.createdById && param.createdById !== null && param.createdById !== ''
        ? param.createdById
        : null,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
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
    availability:
      param !== null && param.availability !== null && param.availability !== ''
        ? param.availability
        : 'breakfast',
    preBookingChargeRequired: param.preBookingChargeRequired,
    preBookingChargeAmount: param.preBookingChargeAmount,
    translations: param.translations,
    status: 'live',
    createdBy: 'admin',
  });
  await DiningCoupon.create(couponData);
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
  const couponData = new DiningCoupon({
    name: param.name,
    city: `${city}`,
    createdById:
      param && param.createdById && param.createdById !== null && param.createdById !== ''
        ? param.createdById
        : null,
    location: { type: locationType, coordinates: [longitude, latitude] },
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
    availability:
      param !== null && param.availability !== null && param.availability !== ''
        ? param.availability
        : 'breakfast',
    preBookingChargeRequired: param.preBookingChargeRequired,
    preBookingChargeAmount: param.preBookingChargeAmount,
    translations: param.translations,
    status: 'live',
    createdBy: 'cityzen',
  });
  await DiningCoupon.create(couponData);
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
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'coupon',
        as: 'diningbookings',
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
        preBookingChargeRequired: 1,
        preBookingChargeAmount: 1,
        availability: 1,
        status: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        redeem: {
          $size: '$diningbookings',
        },
      },
    },
  ];
  const coupons = await DiningCoupon.aggregate(query);
  const countResult = await DiningCoupon.aggregate([
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
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'coupon',
        as: 'diningbookings',
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
        preBookingChargeRequired: 1,
        preBookingChargeAmount: 1,
        availability: 1,
        status: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        redeem: {
          $size: '$diningbookings',
        },
      },
    },
  ];
  const coupons = await DiningCoupon.aggregate(query);
  const countResult = await DiningCoupon.aggregate([
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

const getCouponById = async (id) => {
  return DiningCoupon.findById(id);
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

const deleteCoupon = async (id) => {
  const coupon = await getCouponById(id);
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await coupon.deleteOne();
  return { success: true };
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
        discountType: 1,
        expires: 1,
        limitSameUser: {
          $round: [{ $divide: ['$limitSameUser', 100] }, 2],
        },
        location: 1,
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        availability: 1,
        preBookingChargeRequired: 1,
        preBookingChargeAmount: {
          $round: [{ $divide: ['$preBookingChargeAmount', 100] }, 2],
        },
        restaurant: 1,
        start: 1,
        status: 1,
        translations: 1,
      },
    },
  ];
  const info = await DiningCoupon.aggregate(couponQuery);
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

const cityzenDeepDetail = async (id) => {
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
        discountType: 1,
        expires: 1,
        limitSameUser: {
          $round: [{ $divide: ['$limitSameUser', 100] }, 2],
        },
        location: 1,
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        availability: 1,
        preBookingChargeRequired: 1,
        preBookingChargeAmount: {
          $round: [{ $divide: ['$preBookingChargeAmount', 100] }, 2],
        },
        restaurant: 1,
        start: 1,
        status: 1,
        translations: 1,
      },
    },
  ];
  const info = await DiningCoupon.aggregate(couponQuery);
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
    availability:
      param !== null && param.availability !== null && param.availability !== ''
        ? param.availability
        : 'breakfast',
    preBookingChargeRequired: param.preBookingChargeRequired,
    preBookingChargeAmount: param.preBookingChargeAmount,
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
    availability:
      param !== null && param.availability !== null && param.availability !== ''
        ? param.availability
        : 'breakfast',
    preBookingChargeRequired: param.preBookingChargeRequired,
    preBookingChargeAmount: param.preBookingChargeAmount,
    translations: param.translations,
  };
  Object.assign(coupon, couponData);
  await coupon.save();
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
    const couponData = new DiningCoupon({
      name: param.name,
      city: cityId,
      createdById:
        param && param.createdById && param.createdById !== null && param.createdById !== ''
          ? param.createdById
          : null,
      location: { type: 'Point', coordinates: [cityLongitude, cityLatitude] },
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
      availability:
        param !== null && param.availability !== null && param.availability !== ''
          ? param.availability
          : 'breakfast',
      preBookingChargeRequired: param.preBookingChargeRequired,
      preBookingChargeAmount: param.preBookingChargeAmount,
      translations: param.translations,
      status: 'requested',
      createdBy: userRole,
    });
    return DiningCoupon.create(couponData);
  }
  return { success: false };
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
        limitSameUser: {
          $round: [{ $divide: ['$limitSameUser', 100] }, 2],
        },
        start: 1,
        expires: 1,
        preBookingChargeRequired: 1,
        preBookingChargeAmount: {
          $round: [{ $divide: ['$preBookingChargeAmount', 100] }, 2],
        },
        availability: 1,
        status: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
      },
    },
  ];
  const coupons = await DiningCoupon.aggregate(query);
  const totalResults = await DiningCoupon.countDocuments(queryCondition);
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

const deleteVendorCoupon = async (id, userId) => {
  const coupon = await DiningCoupon.findOne({
    _id: new mongoose.Types.ObjectId(id),
    createdById: new mongoose.Types.ObjectId(userId),
  });
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await coupon.deleteOne();
  return { success: true };
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
        minDiscount: 1,
        couponType: 1,
        maxDiscount: 1,
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
  const coupons = await DiningCoupon.aggregate(query);
  const countResult = await DiningCoupon.aggregate([
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
        minDiscount: 1,
        couponType: 1,
        maxDiscount: 1,
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
  const coupons = await DiningCoupon.aggregate(query);
  const countResult = await DiningCoupon.aggregate([
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

const getVendorCouponInfo = async (options) => {
  const id = options.id ? options.id : '';
  const userId = options.userId ? options.userId : '';
  const coupon = await DiningCoupon.findOne(
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
      availability: 1,
      preBookingChargeRequired: 1,
      preBookingChargeAmount: 1,
      translations: 1,
    }
  );
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return { info: coupon };
};

const updateVendorCoupon = async (id, param) => {
  const userId = param.createdById ? param.createdById : '';
  const coupon = await DiningCoupon.findOne({
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
    availability:
      param !== null && param.availability !== null && param.availability !== ''
        ? param.availability
        : 'breakfast',
    preBookingChargeRequired: param.preBookingChargeRequired,
    preBookingChargeAmount: param.preBookingChargeAmount,
    translations: param.translations,
  };
  Object.assign(coupon, couponData);
  await coupon.save();
  return { success: true };
};

const redeemCoupon = async (userId, couponId) => {
  const coupon = await getCouponById(couponId);
  if (!coupon) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const orderRedeemCoupons = await DiningBooking.countDocuments({ user: userId, coupon: couponId });
  if (orderRedeemCoupons <= coupon.limitSameUser) {
    return { success: true };
  }
  throw new ApiError(httpStatus.FAILED_DEPENDENCY, 'Limit Crossed');
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
        // minCartTotal: {
        //   $round: [{ $divide: ['$minCartTotal', 100] }, 2],
        // },
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        start: 1,
        availability: 1,
        preBookingChargeRequired: 1,
        preBookingChargeAmount: {
          $round: [{ $divide: ['$preBookingChargeAmount', 100] }, 2],
        },
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
  const couponInfo = await DiningCoupon.aggregate(query);
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
      $sort: {
        createdAt: -1,
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
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'coupon',
        as: 'diningbookings',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        code: 1,
        allRestaurants: 1,
        restaurantCount: { $size: '$restaurant' },
        allUsers: 1,
        userCount: { $size: '$user' },
        limitSameUser: {
          $round: [{ $divide: ['$limitSameUser', 100] }, 2],
        },
        start: 1,
        expires: 1,
        discountType: 1,
        minDiscount: {
          $round: [{ $divide: ['$minDiscount', 100] }, 2],
        },
        maxDiscount: {
          $round: [{ $divide: ['$maxDiscount', 100] }, 2],
        },
        availability: 1,
        preBookingChargeRequired: 1,
        preBookingChargeAmount: {
          $round: [{ $divide: ['$preBookingChargeAmount', 100] }, 2],
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        redeem: {
          $size: '$diningbookings',
        },
        status: 1,
      },
    },
  ];
  const result = await DiningCoupon.aggregate(query);
  return result;
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
  const results = await DiningCoupon.aggregate(query);
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
      const statusArray = ['hold', 'live', 'hide', 'requested'];
      const availabilityArray = ['breakfast', 'lunch', 'dinner'];
      if (
        cityId !== null &&
        availabilityArray.includes(param.availability) &&
        statusArray.includes(param.status)
      ) {
        const couponData = new DiningCoupon({
          name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
          city: cityId,
          createdById: null,
          location: { type: 'Point', coordinates: [longitude, latitude] },
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
          availability: param.availability,
          preBookingChargeRequired:
            param &&
            (param.preBookingChargeRequired === 'yes' || param.preBookingChargeRequired === 'Yes'),
          preBookingChargeAmount:
            param &&
            param.preBookingChargeAmount &&
            param.preBookingChargeAmount !== null &&
            param.preBookingChargeAmount !== ''
              ? param.preBookingChargeAmount
              : 0,
          translations: [],
          status: param.status,
          createdBy: 'admin',
        });
        await DiningCoupon.create(couponData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  createCoupon,
  getAllCoupon,
  updateMetaInfo,
  deleteCoupon,
  getInfo,
  updateCoupon,
  requestNewCoupon,
  getVendorCoupons,
  deleteVendorCoupon,
  getVendorCouponRequest,
  getVendorCouponInfo,
  updateVendorCoupon,
  redeemCoupon,
  couponDetail,
  cityzenCouponList,
  cityzenCreateCoupon,
  cityzenDeepDetail,
  cityzenUpdateCoupon,
  cityzenCouponRequest,
  exportCollection,
  exportRawCollection,
  importCollection,
};

