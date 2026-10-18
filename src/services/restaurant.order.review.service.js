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
const { RestaurantOrderReview, Restaurant } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveRestaurantReview = async (param) => {
  const review = new RestaurantOrderReview({
    user: param.user,
    orders: param.orders,
    restaurant: param.restaurant,
    ratingCount: param.ratingCount,
    messages: param.messages,
    images: param.images,
    shortReview: param.shortReview,
  });
  await RestaurantOrderReview.create(review);
  const reviews = await RestaurantOrderReview.find({ restaurant: param.restaurant });
  const totalRatings = reviews.reduce((sum, reviewItem) => sum + reviewItem.ratingCount, 0);
  const averageRating = totalRatings / reviews.length;
  await Restaurant.findByIdAndUpdate(param.restaurant, {
    rating: averageRating.toFixed(2),
  });
};

const savePublicRestaurantReview = async (param) => {
  const review = new RestaurantOrderReview({
    user: param.user,
    orders: null,
    restaurant: param.restaurant,
    ratingCount: param.restaurantRate,
    messages:
      param &&
      param.restaurantMessage &&
      param.restaurantMessage !== null &&
      param.restaurantMessage !== ''
        ? param.restaurantMessage.split(',')
        : [],
    images:
      param && param.images && param.images !== null && param.images !== ''
        ? param.images.split(',')
        : [],
    shortReview: param.shortReview,
  });
  await RestaurantOrderReview.create(review);
  const reviews = await RestaurantOrderReview.find({ restaurant: param.restaurant });
  const totalRatings = reviews.reduce((sum, reviewItem) => sum + reviewItem.ratingCount, 0);
  const averageRating = totalRatings / reviews.length;
  await Restaurant.findByIdAndUpdate(param.restaurant, {
    rating: averageRating.toFixed(2),
  });
  return { success: true };
};

const getRestaurantReview = async (id, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const findQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(id) } },
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
        orders: 1,
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
  const reviews = await RestaurantOrderReview.aggregate(findQuery);
  const totalResults = await RestaurantOrderReview.countDocuments({
    restaurant: new mongoose.Types.ObjectId(id),
  });
  const starCounts = await RestaurantOrderReview.aggregate([
    { $match: { restaurant: new mongoose.Types.ObjectId(id) } },
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
  const restaurantReview = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { rating: 1 }
  );
  if (checkArrayNotEmpty(reviews)) {
    return Promise.all([reviews, totalResults, starCounts, restaurantReview]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        reviews,
        percentages,
        page,
        limit,
        totalPages,
        totalResults,
        restaurantReview,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getMyRestaurantReview = async (userId) => {
  const findQuery = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
      },
    },
    { $sort: { createdAt: -1 } },
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
        path: '$restaurants',
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
      },
    },
  ];
  const reviews = await RestaurantOrderReview.aggregate(findQuery);
  return reviews;
};

module.exports = {
  saveRestaurantReview,
  getRestaurantReview,
  savePublicRestaurantReview,
  getMyRestaurantReview,
};

