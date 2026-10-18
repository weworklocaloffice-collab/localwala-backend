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
const { DiningCampaignRequest } = require('../models');

const requestCampaign = async (param) => {
  if (
    await DiningCampaignRequest.findOne({ restaurant: param.restaurant, campaign: param.campaign })
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already requested');
  }
  await DiningCampaignRequest.create(param);
  return { success: true };
};

const getList = async (campaignId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    { $skip: skip },
    { $limit: Number(limit) },
    { $sort: { createdAt: -1 } },
    {
      $match: {
        campaign: new mongoose.Types.ObjectId(campaignId),
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
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        campaign: 1,
        restaurant: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await DiningCampaignRequest.aggregate(query);
  const totalResults = await DiningCampaignRequest.countDocuments({ campaign: campaignId });
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
  return DiningCampaignRequest.findById(id);
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
  deleteRequestById,
};

