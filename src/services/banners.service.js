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
const { Banner, User } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createBanner = async (param) => {
  const bannerData = new Banner({
    title: param.title,
    type: param.type,
    city: param.city,
    image: param.image,
    restaurant:
      param && param.restaurant !== '' && param.restaurant !== null ? param.restaurant : null,
    food: param && param.food !== '' && param.food !== null ? param.food : null,
    external: param && param.external !== '' && param.external !== null ? param.external : null,
    translations: param.translations,
  });
  await Banner.create(bannerData);
  return { success: true };
};

const cityzenCreateBanner = async (masterId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const bannerData = new Banner({
    title: param.title,
    type: param.type,
    city: `${city}`,
    image: param.image,
    restaurant:
      param && param.restaurant !== '' && param.restaurant !== null ? param.restaurant : null,
    food: param && param.food !== '' && param.food !== null ? param.food : null,
    external: param && param.external !== '' && param.external !== null ? param.external : null,
    foodType: param.foodType,
    translations: param.translations,
  });
  await Banner.create(bannerData);
  return { success: true };
};

const getAllBanner = async (options) => {
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
                value: { $regex: searchRegExp },
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
        type: 1,
        restaurant: 1,
        food: 1,
        external: 1,
        image: 1,
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
  const results = await Banner.aggregate(query);
  const countResult = await Banner.aggregate([
    {
      $match: {
        $or: [
          { title: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
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

const cityzenBannerList = async (masterId, options) => {
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
                value: { $regex: searchRegExp },
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
        type: 1,
        restaurant: 1,
        food: 1,
        external: 1,
        image: 1,
        status: 1,
        translations: 1,
      },
    },
  ];
  const results = await Banner.aggregate(query);
  const countResult = await Banner.aggregate([
    {
      $match: {
        $or: [
          { title: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
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

const getBannerId = async (id) => {
  return Banner.findById(id);
};

const updateBannerById = async (bannerId, param) => {
  const banner = await getBannerId(bannerId);
  if (!banner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const bannerData = {
    title: param.title,
    type: param.type,
    city: param.city,
    image: param.image,
    restaurant:
      param && param.restaurant !== '' && param.restaurant !== null ? param.restaurant : null,
    food: param && param.food !== '' && param.food !== null ? param.food : null,
    external: param && param.external !== '' && param.external !== null ? param.external : null,
    foodType: param.foodType,
    translations: param.translations,
  };

  Object.assign(banner, bannerData);
  await banner.save();
  return { success: true };
};

const cityzenUpdate = async (masterId, bannerId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const banner = await getBannerId(bannerId);
  if (!banner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const bannerData = {
    title: param.title,
    type: param.type,
    city: `${city}`,
    image: param.image,
    restaurant:
      param && param.restaurant !== '' && param.restaurant !== null ? param.restaurant : null,
    food: param && param.food !== '' && param.food !== null ? param.food : null,
    external: param && param.external !== '' && param.external !== null ? param.external : null,
    foodType: param.foodType,
    translations: param.translations,
  };

  Object.assign(banner, bannerData);
  await banner.save();
  return { success: true };
};

const updateBannerStatus = async (bannerId, param) => {
  const banner = await getBannerId(bannerId);
  if (!banner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: param.status,
  };
  Object.assign(banner, updateBody);
  await banner.save();
  return { success: true };
};

const deleteBannerById = async (bannerId) => {
  const banner = await getBannerId(bannerId);
  if (!banner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await banner.deleteOne();
  return { success: true };
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
                value: { $regex: searchRegExp },
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
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
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
        type: 1,
        external: 1,
        image: 1,
        status: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        foods: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
        },
      },
    },
  ];
  const results = await Banner.aggregate(query);
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
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await Banner.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const bannerData = new Banner({
        title:
          param && param.title && param.title !== null && param.title !== '' ? param.title : 'NA',
        type:
          param && param.type && param.type !== null && param.type !== ''
            ? param.type
            : 'restaurant',
        city: param && param.city && param.city !== null && param.city !== '' ? param.city : null,
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        restaurant:
          param &&
          param.restaurant &&
          param.restaurant !== null &&
          param.restaurant !== '' &&
          param.restaurant !== '-'
            ? param.restaurant
            : null,
        food:
          param && param.food && param.food !== null && param.food !== '' && param.food !== '-'
            ? param.food
            : null,
        external:
          param &&
          param.external &&
          param.external !== null &&
          param.external !== '' &&
          param.external !== '-'
            ? param.external
            : '',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await Banner.create(bannerData);
    });
  }
  return { success: true };
};

module.exports = {
  createBanner,
  getAllBanner,
  updateBannerById,
  updateBannerStatus,
  deleteBannerById,
  cityzenBannerList,
  cityzenCreateBanner,
  cityzenUpdate,
  exportCollection,
  exportRawCollection,
  importCollection,
};
