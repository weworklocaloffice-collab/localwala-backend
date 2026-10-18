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
const ApiError = require('../utils/ApiError');
const { FoodCampaignRequest } = require('../models');

const requestCampaign = async (param) => {
  if (
    await FoodCampaignRequest.findOne({
      restaurant: param.restaurant,
      campaign: param.campaign,
      food: param.food,
    })
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already requested');
  }
  await FoodCampaignRequest.create(param);
  return { sucess: true };
};

const getList = async (campaignId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    {
      $match: {
        campaign: new mongoose.Types.ObjectId(campaignId),
      },
    },
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
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
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
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        campaign: 1,
        food: 1,
        restaurant: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        foods: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          shortDescription: { $ifNull: ['$foods.shortDescription', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          discountType: { $ifNull: ['$foods.discountType', ''] },
          price: { $ifNull: [{ $round: [{ $divide: ['$foods.price', 100] }, 2] }, ''] },
          discount: { $ifNull: [{ $round: [{ $divide: ['$foods.discount', 100] }, 2] }, ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
      },
    },
  ];
  const results = await FoodCampaignRequest.aggregate(query);
  const totalResults = await FoodCampaignRequest.countDocuments({ campaign: campaignId });
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

const getRequestById = async (id) => {
  return FoodCampaignRequest.findById(id);
};

const deleteRequestById = async (campaignId) => {
  const request = await getRequestById(campaignId);
  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await request.deleteOne();
  return { success: true };
};

module.exports = {
  requestCampaign,
  getList,
  getRequestById,
  deleteRequestById,
};

