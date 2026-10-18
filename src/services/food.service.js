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
const { Food, Restaurant, FoodOrderReview, User, KitchenOwner } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const restaurantCategoryHelper = async (restaurantId, categoryId) => {
  const info = await Restaurant.findById(restaurantId, { category: 1 });
  if (info && info !== null && info.category !== null) {
    info.category = info.category.filter((x) => x !== '');
    const exist = info.category.includes(categoryId);
    if (exist === false) {
      info.category.push(new mongoose.Types.ObjectId(categoryId));
      const dataInfo = {
        category: info.category,
      };
      Object.assign(info, dataInfo);
      await info.save();
    }
  }
};

const createFood = async (param) => {
  const restaurantInfo = await Restaurant.findById(param.restaurant, { productLimit: 1 });
  if (!restaurantInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const productLimit =
    parseInt(restaurantInfo.productLimit, 10) !== -1
      ? parseInt(restaurantInfo.productLimit, 10)
      : Number.MAX_SAFE_INTEGER;
  const totalFoodCount = await Food.countDocuments({
    restaurant: new mongoose.Types.ObjectId(param.restaurant),
  });
  if (totalFoodCount >= productLimit) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Limit Crossed');
  }
  const foodData = new Food({
    name: param.name,
    shortDescription: param.shortDescription,
    image: param.image,
    restaurant: param && param.restaurant !== '' ? param.restaurant : null,
    ownCategory: param.ownCategory,
    category: param && param.category !== '' ? param.category : null,
    subCategory: param && param.subCategory !== '' ? param.subCategory : null,
    customCategory: param && param.customCategory !== '' ? param.customCategory : null,
    customSubCategory: param && param.customSubCategory !== '' ? param.customSubCategory : null,
    foodType: param.foodType,
    addons: param && param.addons && param.addons.length > 0 ? param.addons : [],
    startTime: param.startTime,
    endTime: param.endTime,
    price: param.price,
    discountType: param.discountType,
    discount: param.discount,
    purchaseLimit: param.purchaseLimit,
    variations: param.variations,
    tags: param.tags,
    translations: param.translations,
    status: param && param.status !== '' && param.status !== null ? param.status : 'live',
    inStock: param && param.inStock !== '' && param.inStock !== null ? param.inStock : true,
    taxationEnable:
      param && param.taxationEnable !== '' && param.taxationEnable !== null
        ? param.taxationEnable
        : false,
    foodTax: param && param.foodTax && param.foodTax.length > 0 ? param.foodTax : [],
    stockNumber:
      param && param.stockNumber !== '' && param.stockNumber !== null ? param.stockNumber : -1,
    stockType:
      param && param.stockType !== '' && param.stockType !== null ? param.stockType : 'unlimited',
    orderSoldCount: 0,
    totalSoldAmount: 0,
    discountAmountGiven: 0,
  });
  if (param && param.category !== '' && param.category !== null) {
    restaurantCategoryHelper(param.restaurant, param.category);
  }
  await Food.create(foodData);
  return { success: true };
};

const getAllFood = async (restaurantId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        discountType: 1,
        recommended: 1,
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
  const results = await Food.aggregate(query);
  const totalResults = await Food.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurantId),
  });
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

const getAllFoodList = async () => {
  const food = await Food.find({});
  return food;
};

const getFoodByRestaurantId = async (id) => {
  const food = await Food.find(
    { restaurant: id, status: 'live' },
    {
      id: 1,
      name: 1,
      image: 1,
      addons: 1,
      variations: 1,
      price: 1,
      discountType: 1,
      discount: 1,
      restaurant: 1,
      translations: 1,
      status: 1,
    }
  );
  return food;
};

const getFoodId = async (id) => {
  return Food.findById(id);
};

const getFoodIdVendorApp = async (foodId, restaurant) => {
  const foodQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(foodId),
        restaurant: new mongoose.Types.ObjectId(restaurant),
      },
    },
    { $limit: 1 },
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
        from: 'addons',
        localField: 'addons',
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
        shortDescription: 1,
        image: 1,
        restaurant: 1,
        ownCategory: 1,
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
        addons: 1,
        foodtaxations: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        variations: 1,
        tags: 1,
        translations: 1,
        purchaseLimit: 1,
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
      },
    },
  ];
  const info = await Food.aggregate(foodQuery);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return info[0];
};

const updateFoodById = async (foodId, param) => {
  const food = await getFoodId(foodId);
  if (!food) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const foodData = {
    name: param.name,
    shortDescription: param.shortDescription,
    image: param.image,
    restaurant: param && param.restaurant !== '' ? param.restaurant : null,
    ownCategory: param.ownCategory,
    category: param && param.category !== '' ? param.category : null,
    subCategory: param && param.subCategory !== '' ? param.subCategory : null,
    customCategory: param && param.customCategory !== '' ? param.customCategory : null,
    customSubCategory: param && param.customSubCategory !== '' ? param.customSubCategory : null,
    foodType: param.foodType,
    addons: param && param.addons && param.addons.length > 0 ? param.addons : [],
    startTime: param.startTime,
    endTime: param.endTime,
    price: param.price,
    discountType: param.discountType,
    discount: param.discount,
    purchaseLimit: param.purchaseLimit,
    variations: param.variations,
    tags: param.tags,
    translations: param.translations,
    taxationEnable:
      param && param.taxationEnable !== '' && param.taxationEnable !== null
        ? param.taxationEnable
        : false,
    foodTax: param && param.foodTax && param.foodTax.length > 0 ? param.foodTax : [],
    stockNumber:
      param && param.stockNumber !== '' && param.stockNumber !== null ? param.stockNumber : -1,
    stockType:
      param && param.stockType !== '' && param.stockType !== null ? param.stockType : 'unlimited',
  };
  if (param && param.category !== '' && param.category !== null) {
    restaurantCategoryHelper(param.restaurant, param.category);
  }
  Object.assign(food, foodData);
  await food.save();
  return { success: true };
};

const kitchenOwnerUpdateFood = async (foodId, ownerId, param) => {
  const ownerDetail = await KitchenOwner.findOne({ userId: new mongoose.Types.ObjectId(ownerId) });
  if (!ownerDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const food = await Food.findOne({
    _id: new mongoose.Types.ObjectId(foodId),
    restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant),
  });
  if (!food) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const foodData = {
    addons: param && param.addons && param.addons.length > 0 ? param.addons : [],
    variations: param.variations,
    stockNumber:
      param && param.stockNumber !== '' && param.stockNumber !== null ? param.stockNumber : -1,
    stockType:
      param && param.stockType !== '' && param.stockType !== null ? param.stockType : 'unlimited',
  };
  Object.assign(food, foodData);
  await food.save();
  return { success: true };
};

const deleteFoodById = async (foodId) => {
  const food = await getFoodId(foodId);
  if (!food) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await food.deleteOne();
  return food;
};

const updateMetaInfo = async (foodId, updateBody) => {
  const food = await getFoodId(foodId);
  if (!food) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(food, updateBody);
  await food.save();
  return { success: true };
};

const adminFoodList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [
      { name: searchRegExp },
      {
        translations: {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
  };
  const query = [
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
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const results = await Food.aggregate(query);
  const countResult = await Food.aggregate([
    {
      $match: matchQuery,
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

const cityzenFoodList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [
      { name: searchRegExp },
      {
        translations: {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [{ 'restaurants.city': new mongoose.Types.ObjectId(city) }],
  };
  const query = [
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const results = await Food.aggregate(query);
  const countResult = await Food.aggregate([
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
      $match: matchQuery,
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

const getFoodByCity = async (cityId) => {
  const restaurants = await Restaurant.find({ city: cityId }, { id: 1 });
  const restaurantIds = restaurants.map((x) => new mongoose.Types.ObjectId(x.id));
  const query = [
    {
      $match: {
        restaurant: {
          $in: restaurantIds,
        },
        status: 'live',
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
        name: 1,
        translations: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await Food.aggregate(query);
  return results;
};

const cityzenFoodListForBanner = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const restaurants = await Restaurant.find({ city: new mongoose.Types.ObjectId(city) }, { id: 1 });
  const restaurantIds = restaurants.map((x) => new mongoose.Types.ObjectId(x.id));
  const query = [
    {
      $match: {
        restaurant: {
          $in: restaurantIds,
        },
        status: 'live',
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
        name: 1,
        translations: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await Food.aggregate(query);
  return results;
};

const getMyFoodApp = async (restaurantId) => {
  const queryMainCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
        ownCategory: false,
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
      $unwind: {
        path: '$categories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: '$categories._id',
        categories: {
          $first: '$categories',
        },
        foods: {
          $push: {
            id: '$_id',
            name: '$name',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            inStock: '$inStock',
            foodType: '$foodType',
            shortDescription: '$shortDescription',
            recommended: '$recommended',
            image: '$image',
            status: '$status',
            food_translations: '$translations',
          },
        },
      },
    },
    {
      $sort: {
        'categories.name': 1,
      },
    },
    {
      $project: {
        _id: 0,
        category_id: '$categories._id',
        category_name: '$categories.name',
        category_translations: '$categories.translations',
        foods: 1,
      },
    },
  ];
  const queryCustomCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
        ownCategory: true,
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
      $unwind: {
        path: '$vendorcategories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: '$vendorcategories._id',
        vendorcategories: {
          $first: '$vendorcategories',
        },
        foods: {
          $push: {
            id: '$_id',
            name: '$name',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            inStock: '$inStock',
            foodType: '$foodType',
            shortDescription: '$shortDescription',
            recommended: '$recommended',
            image: '$image',
            status: '$status',
            food_translations: '$translations',
          },
        },
      },
    },
    {
      $sort: {
        'vendorcategories.name': 1,
      },
    },
    {
      $project: {
        _id: 0,
        category_id: '$vendorcategories._id',
        category_name: '$vendorcategories.name',
        category_translations: '$vendorcategories.translations',
        foods: 1,
      },
    },
  ];
  const custom = await Food.aggregate(queryCustomCategories);
  const main = await Food.aggregate(queryMainCategories);
  const all = await Food.countDocuments({ restaurant: restaurantId });
  const hold = await Food.countDocuments({ restaurant: restaurantId, status: 'hold' });
  const photoreject = await Food.countDocuments({
    restaurant: restaurantId,
    status: 'photoreject',
  });
  const qualityreject = await Food.countDocuments({
    restaurant: restaurantId,
    status: 'qualityreject',
  });
  const sizereject = await Food.countDocuments({
    restaurant: restaurantId,
    status: 'sizereject',
  });
  const reject = await Food.countDocuments({ restaurant: restaurantId, status: 'reject' });
  const hide = await Food.countDocuments({ restaurant: restaurantId, status: 'hide' });

  return Promise.all([
    custom,
    main,
    all,
    hold,
    photoreject,
    qualityreject,
    sizereject,
    reject,
    hide,
  ]).then(() => {
    const count = [
      {
        all,
        hold,
        photoreject,
        qualityreject,
        sizereject,
        reject,
        hide,
      },
    ];
    const result = {
      custom,
      main,
      count,
    };
    return Promise.resolve(result);
  });
};

const getRestaurantFoodFromWaiter = async (restaurantId) => {
  const queryMainCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
        ownCategory: false,
        status: 'live',
        inStock: true,
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
      $unwind: {
        path: '$categories',
        preserveNullAndEmptyArrays: true,
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
      $group: {
        _id: '$categories._id',
        categories: {
          $first: '$categories',
        },
        foods: {
          $push: {
            id: '$_id',
            name: '$name',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            discount: {
              $round: [{ $divide: ['$discount', 100] }, 2],
            },
            rating: '$rating',
            totalRating: {
              $size: '$foodorderreviews',
            },
            discountType: '$discountType',
            inStock: '$inStock',
            stockNumber: '$stockNumber',
            stockType: '$stockType',
            foodType: '$foodType',
            shortDescription: '$shortDescription',
            recommended: '$recommended',
            image: '$image',
            status: '$status',
            food_translations: '$translations',
            foodtaxations: '$foodtaxations',
          },
        },
      },
    },
    {
      $sort: {
        'categories.name': 1,
      },
    },
    {
      $project: {
        _id: 0,
        category_id: '$categories._id',
        category_name: '$categories.name',
        category_translations: '$categories.translations',
        foods: 1,
      },
    },
  ];
  const queryCustomCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
        ownCategory: true,
        status: 'live',
        inStock: true,
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
      $unwind: {
        path: '$vendorcategories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: '$vendorcategories._id',
        vendorcategories: {
          $first: '$vendorcategories',
        },
        foods: {
          $push: {
            id: '$_id',
            name: '$name',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            discount: {
              $round: [{ $divide: ['$discount', 100] }, 2],
            },
            rating: '$rating',
            totalRating: {
              $size: '$foodorderreviews',
            },
            discountType: '$discountType',
            stockNumber: '$stockNumber',
            stockType: '$stockType',
            inStock: '$inStock',
            foodType: '$foodType',
            shortDescription: '$shortDescription',
            recommended: '$recommended',
            image: '$image',
            status: '$status',
            food_translations: '$translations',
            foodtaxations: '$foodtaxations',
          },
        },
      },
    },
    {
      $sort: {
        'vendorcategories.name': 1,
      },
    },
    {
      $project: {
        _id: 0,
        category_id: '$vendorcategories._id',
        category_name: '$vendorcategories.name',
        category_translations: '$vendorcategories.translations',
        foods: 1,
      },
    },
  ];
  const custom = await Food.aggregate(queryCustomCategories);
  const main = await Food.aggregate(queryMainCategories);
  return Promise.all([custom, main]).then(() => {
    const result = {
      custom,
      main,
    };
    return Promise.resolve(result);
  });
};

const getSingleFoodInfo = async (foodId, uid) => {
  let userId;
  if (uid === null || uid === '' || uid === undefined) {
    userId = null;
  } else {
    userId = uid;
  }
  const foodInfoQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(foodId) } },
    { $limit: 1 },
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
  const foodInfo = await Food.aggregate(foodInfoQuery);
  if (!foodInfo[0]) {
    return { success: false };
  }
  return { info: foodInfo[0], success: true };
};

const getFoodListForSubscription = async (restaurantId) => {
  const foodQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(restaurantId), status: 'live' } },
    {
      $lookup: {
        from: 'addons',
        localField: 'addons',
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
        as: 'addons',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        addons: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        variations: 1,
        translations: 1,
      },
    },
  ];
  const foods = await Food.aggregate(foodQuery);
  return { foods };
};

const searchMenuFood = async (id, searchQuery) => {
  const searchRegExp = RegExp(searchQuery, 'i');
  const foodQuery = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ restaurant: new mongoose.Types.ObjectId(id) }],
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        foodType: 1,
        shortDescription: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        translations: 1,
      },
    },
  ];
  const vendorFoods = await Food.aggregate(foodQuery);
  return Promise.all([vendorFoods]).then(() => {
    const result = {
      foods: vendorFoods,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const updateFooodStockAfterOrder = async (foodArray) => {
  if (foodArray !== null && checkArrayNotEmpty(foodArray)) {
    const bulkUpdateItem = foodArray.map((item) => ({
      updateOne: {
        filter: { _id: item.id },
        update: { $set: item.updateSet },
      },
    }));
    await Food.bulkWrite(bulkUpdateItem);
  }
};

const updateFoodMetaAfterOrder = async (foodArray) => {
  if (foodArray !== null && checkArrayNotEmpty(foodArray)) {
    try {
      const bulkUpdateItem = foodArray.map((item) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(item.id) },
          update: {
            $inc: {
              orderSoldCount: item.qty,
              totalSoldAmount: parseFloat(item.totalSoldAmount),
              discountAmountGiven: parseFloat(item.discountAmountGiven),
            },
          },
        },
      }));
      await Food.bulkWrite(bulkUpdateItem);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
};

const foodReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? {
          foodType: { $in: [options.kind] },
          restaurant:
            options &&
            options.restaurant &&
            options.restaurant !== null &&
            options.restaurant !== ''
              ? new mongoose.Types.ObjectId(options.restaurant)
              : { $ne: null },
        }
      : { foodType: { $nin: ['all'] }, restaurant: { $ne: null } },
  };
  const name = options.search;
  if (name && name !== '' && name !== null) {
    matchQuery.$match = {
      $or: [{ name: RegExp(name, 'i') }],
    };
  }
  const query = [
    matchQuery,
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
        image: 1,
        foodType: 1,
        translations: 1,
        price: {
          $round: [
            {
              $divide: [{ $ifNull: ['$price', 0] }, 100],
            },
            2,
          ],
        },
        totalSoldAmount: {
          $round: [
            {
              $divide: [{ $ifNull: ['$totalSoldAmount', 0] }, 100],
            },
            2,
          ],
        },
        discountAmountGiven: {
          $round: [
            {
              $divide: [{ $ifNull: ['$discountAmountGiven', 0] }, 100],
            },
            2,
          ],
        },
        orderSoldCount: {
          $round: [
            {
              $divide: [{ $ifNull: ['$orderSoldCount', 0] }, 100],
            },
            2,
          ],
        },
        averageSell: {
          $round: [
            {
              $cond: {
                if: { $gt: ['$orderSoldCount', 0] },
                then: { $divide: ['$totalSoldAmount', '$orderSoldCount'] },
                else: 0,
              },
            },
            2,
          ],
        },
        rating: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await Food.aggregate(query);
  const resultCount = await Food.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
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

const vendorFoodList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const query = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const results = await Food.aggregate(query);
  const totalResults = await Food.countDocuments(queryCondition);
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

const adminFoodDetail = async (foodId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const foodQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(foodId) } },
    { $limit: 1 },
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
        ownCategory: 1,
        rating: 1,
        totalRating: {
          $size: '$foodorderreviews',
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
        addons: 1,
        foodtaxations: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        variations: 1,
        tags: 1,
        translations: 1,
        purchaseLimit: 1,
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
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
  const info = await Food.aggregate(foodQuery);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const detail = info[0];
  const starCounts = await FoodOrderReview.aggregate([
    { $match: { food: new mongoose.Types.ObjectId(foodId) } },
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
  const reviewQuery = [
    { $match: { food: new mongoose.Types.ObjectId(foodId) } },
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
  const reviews = await FoodOrderReview.aggregate(reviewQuery);
  const totalResults = await FoodOrderReview.countDocuments({
    food: new mongoose.Types.ObjectId(foodId),
  });
  return Promise.all([info, percentages, reviews, totalResults]).then(() => {
    const result = {
      detail,
      percentages,
      reviews,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const kitchenOwnerFoodList = async (ownerId) => {
  const ownerDetail = await KitchenOwner.findOne({ userId: new mongoose.Types.ObjectId(ownerId) });
  if (!ownerDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const queryMainCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant),
        ownCategory: false,
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
      $unwind: {
        path: '$categories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: '$categories._id',
        categories: {
          $first: '$categories',
        },
        foods: {
          $push: {
            id: '$_id',
            name: '$name',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            inStock: '$inStock',
            foodType: '$foodType',
            shortDescription: '$shortDescription',
            image: '$image',
            status: '$status',
            food_translations: '$translations',
          },
        },
      },
    },
    {
      $sort: {
        'categories.name': 1,
      },
    },
    {
      $project: {
        _id: 0,
        category_id: '$categories._id',
        category_name: '$categories.name',
        category_translations: '$categories.translations',
        foods: 1,
      },
    },
  ];
  const queryCustomCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant),
        ownCategory: true,
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
      $unwind: {
        path: '$vendorcategories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: '$vendorcategories._id',
        vendorcategories: {
          $first: '$vendorcategories',
        },
        foods: {
          $push: {
            id: '$_id',
            name: '$name',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            inStock: '$inStock',
            foodType: '$foodType',
            shortDescription: '$shortDescription',
            image: '$image',
            status: '$status',
            food_translations: '$translations',
          },
        },
      },
    },
    {
      $sort: {
        'vendorcategories.name': 1,
      },
    },
    {
      $project: {
        _id: 0,
        category_id: '$vendorcategories._id',
        category_name: '$vendorcategories.name',
        category_translations: '$vendorcategories.translations',
        foods: 1,
      },
    },
  ];
  const custom = await Food.aggregate(queryCustomCategories);
  const main = await Food.aggregate(queryMainCategories);
  return Promise.all([custom, main]).then(() => {
    const result = {
      custom,
      main,
    };
    return Promise.resolve(result);
  });
};

const kitchenOwnerFoodDetail = async (foodId, ownerId) => {
  const ownerDetail = await KitchenOwner.findOne({ userId: new mongoose.Types.ObjectId(ownerId) });
  if (!ownerDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const foodQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(foodId),
        restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant),
      },
    },
    {
      $lookup: {
        from: 'addons',
        localField: 'addons',
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
        as: 'addons',
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        startTime: 1,
        endTime: 1,
        variations: 1,
        purchaseLimit: 1,
        stockType: 1,
        stockNumber: 1,
        addons: 1,
      },
    },
  ];
  const info = await Food.aggregate(foodQuery);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return { detail: info[0], success: true };
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [
      { name: searchRegExp },
      {
        translations: {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
      { 'categories.name': searchRegExp },
      { 'categories.slug': searchRegExp },
      {
        'categories.translations': {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'subcategories.name': searchRegExp },
      { 'subcategories.slug': searchRegExp },
      {
        'subcategories.translations': {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'vendorcategories.name': searchRegExp },
      {
        'vendorcategories.translations': {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'vendorsubcategories.name': searchRegExp },
      {
        'vendorsubcategories.translations': {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
  };
  const query = [
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
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        status: 1,
        inStock: 1,
        rating: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        purchaseLimit: 1,
        recommended: 1,
        stockType: 1,
        stockNumber: 1,
        taxationEnable: 1,
        totalRating: {
          $size: '$foodorderreviews',
        },
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        orderSoldCount: {
          $round: [{ $divide: ['$orderSoldCount', 100] }, 2],
        },
        totalSoldAmount: {
          $round: [{ $divide: ['$totalSoldAmount', 100] }, 2],
        },
        discountAmountGiven: {
          $round: [{ $divide: ['$discountAmountGiven', 100] }, 2],
        },
        restaurants: {
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        category: {
          name: { $ifNull: ['$categories.name', ''] },
        },
        subCategory: {
          name: { $ifNull: ['$subcategories.name', ''] },
        },
        customCategory: {
          name: { $ifNull: ['$vendorcategories.name', ''] },
        },
        customSubCategory: {
          name: { $ifNull: ['$vendorsubcategories.name', ''] },
        },
      },
    },
  ];
  const results = await Food.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [
      { name: searchRegExp },
      {
        translations: {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
      { 'categories.name': searchRegExp },
      { 'categories.slug': searchRegExp },
      {
        'categories.translations': {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'subcategories.name': searchRegExp },
      { 'subcategories.slug': searchRegExp },
      {
        'subcategories.translations': {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'vendorcategories.name': searchRegExp },
      {
        'vendorcategories.translations': {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'vendorsubcategories.name': searchRegExp },
      {
        'vendorsubcategories.translations': {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
  };
  const results = await Food.aggregate([
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
      $match: matchQuery,
    },
    {
      $project: {
        restaurants: 0,
        categories: 0,
        subcategories: 0,
        vendorcategories: 0,
        vendorsubcategories: 0,
      },
    },
  ]);
  return results;
};

const exportReportCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? {
          foodType: { $in: [options.kind] },
          restaurant:
            options &&
            options.restaurant &&
            options.restaurant !== null &&
            options.restaurant !== ''
              ? new mongoose.Types.ObjectId(options.restaurant)
              : { $ne: null },
        }
      : { foodType: { $nin: ['all'] }, restaurant: { $ne: null } },
  };
  const name = options.search;
  if (name && name !== '' && name !== null) {
    matchQuery.$match = {
      $or: [{ name: RegExp(name, 'i') }],
    };
  }
  const query = [
    matchQuery,
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        foodType: 1,
        createdAt: 1,
        price: {
          $round: [
            {
              $divide: [{ $ifNull: ['$price', 0] }, 100],
            },
            2,
          ],
        },
        totalSoldAmount: {
          $round: [
            {
              $divide: [{ $ifNull: ['$totalSoldAmount', 0] }, 100],
            },
            2,
          ],
        },
        discountAmountGiven: {
          $round: [
            {
              $divide: [{ $ifNull: ['$discountAmountGiven', 0] }, 100],
            },
            2,
          ],
        },
        orderSoldCount: {
          $round: [
            {
              $divide: [{ $ifNull: ['$orderSoldCount', 0] }, 100],
            },
            2,
          ],
        },
        averageSell: {
          $round: [
            {
              $cond: {
                if: { $gt: ['$orderSoldCount', 0] },
                then: { $divide: ['$totalSoldAmount', '$orderSoldCount'] },
                else: 0,
              },
            },
            2,
          ],
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
      },
    },
  ];
  const result = await Food.aggregate(query);
  return result;
};

function safeParse(str) {
  try {
    return JSON.parse(str);
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    return null;
  }
}

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    const foodTypeArray = ['none', 'veg', 'nonveg', 'vegans'];
    const stockTypeArray = ['unlimited', 'limited', 'daily'];
    const statusArray = [
      'hold',
      'live',
      'photoreject',
      'qualityreject',
      'sizereject',
      'reject',
      'hide',
    ];

    importArray.forEach(async (param) => {
      const restaurantId =
        param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
          ? param.restaurant
          : null;
      const variationsArray =
        param &&
        param.variations &&
        param.variations !== null &&
        param.variations !== '' &&
        param.variations !== '-'
          ? safeParse(param.variations)
          : [];
      if (
        restaurantId !== null &&
        foodTypeArray.includes(param.foodType) &&
        stockTypeArray.includes(param.stockType) &&
        statusArray.includes(param.status)
      ) {
        const restaurantInfo = await Restaurant.findById(restaurantId, { productLimit: 1 });
        if (
          restaurantInfo &&
          restaurantInfo.id &&
          restaurantInfo.id !== null &&
          restaurantInfo.id !== ''
        ) {
          const productLimit =
            parseInt(restaurantInfo.productLimit, 10) !== -1
              ? parseInt(restaurantInfo.productLimit, 10)
              : Number.MAX_SAFE_INTEGER;
          const totalFoodCount = await Food.countDocuments({
            restaurant: new mongoose.Types.ObjectId(restaurantId),
          });
          if (productLimit >= parseInt(totalFoodCount, 10)) {
            const foodData = new Food({
              name:
                param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
              shortDescription:
                param &&
                param.shortDescription &&
                param.shortDescription !== null &&
                param.shortDescription !== ''
                  ? param.shortDescription
                  : 'NA',
              image:
                param && param.image && param.image !== null && param.image !== ''
                  ? param.image
                  : 'NA',
              restaurant: restaurantId,
              ownCategory: param && (param.ownCategory === 'yes' || param.ownCategory === 'Yes'),
              category:
                param &&
                param.category &&
                param.category !== null &&
                param.category !== '' &&
                param.category !== '-'
                  ? param.category
                  : null,
              subCategory:
                param &&
                param.subCategory &&
                param.subCategory !== null &&
                param.subCategory !== '' &&
                param.subCategory !== '-'
                  ? param.subCategory
                  : null,
              customCategory:
                param &&
                param.customCategory &&
                param.customCategory !== null &&
                param.customCategory !== '' &&
                param.customCategory !== '-'
                  ? param.customCategory
                  : null,
              customSubCategory:
                param &&
                param.customSubCategory &&
                param.customSubCategory !== null &&
                param.customSubCategory !== '' &&
                param.customSubCategory !== '-'
                  ? param.customSubCategory
                  : null,
              foodType: param.foodType,
              addons:
                param &&
                param.addons &&
                param.addons !== null &&
                param.addons !== '' &&
                param.addons !== '-'
                  ? param.addons.split(',')
                  : [],
              startTime:
                param &&
                param.startTime &&
                param.startTime !== null &&
                param.startTime !== '' &&
                param.startTime !== '-'
                  ? param.startTime
                  : '',
              endTime:
                param &&
                param.endTime &&
                param.endTime !== null &&
                param.endTime !== '' &&
                param.endTime !== '-'
                  ? param.endTime
                  : '',
              price:
                param && param.price && param.price !== null && param.price !== ''
                  ? param.price
                  : 0,
              discountType:
                param &&
                param.discountType &&
                param.discountType !== null &&
                param.discountType !== '' &&
                param.discountType === '%'
                  ? '%'
                  : '$',
              discount:
                param && param.discount && param.discount !== null && param.discount !== ''
                  ? param.discount
                  : 0,
              purchaseLimit:
                param &&
                param.purchaseLimit &&
                param.purchaseLimit !== null &&
                param.purchaseLimit !== ''
                  ? param.purchaseLimit
                  : 10,
              variations: variationsArray,
              tags:
                param &&
                param.tags &&
                param.tags !== null &&
                param.tags !== '' &&
                param.tags !== '-'
                  ? param.tags.split(',')
                  : [],
              translations: [],
              status: param.status,
              inStock: param && (param.inStock === 'yes' || param.inStock === 'Yes'),
              taxationEnable:
                param && (param.taxationEnable === 'yes' || param.taxationEnable === 'Yes'),
              foodTax:
                param &&
                param.foodTax &&
                param.foodTax !== null &&
                param.foodTax !== '' &&
                param.foodTax !== '-'
                  ? param.foodTax.split(',')
                  : [],
              stockNumber:
                param && param.stockNumber !== '' && param.stockNumber !== null
                  ? param.stockNumber
                  : -1,
              stockType: param.stockType,
              orderSoldCount:
                param &&
                param.orderSoldCount &&
                param.orderSoldCount !== null &&
                param.orderSoldCount !== ''
                  ? param.orderSoldCount
                  : 0,
              totalSoldAmount:
                param &&
                param.totalSoldAmount &&
                param.totalSoldAmount !== null &&
                param.totalSoldAmount !== ''
                  ? param.totalSoldAmount
                  : 0,
              discountAmountGiven:
                param &&
                param.discountAmountGiven &&
                param.discountAmountGiven !== null &&
                param.discountAmountGiven !== ''
                  ? param.discountAmountGiven
                  : 0,
              recommended: param && (param.recommended === 'yes' || param.recommended === 'Yes'),
              rating:
                param && param.rating && param.rating !== null && param.rating !== ''
                  ? param.rating
                  : 0,
            });
            await Food.create(foodData);
          }
        }
      }
    });
  }
  return { success: true };
};

module.exports = {
  createFood,
  getAllFood,
  getFoodId,
  updateFoodById,
  deleteFoodById,
  getAllFoodList,
  updateMetaInfo,
  getFoodByRestaurantId,
  adminFoodList,
  getFoodByCity,
  getMyFoodApp,
  getFoodIdVendorApp,
  getSingleFoodInfo,
  getFoodListForSubscription,
  searchMenuFood,
  getRestaurantFoodFromWaiter,
  updateFooodStockAfterOrder,
  updateFoodMetaAfterOrder,
  foodReport,
  vendorFoodList,
  adminFoodDetail,
  cityzenFoodList,
  cityzenFoodListForBanner,
  kitchenOwnerFoodList,
  kitchenOwnerFoodDetail,
  kitchenOwnerUpdateFood,
  exportCollection,
  exportRawCollection,
  exportReportCollection,
  importCollection,
};

