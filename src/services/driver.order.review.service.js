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

const { DriverOrderReview, Driver } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveDriverReview = async (param) => {
  const review = new DriverOrderReview({
    user: param.user,
    orders: param.orders,
    driver: param.driver,
    ratingCount: param.ratingCount,
    messages: param.messages,
    images: param.images,
    shortReview: param.shortReview,
  });
  await DriverOrderReview.create(review);
  const reviews = await DriverOrderReview.find({ driver: param.driver });
  const totalRatings = reviews.reduce((sum, reviewItem) => sum + reviewItem.ratingCount, 0);
  const averageRating = totalRatings / reviews.length;
  const driverInfo = await Driver.findOne({ userId: param.driver });
  if (driverInfo && driverInfo !== null) {
    Object.assign(driverInfo, { rating: averageRating.toFixed(2) });
    await driverInfo.save();
  }
};

const getMyDriverReview = async (userId) => {
  const findQuery = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
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
      },
    },
  ];
  const reviews = await DriverOrderReview.aggregate(findQuery);
  return reviews;
};

const getMyReview = async (driverId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const findQuery = [
    {
      $match: {
        driver: new mongoose.Types.ObjectId(driverId),
      },
    },
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
  const reviews = await DriverOrderReview.aggregate(findQuery);
  const totalResults = await DriverOrderReview.countDocuments({
    driver: new mongoose.Types.ObjectId(driverId),
  });
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
  const ratings = await Driver.findOne(
    { userId: new mongoose.Types.ObjectId(driverId) },
    { rating: 1 }
  );
  return Promise.all([reviews, totalResults, starCounts, ratings]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      reviews,
      percentages,
      totalPages,
      totalResults,
      ratings,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  saveDriverReview,
  getMyDriverReview,
  getMyReview,
};

