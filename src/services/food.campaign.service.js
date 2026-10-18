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
const lodash = require('lodash');
const { status: httpStatus } = require('http-status');
const {
  FoodCampaign,
  FoodCampaignRequest,
  Food,
  HideRestaurant,
  Orders,
  User,
} = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createCampaign = async (param) => {
  const campaignData = new FoodCampaign({
    title: param.title,
    shortDescription: param.shortDescription,
    city: param.city,
    foods: param.foods,
    image: param.image,
    startDate: param.startDate,
    endDate: param.endDate,
    startTime: param.startTime,
    endTime: param.endTime,
    translations: param.translations,
    status: true,
  });
  await FoodCampaign.create(campaignData);
  return { success: true };
};

const cityzenCreateCampaign = async (masterId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const campaignData = new FoodCampaign({
    city: `${city}`,
    title: param.title,
    shortDescription: param.shortDescription,
    foods: param.foods,
    image: param.image,
    startDate: param.startDate,
    endDate: param.endDate,
    startTime: param.startTime,
    endTime: param.endTime,
    translations: param.translations,
  });
  await FoodCampaign.create(campaignData);
  return { success: true };
};

const getAllCampaignAdmin = async (options) => {
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
        from: 'foodcampaignrequests',
        localField: '_id',
        foreignField: 'campaign',
        as: 'foodcampaignrequests',
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
        foods: 1,
        startDate: 1,
        startTime: 1,
        status: 1,
        title: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          image: { $ifNull: ['$cities.image', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          slug: { $ifNull: ['$cities.slug', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        request: {
          $size: '$foodcampaignrequests',
        },
      },
    },
  ];
  const results = await FoodCampaign.aggregate(query);
  const countResult = await FoodCampaign.aggregate([
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
    {
      $sort: {
        createdAt: -1,
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'foodcampaignrequests',
        localField: '_id',
        foreignField: 'campaign',
        as: 'foodcampaignrequests',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        endDate: 1,
        endTime: 1,
        foods: 1,
        startDate: 1,
        startTime: 1,
        status: 1,
        title: 1,
        translations: 1,
        request: {
          $size: '$foodcampaignrequests',
        },
      },
    },
  ];
  const results = await FoodCampaign.aggregate(query);
  const countResult = await FoodCampaign.aggregate([
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

const getAllCampaign = async (cityId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await FoodCampaign.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(cityId),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        endDate: 1,
        endTime: 1,
        image: 1,
        status: 1,
        foods: 1,
        shortDescription: 1,
        startDate: 1,
        startTime: 1,
        translations: 1,
      },
    },
  ]);
  const totalResults = await FoodCampaign.countDocuments({
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

const getCampaignId = async (id) => {
  return FoodCampaign.findById(id);
};

const updateCampaignById = async (campaignId, param) => {
  const foodCampaign = await getCampaignId(campaignId);
  if (!foodCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(foodCampaign, param);
  await foodCampaign.save();
  return { success: true };
};

const deleteCampaignById = async (campaignId) => {
  const foodCampaign = await getCampaignId(campaignId);
  if (!foodCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await foodCampaign.deleteOne();
  return { success: true };
};

const updateStatus = async (campaignId, param) => {
  const foodCampaign = await getCampaignId(campaignId);
  if (!foodCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: param.status,
  };
  Object.assign(foodCampaign, updateBody);
  await foodCampaign.save();
  return { success: true };
};

const getById = async (id) => {
  const infoQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'foods',
        localField: 'foods',
        foreignField: '_id',
        pipeline: [
          { $match: { status: 'live' } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              addons: 1,
              image: 1,
              status: 1,
              variations: 1,
              restaurant: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discountType: 1,
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'foods',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        city: 1,
        endDate: 1,
        endTime: 1,
        image: 1,
        shortDescription: 1,
        startDate: 1,
        startTime: 1,
        title: 1,
        foods: 1,
        translations: 1,
      },
    },
  ];
  const campaignAggregate = await FoodCampaign.aggregate(infoQuery);
  if (!campaignAggregate[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return campaignAggregate[0];
};

const leaveCampaign = async (id, foodId) => {
  const foodCampaign = await FoodCampaign.findById(id, { foods: 1 });
  if (!foodCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (foodCampaign && foodCampaign.foods && foodCampaign.foods.length) {
    foodCampaign.foods = foodCampaign.foods.filter((x) => x.toString() !== foodId);
  }

  Object.assign(foodCampaign, foodCampaign);
  await foodCampaign.save();
  return { success: true };
};

const joinCampaign = async (id, foodId) => {
  const foodCampaign = await FoodCampaign.findById(id, { foods: 1 });
  if (!foodCampaign) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (foodCampaign && foodCampaign.foods) {
    const foodIds = foodCampaign.foods.map((ids) => ids.toString());
    foodIds.push(foodId);
    foodCampaign.foods = foodIds;

    const request = await FoodCampaignRequest.findOne({ campaign: id, food: foodId });
    if (request) {
      await request.deleteOne();
    }
  }

  Object.assign(foodCampaign, foodCampaign);
  await foodCampaign.save();
  return { success: true };
};

const getFoodCampaign = async (campaignId, uid) => {
  const campaign = await FoodCampaign.findById(campaignId);
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
  const foodQuery = [
    {
      $match: {
        _id: {
          $in: campaign.foods,
        },
        restaurant: {
          $nin: hiddenRestaurantsId,
        },
        status: 'live',
        inStock: true,
      },
    },
    { $sort: { rating: -1 } },
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
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true, inStock: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              inStock: 1,
              stockType: 1,
              stockNumber: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $lookup: {
        from: 'foodtaxations',
        localField: 'foodTax',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              taxName: 1,
              taxAmount: {
                $round: [{ $divide: ['$taxAmount', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'foodtaxations',
      },
    },
    {
      $lookup: {
        from: 'foodorderreviews',
        localField: '_id',
        foreignField: 'food',
        as: 'foodorderreviews',
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'food',
        as: 'favourites',
        pipeline: [{ $match: { user: new mongoose.Types.ObjectId(userId) } }],
      },
    },
    {
      $addFields: {
        isFavourite: {
          $cond: {
            if: { $eq: [{ $size: '$favourites' }, 0] },
            then: false,
            else: true,
          },
        },
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
        shortDescription: 1,
        image: 1,
        restaurant: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        recommended: 1,
        rating: 1,
        totalRating: {
          $size: '$foodorderreviews',
        },
        status: 1,
        inStock: 1,
        addons: 1,
        foodtaxations: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        isFavourite: 1,
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
      },
    },
  ];
  const list = await Food.aggregate(foodQuery);
  return { detail: campaign, inCampaign: list };
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
        foods: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
      },
    },
  ];
  const detailInfo = await FoodCampaign.aggregate(detailQuery);
  if (!detailInfo[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = detailInfo[0];
  const savedFoods = detail.foods;
  let foodIds = lodash.uniq(savedFoods);
  foodIds = foodIds.map((item) => new mongoose.Types.ObjectId(item));
  const foodQuery = [
    {
      $match: {
        _id: {
          $in: foodIds,
        },
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
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categories',
      },
    },
    {
      $lookup: {
        from: 'subcategories',
        localField: 'subCategory',
        foreignField: '_id',
        as: 'subcategories',
      },
    },
    {
      $lookup: {
        from: 'vendorcategories',
        localField: 'customCategory',
        foreignField: '_id',
        as: 'vendorcategories',
      },
    },
    {
      $lookup: {
        from: 'vendorsubcategories',
        localField: 'customSubCategory',
        foreignField: '_id',
        as: 'vendorsubcategories',
      },
    },
    {
      $lookup: {
        from: 'foodorderreviews',
        localField: '_id',
        foreignField: 'food',
        as: 'foodorderreviews',
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
        path: '$categories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$subcategories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$vendorcategories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$vendorsubcategories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        ownCategory: 1,
        image: 1,
        translations: 1,
        status: 1,
        inStock: 1,
        rating: 1,
        totalRating: {
          $size: '$foodorderreviews',
        },
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        category: {
          id: { $ifNull: ['$categories._id', ''] },
          name: { $ifNull: ['$categories.name', ''] },
          translations: { $ifNull: ['$categories.translations', []] },
        },
        subCategory: {
          id: { $ifNull: ['$subcategories._id', ''] },
          name: { $ifNull: ['$subcategories.name', ''] },
          translations: { $ifNull: ['$subcategories.translations', []] },
        },
        customCategory: {
          id: { $ifNull: ['$vendorcategories._id', ''] },
          name: { $ifNull: ['$vendorcategories.name', ''] },
          translations: { $ifNull: ['$vendorcategories.translations', []] },
        },
        customSubCategory: {
          id: { $ifNull: ['$vendorsubcategories._id', ''] },
          name: { $ifNull: ['$vendorsubcategories.name', ''] },
          translations: { $ifNull: ['$vendorsubcategories.translations', []] },
        },
      },
    },
  ];
  const foods = await Food.aggregate(foodQuery);
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    foodCampaign: new mongoose.Types.ObjectId(id),
  };
  const orderQuery = [
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
  const orders = await Orders.aggregate(orderQuery);
  const totalResults = await Orders.countDocuments(queryCondition);
  return Promise.all([detailInfo, foods, orders, totalResults]).then(() => {
    const result = {
      detail,
      foods,
      orders,
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
      $lookup: {
        from: 'foodcampaignrequests',
        localField: '_id',
        foreignField: 'campaign',
        as: 'foodcampaignrequests',
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
        foodCount: { $size: '$foods' },
        startDate: 1,
        startTime: 1,
        status: 1,
        title: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        request: {
          $size: '$foodcampaignrequests',
        },
        shortDescription: 1,
        image: 1,
      },
    },
  ];
  const results = await FoodCampaign.aggregate(query);
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
  const results = await FoodCampaign.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const cityId =
        param && param.city && param.city !== null && param.city !== '' ? param.city : null;
      const foods = param && param.foods !== null && param.foods !== '' ? param.foods : null;
      if (cityId !== null && foods !== null) {
        const campaignData = new FoodCampaign({
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
          foods: param.foods.split(','),
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
        await FoodCampaign.create(campaignData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  createCampaign,
  getAllCampaign,
  getCampaignId,
  updateCampaignById,
  deleteCampaignById,
  updateStatus,
  getById,
  leaveCampaign,
  getAllCampaignAdmin,
  joinCampaign,
  getFoodCampaign,
  campaignDetail,
  cityzenCampaignList,
  cityzenCreateCampaign,
  exportCollection,
  exportRawCollection,
  importCollection,
};

