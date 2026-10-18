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

const { FoodOrderReview, Food, DriverOrderReview, RestaurantOrderReview } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveFoodReview = async (param) => {
  const review = new FoodOrderReview({
    user: param.user,
    orders: param.orders,
    food: param.food,
    ratingCount: param.ratingCount,
    messages: param.messages,
    images: param.images,
    shortReview: param.shortReview,
  });
  await FoodOrderReview.create(review);
  const reviews = await FoodOrderReview.find({ food: param.food });
  const totalRatings = reviews.reduce((sum, reviewItem) => sum + reviewItem.ratingCount, 0);
  const averageRating = totalRatings / reviews.length;
  await Food.findByIdAndUpdate(param.food, {
    rating: averageRating.toFixed(2),
  });
};

const getFoodReview = async (id, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const findQuery = [
    { $match: { food: new mongoose.Types.ObjectId(id) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
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
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
      },
    },
  ];
  const reviews = await FoodOrderReview.aggregate(findQuery);
  const totalResults = await FoodOrderReview.countDocuments({
    food: new mongoose.Types.ObjectId(id),
  });
  const starCounts = await FoodOrderReview.aggregate([
    { $match: { food: new mongoose.Types.ObjectId(id) } },
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
  if (checkArrayNotEmpty(reviews)) {
    return Promise.all([reviews, totalResults, percentages]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        reviews,
        percentages,
        page,
        limit,
        totalPages,
        totalResults,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getMyFoodReview = async (userId) => {
  const findQuery = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $unwind: {
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        foods: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
      },
    },
  ];
  const reviews = await FoodOrderReview.aggregate(findQuery);
  return reviews;
};

const customerAllReviews = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const queryFood = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
      },
    },
    {
      $unwind: {
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        foods: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const queryDeliveryman = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
      },
    },
    {
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          image: { $ifNull: ['$drivers.image', ''] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const queryRestaurant = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        orders: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];

  const foodReviews = await FoodOrderReview.aggregate(queryFood);
  const totalResultsFood = await FoodOrderReview.countDocuments(queryCondition);

  const deliverymanReviews = await DriverOrderReview.aggregate(queryDeliveryman);
  const totalResultsDeliveryman = await DriverOrderReview.countDocuments(queryCondition);

  const restaurantReviews = await RestaurantOrderReview.aggregate(queryRestaurant);
  const totalResultsRestaurant = await RestaurantOrderReview.countDocuments(queryCondition);

  return Promise.all([
    foodReviews,
    totalResultsFood,
    deliverymanReviews,
    totalResultsDeliveryman,
    restaurantReviews,
    totalResultsRestaurant,
  ]).then(() => {
    const food = {
      foodReviews,
      totalResultsFood,
    };
    const deliveryman = {
      deliverymanReviews,
      totalResultsDeliveryman,
    };
    const restaurant = {
      restaurantReviews,
      totalResultsRestaurant,
    };
    const result = {
      food,
      deliveryman,
      restaurant,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerRestaurantReview = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const queryRestaurant = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        orders: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const results = await RestaurantOrderReview.aggregate(queryRestaurant);
  const totalResults = await RestaurantOrderReview.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerFoodReview = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const queryFood = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
      },
    },
    {
      $unwind: {
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        foods: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const results = await FoodOrderReview.aggregate(queryFood);
  const totalResults = await FoodOrderReview.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerDeliverymanReview = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const queryDeliveryman = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
      },
    },
    {
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          image: { $ifNull: ['$drivers.image', ''] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const results = await DriverOrderReview.aggregate(queryDeliveryman);
  const totalResults = await DriverOrderReview.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorAllReviews = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryRestaurant = [
    { $match: { restaurant: new mongoose.Types.ObjectId(options.restaurant) } },
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
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const queryFood = [
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
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
      },
    },
    {
      $unwind: {
        path: '$foods',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'foods.restaurant': new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        foods: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const countQueryFood = [
    {
      $lookup: {
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $unwind: {
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'foods.restaurant': new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    { $count: 'totalCount' },
  ];

  const restaurantReviews = await RestaurantOrderReview.aggregate(queryRestaurant);
  const totalResultsRestaurant = await RestaurantOrderReview.countDocuments({
    restaurant: new mongoose.Types.ObjectId(options.restaurant),
  });

  const foodReviews = await FoodOrderReview.aggregate(queryFood);
  const foodResultCount = await FoodOrderReview.aggregate(countQueryFood);
  const totalResultsFood = checkArrayNotEmpty(foodResultCount) ? foodResultCount[0].totalCount : 0;

  return Promise.all([
    restaurantReviews,
    totalResultsRestaurant,
    foodReviews,
    foodResultCount,
  ]).then(() => {
    const restaurant = {
      restaurantReviews,
      totalResultsRestaurant,
    };
    const food = {
      foodReviews,
      totalResultsFood,
    };
    const result = {
      restaurant,
      food,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorReviews = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryRestaurant = [
    { $match: { restaurant: new mongoose.Types.ObjectId(options.restaurant) } },
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
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const results = await RestaurantOrderReview.aggregate(queryRestaurant);
  const totalResults = await RestaurantOrderReview.countDocuments({
    restaurant: new mongoose.Types.ObjectId(options.restaurant),
  });
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorFoodReviews = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryFood = [
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
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
      },
    },
    {
      $unwind: {
        path: '$foods',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'foods.restaurant': new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        foods: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
      },
    },
  ];
  const countQueryFood = [
    {
      $lookup: {
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $unwind: {
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'foods.restaurant': new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    { $count: 'totalCount' },
  ];
  const results = await FoodOrderReview.aggregate(queryFood);
  const foodResultCount = await FoodOrderReview.aggregate(countQueryFood);
  const totalResults = checkArrayNotEmpty(foodResultCount) ? foodResultCount[0].totalCount : 0;

  return Promise.all([results, foodResultCount]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanReviews = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { driver: new mongoose.Types.ObjectId(options.deliveryman) };
  const queryDeliveryman = [
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
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
      },
    },
    {
      $unwind: {
        path: '$ordersDetail',
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
      $lookup: {
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
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
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const results = await DriverOrderReview.aggregate(queryDeliveryman);
  const totalResults = await DriverOrderReview.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  saveFoodReview,
  getFoodReview,
  getMyFoodReview,
  customerAllReviews,
  customerRestaurantReview,
  customerFoodReview,
  customerDeliverymanReview,
  vendorAllReviews,
  vendorReviews,
  vendorFoodReviews,
  deliverymanReviews,
};

