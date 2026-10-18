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

const { status: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const {
  Favourite,
  BusinessSettings,
  Restaurant,
  Food,
  FavouriteOrder,
  Orders,
} = require('../models');

const ApiError = require('../utils/ApiError');

const saveFavourite = async (body) => {
  let query = {};
  if (body.type === 'restaurant') {
    query = { user: body.user, restaurant: body.restaurant };
  } else {
    query = { user: body.user, food: body.food };
  }
  const checkExist = await Favourite.findOne(query);
  if (checkExist === null) {
    const favouriteData = new Favourite({
      user: body.user,
      type: body.type,
      restaurant:
        body && body.restaurant !== '' && body.restaurant !== null ? body.restaurant : null,
      food: body && body.food !== '' && body.food !== null ? body.food : null,
    });
    const favourite = await Favourite.create(favouriteData);
    return { success: true, data: favourite };
  }
  throw new ApiError(httpStatus.BAD_REQUEST, 'item is already in favourite list');
};

const getFavouriteRestaurnats = async (latitude, longitude, userId, options) => {
  const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';

  const restaurantIds = await Favourite.distinct(
    'restaurant',
    { user: userId, type: 'restaurant', restaurant: { $ne: null } },
    { _id: 0, restaurant: 1 }
  );
  if (restaurantIds !== null && restaurantIds.length > 0) {
    const restaurantQuery = {
      $geoNear: {
        near: queryPoint,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: {
          _id: {
            $in: restaurantIds,
          },
          status: true,
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
      slots: 1,
      rating: 1,
      restaurantType: 1,
      status: 1,
      slug: 1,
      cuisine: 1,
      distance: 1,
      address: 1,
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
    const totalResults = await Favourite.countDocuments({
      user: userId,
      type: 'restaurant',
      restaurant: { $ne: null },
    });
    const restaurants = await Restaurant.aggregate([
      restaurantQuery,
      restaurantCuisineLookup,
      outletPromoteLookup,
      outletUnwindCollection,
      { $skip: skip },
      { $limit: Number(limit) },
      { $sort: { distance: 1 } },
      { $project: filterOptions },
    ]);
    return Promise.all([restaurants, totalResults, restaurantIds]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        restaurants,
        restaurantIds,
        page,
        limit,
        totalPages,
        totalResults,
        findMode,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getFavouriteFoods = async (latitude, longitude, userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const foodIds = await Favourite.distinct(
    'food',
    { user: userId, type: 'food', food: { $ne: null } },
    { _id: 0, food: 1 }
  );
  if (foodIds !== null && foodIds.length > 0) {
    const mostReviewedFoodsQuery = [
      {
        $match: {
          _id: {
            $in: foodIds,
          },
          status: 'live',
          inStock: true,
        },
      },
      { $sort: { rating: -1 } },
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
          addons: 1,
          taxationEnable: 1,
          foodtaxations: 1,
          stockType: 1,
          stockNumber: 1,
          status: 1,
          inStock: 1,
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
        },
      },
    ];
    const foods = await Food.aggregate(mostReviewedFoodsQuery);
    const totalResults = await Favourite.countDocuments({
      user: userId,
      type: 'food',
      food: { $ne: null },
    });
    return Promise.all([foods, totalResults, foodIds]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        foods,
        foodIds,
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

const deleteFavouriteRestaurant = async (restaurantId, userId) => {
  const favourite = await Favourite.findOne({
    user: userId,
    type: 'restaurant',
    restaurant: restaurantId,
  });
  if (!favourite) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await favourite.deleteOne();
  return favourite;
};

const deleteFavouriteFood = async (foodId, userId) => {
  const favourite = await Favourite.findOne({ user: userId, type: 'food', food: foodId });
  if (!favourite) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await favourite.deleteOne();
  return favourite;
};

const customerAllFavourite = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryConditionRestaurant = {
    user: new mongoose.Types.ObjectId(options.user),
    type: 'restaurant',
    restaurant: { $ne: null },
  };

  const queryConditionFoods = {
    user: new mongoose.Types.ObjectId(options.user),
    type: 'food',
    food: { $ne: null },
  };

  const restaurantFavouriteQuery = [
    { $match: queryConditionRestaurant },
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
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'orders',
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
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        placeOrder: {
          $size: '$orders',
        },
        createdAt: 1,
      },
    },
  ];

  const foodFavouriteQuery = [
    { $match: queryConditionFoods },
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
        localField: 'food',
        foreignField: 'foods',
        as: 'orders',
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
        food: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
        purchased: {
          $size: '$orders',
        },
        createdAt: 1,
      },
    },
  ];

  const restaurantFavourite = await Favourite.aggregate(restaurantFavouriteQuery);
  const totalResultsRestaurant = await Favourite.countDocuments(queryConditionRestaurant);

  const foodFavourite = await Favourite.aggregate(foodFavouriteQuery);
  const totalResultsFood = await Favourite.countDocuments(queryConditionFoods);

  const favouriteOrdersIds = await FavouriteOrder.find(
    { user: new mongoose.Types.ObjectId(options.user) },
    { _id: 1, order: 1 }
  )
    .skip(skip)
    .limit(limit);
  const ids = favouriteOrdersIds.map((doc) => doc.order);
  const favouriteOrderQuery = [
    { $match: { _id: { $in: ids } } },
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
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
      },
    },
  ];
  const favouriteOrders = await Orders.aggregate(favouriteOrderQuery);
  const totalResultsOrder = await FavouriteOrder.countDocuments({
    user: new mongoose.Types.ObjectId(options.user),
  });
  return Promise.all([
    restaurantFavourite,
    totalResultsRestaurant,
    foodFavourite,
    totalResultsFood,
    favouriteOrdersIds,
    totalResultsOrder,
  ]).then(() => {
    const restaurant = {
      restaurantFavourite,
      totalResultsRestaurant,
    };
    const food = {
      foodFavourite,
      totalResultsFood,
    };
    const order = {
      favouriteOrders,
      totalResultsOrder,
    };
    const result = {
      restaurant,
      food,
      order,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerFavouriteOrders = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const favouriteOrdersIds = await FavouriteOrder.find(
    { user: new mongoose.Types.ObjectId(options.user) },
    { _id: 1, order: 1 }
  )
    .skip(skip)
    .limit(limit);
  const ids = favouriteOrdersIds.map((doc) => doc.order);
  const favouriteOrderQuery = [
    { $match: { _id: { $in: ids } } },
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
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
      },
    },
  ];
  const results = await Orders.aggregate(favouriteOrderQuery);
  const totalResults = await FavouriteOrder.countDocuments({
    user: new mongoose.Types.ObjectId(options.user),
  });
  return Promise.all([favouriteOrdersIds, results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerFavouriteRestaurant = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryConditionRestaurant = {
    user: new mongoose.Types.ObjectId(options.user),
    type: 'restaurant',
    restaurant: { $ne: null },
  };
  const restaurantFavouriteQuery = [
    { $match: queryConditionRestaurant },
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
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'orders',
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
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        placeOrder: {
          $size: '$orders',
        },
        createdAt: 1,
      },
    },
  ];
  const results = await Favourite.aggregate(restaurantFavouriteQuery);
  const totalResults = await Favourite.countDocuments(queryConditionRestaurant);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerFavouriteFood = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryConditionFoods = {
    user: new mongoose.Types.ObjectId(options.user),
    type: 'food',
    food: { $ne: null },
  };

  const foodFavouriteQuery = [
    { $match: queryConditionFoods },
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
        localField: 'food',
        foreignField: 'foods',
        as: 'orders',
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
        food: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
        purchased: {
          $size: '$orders',
        },
        createdAt: 1,
      },
    },
  ];

  const results = await Favourite.aggregate(foodFavouriteQuery);
  const totalResults = await Favourite.countDocuments(queryConditionFoods);
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
  saveFavourite,
  getFavouriteRestaurnats,
  getFavouriteFoods,
  deleteFavouriteRestaurant,
  deleteFavouriteFood,
  customerAllFavourite,
  customerFavouriteOrders,
  customerFavouriteRestaurant,
  customerFavouriteFood,
};

