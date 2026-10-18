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
const lodash = require('lodash');
const {
  DiningCampaign,
  DiningCampaignRequest,
  BusinessSettings,
  Restaurant,
  HideRestaurant,
  DiningBooking,
  User,
} = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createCampaign = async (param) => {
  const campaignData = new DiningCampaign({
    title: param.title,
    shortDescription: param.shortDescription,
    city: param.city,
    restaurant: param.restaurant,
    image: param.image,
    startDate: param.startDate,
    endDate: param.endDate,
    startTime: param.startTime,
    endTime: param.endTime,
    translations: param.translations,
    status: true,
  });
  await DiningCampaign.create(campaignData);
  return { success: true };
};

const cityzenCreateCampaign = async (masterId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const campaignData = new DiningCampaign({
    title: param.title,
    shortDescription: param.shortDescription,
    restaurant: param.restaurant,
    image: param.image,
    startDate: param.startDate,
    endDate: param.endDate,
    startTime: param.startTime,
    endTime: param.endTime,
    translations: param.translations,
    city: `${city}`,
  });
  await DiningCampaign.create(campaignData);
  return { success: true };
};

const getAllDiningCampaignAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { title: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
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
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'diningcampaignrequests',
        localField: '_id',
        foreignField: 'campaign',
        as: 'diningcampaignrequests',
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
        endDate: 1,
        endTime: 1,
        restaurant: 1,
        startDate: 1,
        startTime: 1,
        status: 1,
        title: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          slug: { $ifNull: ['$cities.slug', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        request: {
          $size: '$diningcampaignrequests',
        },
      },
    },
  ];
  const results = await DiningCampaign.aggregate(query);
  const countResult = await DiningCampaign.aggregate([
    {
      $match: {
        $or: [
          { title: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
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

const cityzenCampaignList = async (masterId, options) => {
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
          { title: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ city: new mongoose.Types.ObjectId(city) }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'diningcampaignrequests',
        localField: '_id',
        foreignField: 'campaign',
        as: 'diningcampaignrequests',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        endDate: 1,
        endTime: 1,
        restaurant: 1,
        startDate: 1,
        startTime: 1,
        status: 1,
        title: 1,
        translations: 1,
        request: {
          $size: '$diningcampaignrequests',
        },
      },
    },
  ];
  const results = await DiningCampaign.aggregate(query);
  const countResult = await DiningCampaign.aggregate([
    {
      $match: {
        $or: [
          { title: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ city: new mongoose.Types.ObjectId(city) }],
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

const getCampaignId = async (id) => {
  return DiningCampaign.findById(id);
};

const getById = async (id) => {
  const restaurantCampaign = await getCampaignId(id);
  if (!restaurantCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return restaurantCampaign;
};

const updateStatus = async (campaignId, param) => {
  const restaurantCampaign = await getCampaignId(campaignId);
  if (!restaurantCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: param.status,
  };
  Object.assign(restaurantCampaign, updateBody);
  await restaurantCampaign.save();
  return { success: true };
};

const updateCampaignById = async (campaignId, param) => {
  const restaurantCampaign = await getCampaignId(campaignId);
  if (!restaurantCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(restaurantCampaign, param);
  await restaurantCampaign.save();
  return { success: true };
};

const deleteCampaignById = async (campaignId) => {
  const restaurantCampaign = await getCampaignId(campaignId);
  if (!restaurantCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await restaurantCampaign.deleteOne();
  return { success: true };
};

const getAllCampaign = async (cityId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await DiningCampaign.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(cityId),
      },
    },
    { $sort: { createdAt: -1 } },
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
        title: 1,
        endDate: 1,
        endTime: 1,
        image: 1,
        status: 1,
        restaurant: 1,
        shortDescription: 1,
        startDate: 1,
        startTime: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          slug: { $ifNull: ['$cities.slug', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
      },
    },
  ]);
  const totalResults = await DiningCampaign.countDocuments({
    city: new mongoose.Types.ObjectId(cityId),
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

const leaveCampaign = async (id, restaurantId) => {
  await DiningCampaign.findByIdAndUpdate(id, { $pull: { restaurant: restaurantId } });
  return { success: true };
};

const joinCampaign = async (id, restaurantId) => {
  await DiningCampaign.findByIdAndUpdate(id, { $push: { restaurant: restaurantId } });
  const request = await DiningCampaignRequest.findOne({ campaign: id });
  await request.deleteOne();
  return { success: true };
};

const getDiningCampaign = async (campaignId, latitude, longitude, uid) => {
  const campaign = await DiningCampaign.findById(campaignId);
  if (!campaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  let hiddenRestaurantsId = [];
  let userId;
  if (uid === null || uid === '' || uid === undefined) {
    userId = null;
  } else {
    userId = uid;
  }
  if (userId && userId !== null && userId !== '') {
    hiddenRestaurantsId = await HideRestaurant.distinct(
      'restaurant',
      { user: new mongoose.Types.ObjectId(userId) },
      { _id: 0, restaurant: 1 }
    );
  }
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
  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
      query: {
        _id: {
          $in: campaign.restaurant,
          $nin: hiddenRestaurantsId,
        },
        status: true,
        temporaryClosed: false,
      },
    },
  };
  const restaurantCuisineLookup = {
    $lookup: {
      from: 'cuisines',
      localField: 'cuisine',
      foreignField: '_id',
      as: 'cuisine',
      pipeline: [
        { $match: { status: true } },
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            image: 1,
            status: 1,
            slug: 1,
            translations: 1,
          },
        },
      ],
    },
  };
  const restaurantFavouriteLookup = {
    $lookup: {
      from: 'favourites',
      localField: '_id',
      foreignField: 'restaurant',
      as: 'favourites',
      pipeline: [{ $match: { user: new mongoose.Types.ObjectId(userId) } }],
    },
  };
  const restaurantFavouriteField = {
    $addFields: {
      isFavourite: {
        $cond: {
          if: { $eq: [{ $size: '$favourites' }, 0] },
          then: false,
          else: true,
        },
      },
    },
  };
  const outletPromoteLookup = {
    $lookup: {
      from: 'restaurants',
      localField: 'outletManagerId',
      foreignField: '_id',
      as: 'parentRestaurant',
    },
  };
  const outletUnwindCollection = {
    $unwind: {
      path: '$parentRestaurant',
      preserveNullAndEmptyArrays: true,
    },
  };
  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    logo: 1,
    cover: 1,
    approxDeliveryTime: 1,
    dishPriceForTwo: {
      $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
    },
    translations: 1,
    rating: 1,
    status: 1,
    slug: 1,
    cuisine: 1,
    distance: 1,
    address: 1,
    isFavourite: 1,
    promote: {
      $cond: {
        if: { $eq: ['$promote', true] },
        then: true,
        else: {
          $cond: {
            if: { $eq: ['$isOutlet', true] },
            then: { $ifNull: ['$parentRestaurant.promote', false] },
            else: false,
          },
        },
      },
    },
  };

  const restaurants = await Restaurant.aggregate([
    restaurantQuery,
    {
      $match: {
        $or: [
          { preBooking: true },
          {
            $and: [{ 'parentRestaurant.preBooking': true }, { isOutlet: true }],
          },
        ],
      },
    },
    restaurantCuisineLookup,
    restaurantFavouriteLookup,
    restaurantFavouriteField,
    outletPromoteLookup,
    outletUnwindCollection,
    { $project: filterOptions },
  ]);
  return Promise.all([restaurants, campaign, businessSettings]).then(() => {
    const result = {
      detail: campaign,
      inCampaign: restaurants,
      findMode,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const campaignDetail = async (id, options) => {
  const detailQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
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
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        shortDescription: 1,
        image: 1,
        startDate: 1,
        endDate: 1,
        startTime: 1,
        endTime: 1,
        translations: 1,
        createdAt: 1,
        restaurant: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
      },
    },
  ];
  const detailInfo = await DiningCampaign.aggregate(detailQuery);
  if (!detailInfo[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = detailInfo[0];
  const savedRestaurant = detail.restaurant;
  let restaurantIds = lodash.uniq(savedRestaurant);
  restaurantIds = restaurantIds.map((item) => new mongoose.Types.ObjectId(item));
  const restaurants = await Restaurant.aggregate([
    {
      $match: {
        _id: {
          $in: restaurantIds,
        },
      },
    },
    {
      $lookup: {
        from: 'cuisines',
        localField: 'cuisine',
        foreignField: '_id',
        as: 'cuisine',
        pipeline: [
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
        from: 'restaurantorderreviews',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantorderreviews',
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
      $addFields: {
        cuisineLimited: { $slice: ['$cuisine', 2] },
        moreCuisines: {
          $cond: [
            { $gt: [{ $size: '$cuisine' }, 2] },
            { $subtract: [{ $size: '$cuisine' }, 2] },
            0,
          ],
        },
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
        rating: 1,
        status: 1,
        slug: 1,
        cuisine: '$cuisineLimited',
        moreCuisines: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
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
  ]);
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    campaign: new mongoose.Types.ObjectId(id),
  };
  const bookingQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        paymentMode: 1,
        status: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(bookingQuery);
  const totalResults = await DiningBooking.countDocuments(queryCondition);
  return Promise.all([detailInfo, restaurants, bookings, totalResults]).then(() => {
    const result = {
      detail,
      restaurants,
      bookings,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { title: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
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
        from: 'diningcampaignrequests',
        localField: '_id',
        foreignField: 'campaign',
        as: 'diningcampaignrequests',
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
        endDate: 1,
        endTime: 1,
        restaurantCount: { $size: '$restaurant' },
        startDate: 1,
        startTime: 1,
        status: 1,
        title: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        request: {
          $size: '$diningcampaignrequests',
        },
        shortDescription: 1,
        image: 1,
      },
    },
  ];
  const results = await DiningCampaign.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { title: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await DiningCampaign.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const cityId =
        param && param.city && param.city !== null && param.city !== '' ? param.city : null;
      const restaurants =
        param && param.restaurant !== null && param.restaurant !== '' ? param.restaurant : null;
      if (cityId !== null && restaurants !== null) {
        const campaignData = new DiningCampaign({
          title:
            param && param.title && param.title !== null && param.title !== '' ? param.title : 'NA',
          shortDescription:
            param &&
            param.shortDescription &&
            param.shortDescription !== null &&
            param.shortDescription !== ''
              ? param.shortDescription
              : 'NA',
          city: cityId,
          restaurant: param.restaurant.split(','),
          image:
            param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
          startDate:
            param && param.startDate && param.startDate !== null && param.startDate !== ''
              ? param.startDate
              : '1997-07-15',
          endDate:
            param && param.endDate && param.endDate !== null && param.endDate !== ''
              ? param.endDate
              : '1997-07-15',
          startTime:
            param && param.startTime && param.startTime !== null && param.startTime !== ''
              ? param.startTime
              : '08:00',
          endTime:
            param && param.endTime && param.endTime !== null && param.endTime !== ''
              ? param.endTime
              : '08:00',
          translations: [],
          status: param && (param.status === 'active' || param.status === 'Active'),
        });
        await DiningCampaign.create(campaignData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  createCampaign,
  getAllDiningCampaignAdmin,
  updateStatus,
  deleteCampaignById,
  getById,
  updateCampaignById,
  getAllCampaign,
  leaveCampaign,
  joinCampaign,
  getDiningCampaign,
  campaignDetail,
  cityzenCampaignList,
  cityzenCreateCampaign,
  exportCollection,
  exportRawCollection,
  importCollection,
};

