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
const { DateTime } = require('luxon');
const {
  Restaurant,
  Cuisine,
  Category,
  BusinessSettings,
  Food,
  City,
  Banner,
  RestaurantCampaign,
  FoodCampaign,
  User,
  Driver,
  DriverNewOrderStatus,
  Coupon,
  Locality,
  HideRestaurant,
  RestaurantNotice,
  Orders,
  AppWebSetting,
  SubscriptionTiffinPackage,
  DiningCategory,
  DiningCampaign,
  RestaurantExtraDetail,
  RestaurantOrderReview,
  DiningCoupon,
  DiningSetting,
  DiningtNotice,
  PaymentConfig,
  OrderRatingMessages,
  OrderSettings,
  RestaurantFoodLicense,
  Wallet,
  Transactions,
  RestaurantCashInHand,
  RestaurantSettings,
  Subscriber,
  PosOrTableOrder,
  TableOrder,
  RestaurantPosTableOrderCommission,
  RestaurantType,
  WithdrawalRequest,
  DiningBooking,
  UserPurchasedTiffinSubscription,
  RestaurantFacility,
  TableOrderCartItem,
  RestaurantTable,
} = require('../models');
const ApiError = require('../utils/ApiError');
const { resolveDeliveryRadius } = require('../utils/rider.pool');
const { assertUsablePin, assertLocalityInCity, assertPinInCity } = require('../utils/pin.guard');
const subscriberService = require('./subscriber.service');
const subscriptionService = require('./subscription.service');
const emailConfigService = require('./email.config.service');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const headerBannerResolver = require('../modules/header-banner/services/header.banner.resolver.service');

const updateUserCityLocation = async (userId, cityId) => {
  if (userId && userId !== null && userId !== '' && cityId && cityId !== null && cityId !== '') {
    const user = await User.findById(userId);
    if (user && user.id && user.id !== null && user.id !== '') {
      const updateBody = {
        city: cityId,
      };
      Object.assign(user, updateBody);
      await user.save();
    }
  }
};

/**
 * Shrink-only signup radius (Batch A-1).
 *
 * Registration may narrow coverage but never widen it: a requested value is
 * clamped into `[100, cityCap]` where the cap is the city's
 * `defaultDeliveryRadiusMeters` when set, else the platform radius. Absent or
 * unusable input returns null, meaning "store nothing and inherit".
 *
 * @param {string} cityId
 * @param {number|string} [requested]
 * @returns {Promise<number|null>} metres to store, or null to inherit
 */
const resolveSignupRadiusMeters = async (cityId, requested) => {
  if (requested === undefined || requested === null || requested === '') return null;
  const wanted = Number(requested);
  if (!Number.isFinite(wanted) || wanted <= 0) return null;

  let cap = null;
  try {
    if (cityId && mongoose.Types.ObjectId.isValid(cityId)) {
      const city = await City.findById(cityId, { defaultDeliveryRadiusMeters: 1 }).lean();
      const v = city && Number(city.defaultDeliveryRadiusMeters);
      if (Number.isFinite(v) && v > 0) cap = Math.min(50000, Math.max(100, Math.floor(v)));
    }
  } catch {
    cap = null;
  }
  if (cap === null) {
    try {
      const { radiusMeters } = await resolveDeliveryRadius();
      cap = radiusMeters;
    } catch {
      cap = 10000;
    }
  }
  return Math.min(cap, Math.max(100, Math.floor(wanted)));
};

const createRestaurant = async (param) => {
  // Pin guards (Batch A-5): a wrong pin silently breaks every distance the
  // platform computes for this kitchen, so onboarding refuses it loudly.
  assertUsablePin(param.longitude, param.latitude, 'Restaurant');
  await assertLocalityInCity(param.locality, param.city, 'Locality');
  await assertPinInCity(param.city, param.longitude, param.latitude, 'Restaurant');
  const signupRadiusMeters = await resolveSignupRadiusMeters(param.city, param.deliveryRadiusMeters);
  const restaurantData = new Restaurant({
    userId: param.userId,
    name: param.name,
    address: param.address,
    shortDescription: param.shortDescription,
    cuisine: param.cuisine,
    category: [],
    logo: param.logo,
    cover: param.cover,
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    type: param.type,
    commission: param.commission,
    posOrderCommission: param.posOrderCommission,
    tableOrderCommission: param.tableOrderCommission,
    subscription: param && param.subscription !== '' ? param.subscription : null,
    approxDeliveryTime: param.approxDeliveryTime,
    dishPriceForTwo: param.dishPriceForTwo,
    pos: param.pos,
    ownDriver: param.ownDriver,
    promote: param.promote,
    customCategory: param.customCategory,
    multiOutlet: param.multiOutlet,
    preBooking: param.preBooking,
    tableOrder: param.tableOrder,
    tiffinSubscription: param.tiffinSubscription,
    ownWaiter: param.ownWaiter,
    ownKitchen: param.ownKitchen,
    takeAway: param.takeAway,
    isOutlet: param.isOutlet,
    outletManagerId: param && param.outletManagerId !== '' ? param.outletManagerId : null,
    orderLimit: param.orderLimit,
    productLimit: param.productLimit,
    slots: param.slots,
    translations: param.translations,
    restaurantType: param.restaurantType,
    restaurantFacility: param.restaurantFacility,
    temporaryClosed: param.temporaryClosed,
    acceptScheduleDelivery: param.acceptScheduleDelivery,
    acceptHomeDelivery: param.acceptHomeDelivery,
    minOrderAmount: param.minOrderAmount,
    license: param && param.license !== '' ? param.license : null,
    licenseId: param.licenseId,
    socialFacebook:
      param && param.socialFacebook && param.socialFacebook !== '' && param.socialFacebook !== null
        ? param.socialFacebook
        : '',
    socialInstagram:
      param &&
      param.socialInstagram &&
      param.socialInstagram !== '' &&
      param.socialInstagram !== null
        ? param.socialInstagram
        : '',
    socialX:
      param && param.socialX && param.socialX !== '' && param.socialX !== null ? param.socialX : '',
    socialYoutube:
      param && param.socialYoutube && param.socialYoutube !== '' && param.socialYoutube !== null
        ? param.socialYoutube
        : '',
    socialLinkedIn:
      param && param.socialLinkedIn && param.socialLinkedIn !== '' && param.socialLinkedIn !== null
        ? param.socialLinkedIn
        : '',
    socialPinterest:
      param &&
      param.socialPinterest &&
      param.socialPinterest !== '' &&
      param.socialPinterest !== null
        ? param.socialPinterest
        : '',
    // Signup radius is shrink-only (see resolveSignupRadiusMeters): absent
    // means "inherit city/platform", so most restaurants store nothing here.
    deliveryConfig:
      signupRadiusMeters !== null ? { deliveryRadiusMeters: signupRadiusMeters } : undefined,
  });
  const result = await Restaurant.create(restaurantData);
  await updateUserCityLocation(param.userId, param.city);
  return result;
};

const cityzenCreateRestaurant = async (masterId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  assertUsablePin(param.longitude, param.latitude, 'Restaurant');
  await assertLocalityInCity(param.locality, city, 'Locality');
  await assertPinInCity(city, param.longitude, param.latitude, 'Restaurant');
  const cityzenSignupRadiusMeters = await resolveSignupRadiusMeters(city, param.deliveryRadiusMeters);
  const restaurantData = new Restaurant({
    userId: param.userId,
    name: param.name,
    address: param.address,
    shortDescription: param.shortDescription,
    cuisine: param.cuisine,
    category: [],
    logo: param.logo,
    cover: param.cover,
    city: `${city}`,
    locality: param && param.locality !== '' ? param.locality : null,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    type: param.type,
    commission: param.commission,
    posOrderCommission: param.posOrderCommission,
    tableOrderCommission: param.tableOrderCommission,
    subscription: param && param.subscription !== '' ? param.subscription : null,
    approxDeliveryTime: param.approxDeliveryTime,
    dishPriceForTwo: param.dishPriceForTwo,
    pos: param.pos,
    ownDriver: param.ownDriver,
    promote: param.promote,
    customCategory: param.customCategory,
    multiOutlet: param.multiOutlet,
    preBooking: param.preBooking,
    tableOrder: param.tableOrder,
    tiffinSubscription: param.tiffinSubscription,
    ownWaiter: param.ownWaiter,
    ownKitchen: param.ownKitchen,
    takeAway: param.takeAway,
    isOutlet: param.isOutlet,
    outletManagerId: param && param.outletManagerId !== '' ? param.outletManagerId : null,
    orderLimit: param.orderLimit,
    productLimit: param.productLimit,
    slots: param.slots,
    translations: param.translations,
    restaurantType: param.restaurantType,
    restaurantFacility: param.restaurantFacility,
    temporaryClosed: param.temporaryClosed,
    acceptScheduleDelivery: param.acceptScheduleDelivery,
    acceptHomeDelivery: param.acceptHomeDelivery,
    minOrderAmount: param.minOrderAmount,
    license: param && param.license !== '' ? param.license : null,
    licenseId: param.licenseId,
    socialFacebook:
      param && param.socialFacebook && param.socialFacebook !== '' && param.socialFacebook !== null
        ? param.socialFacebook
        : '',
    socialInstagram:
      param &&
      param.socialInstagram &&
      param.socialInstagram !== '' &&
      param.socialInstagram !== null
        ? param.socialInstagram
        : '',
    socialX:
      param && param.socialX && param.socialX !== '' && param.socialX !== null ? param.socialX : '',
    socialYoutube:
      param && param.socialYoutube && param.socialYoutube !== '' && param.socialYoutube !== null
        ? param.socialYoutube
        : '',
    socialLinkedIn:
      param && param.socialLinkedIn && param.socialLinkedIn !== '' && param.socialLinkedIn !== null
        ? param.socialLinkedIn
        : '',
    socialPinterest:
      param &&
      param.socialPinterest &&
      param.socialPinterest !== '' &&
      param.socialPinterest !== null
        ? param.socialPinterest
        : '',
    deliveryConfig:
      cityzenSignupRadiusMeters !== null
        ? { deliveryRadiusMeters: cityzenSignupRadiusMeters }
        : undefined,
  });
  const result = await Restaurant.create(restaurantData);
  await updateUserCityLocation(param.userId, city);
  return result;
};

const createOutletRestaurant = async (param) => {
  assertUsablePin(param.longitude, param.latitude, 'Restaurant');
  await assertLocalityInCity(param.locality, param.city, 'Locality');
  await assertPinInCity(param.city, param.longitude, param.latitude, 'Restaurant');
  const restaurantData = new Restaurant({
    userId: param.userId,
    name: param.name,
    address: param.address,
    shortDescription: param.shortDescription,
    cuisine: param.cuisine,
    category: [],
    logo: param.logo,
    cover: param.cover,
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    location: { type: 'Point', coordinates: [param.longitude, param.latitude] },
    type: 'derived',
    commission: 0,
    posOrderCommission: 0,
    tableOrderCommission: 0,
    subscription: null,
    approxDeliveryTime: param.approxDeliveryTime,
    dishPriceForTwo: param.dishPriceForTwo,
    pos: false,
    ownDriver: false,
    promote: false,
    customCategory: false,
    multiOutlet: false,
    preBooking: false,
    tableOrder: false,
    tiffinSubscription: false,
    ownWaiter: false,
    ownKitchen: false,
    takeAway: param.takeAway,
    isOutlet: true,
    outletManagerId: param && param.outletManagerId !== '' ? param.outletManagerId : null,
    orderLimit: param.orderLimit,
    productLimit: param.productLimit,
    slots: [],
    translations: param.translations,
    restaurantType: param.restaurantType,
    restaurantFacility: param.restaurantFacility,
    temporaryClosed: false,
    acceptScheduleDelivery: param.acceptScheduleDelivery,
    acceptHomeDelivery: param.acceptHomeDelivery,
    minOrderAmount: param.minOrderAmount,
    license: param && param.license !== '' ? param.license : null,
    licenseId: param.licenseId,
    socialFacebook:
      param && param.socialFacebook && param.socialFacebook !== '' && param.socialFacebook !== null
        ? param.socialFacebook
        : '',
    socialInstagram:
      param &&
      param.socialInstagram &&
      param.socialInstagram !== '' &&
      param.socialInstagram !== null
        ? param.socialInstagram
        : '',
    socialX:
      param && param.socialX && param.socialX !== '' && param.socialX !== null ? param.socialX : '',
    socialYoutube:
      param && param.socialYoutube && param.socialYoutube !== '' && param.socialYoutube !== null
        ? param.socialYoutube
        : '',
    socialLinkedIn:
      param && param.socialLinkedIn && param.socialLinkedIn !== '' && param.socialLinkedIn !== null
        ? param.socialLinkedIn
        : '',
    socialPinterest:
      param &&
      param.socialPinterest &&
      param.socialPinterest !== '' &&
      param.socialPinterest !== null
        ? param.socialPinterest
        : '',
  });
  const result = await Restaurant.create(restaurantData);
  await updateUserCityLocation(param.userId, param.city);
  return result;
};

const nearMeRestaurant = async (latitude, longitude, uid, options) => {
  const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
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
  const queryCity = {
    location: {
      $near: {
        $geometry: queryPoint,
        $maxDistance: radiusInMeters,
      },
    },
    status: true,
  };
  const queryRestaurant = {
    location: {
      $near: {
        $geometry: queryPoint,
        $maxDistance: radiusInMeters,
      },
    },
    status: true,
    temporaryClosed: false,
  };
  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
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
  const queryBrands = {
    location: {
      $near: {
        $geometry: queryPoint,
        $maxDistance: radiusInMeters,
      },
    },
    status: true,
    isOutlet: true,
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
  const filterOptionsBrand = {
    name: 1,
    slug: 1,
    logo: 1,
    cover: 1,
    translations: 1,
  };
  const city = await City.findOne(queryCity);
  if (city !== null && city.id !== null && city.status === true) {
    await updateUserCityLocation(uid, city.id);
    const restaurants = await Restaurant.aggregate([
      restaurantQuery,
      {
        $match: {
          _id: {
            $nin: hiddenRestaurantsId,
          },
          status: true,
          temporaryClosed: false,
        },
      },
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $skip: skip },
      { $limit: Number(limit) },
      { $project: filterOptions },
    ]);
    const newArrivals = await Restaurant.aggregate([
      restaurantQuery,
      {
        $match: {
          _id: {
            $nin: hiddenRestaurantsId,
          },
          status: true,
          temporaryClosed: false,
        },
      },
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $sort: { createdDate: -1 } },
      { $limit: 10 },
      { $project: filterOptions },
    ]);
    const popularRestaurant = await Restaurant.aggregate([
      restaurantQuery,
      {
        $match: {
          _id: {
            $nin: hiddenRestaurantsId,
          },
          status: true,
          temporaryClosed: false,
        },
      },
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $sort: { rating: -1 } },
      { $limit: 10 },
      { $project: filterOptions },
    ]);
    const bannerQuery = [
      {
        $match: {
          city: new mongoose.Types.ObjectId(city.id),
          status: true,
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
          title: 1,
          type: 1,
          image: 1,
          food: 1,
          restaurant: 1,
          external: 1,
          translations: 1,
          restaurants: {
            id: { $ifNull: ['$restaurants._id', ''] },
            name: { $ifNull: ['$restaurants.name', ''] },
            slug: { $ifNull: ['$restaurants.slug', ''] },
            logo: { $ifNull: ['$restaurants.logo', ''] },
            cover: { $ifNull: ['$restaurants.cover', ''] },
            translations: { $ifNull: ['$restaurants.translations', []] },
          },
          foods: {
            id: { $ifNull: ['$foods._id', ''] },
            name: { $ifNull: ['$foods.name', ''] },
            translations: { $ifNull: ['$foods.translations', []] },
          },
        },
      },
    ];
    const banners = await Banner.aggregate(bannerQuery);

    // Header banner ("Silver App Bar" + promotional slot). Resolved from its own
    // module rather than the legacy `banners` collection above, but returned in
    // this same response so pull-to-refresh stays a single round trip.
    // Never throws: a resolution failure degrades to `null`, which makes the app
    // render its default header exactly as it does today.
    let headerBanner = null;
    try {
      headerBanner = await headerBannerResolver.resolveActiveHeaderBanner(city.id);
    } catch (headerBannerError) {
      console.error('[header-banner] failed to resolve active banner for home feed', headerBannerError);
      headerBanner = null;
    }

    const currentDate = new Date();
    const restaurantCampaign = await RestaurantCampaign.find(
      {
        city: city.id,
        status: true,
        startDate: { $lte: currentDate },
        endDate: { $gte: currentDate },
      },
      {
        title: 1,
        shortDescription: 1,
        image: 1,
        translations: 1,
        startDate: 1,
        endDate: 1,
        startTime: 1,
        endTime: 1,
      }
    );
    const foodCampaign = await FoodCampaign.find(
      {
        city: city.id,
        status: true,
        startDate: { $lte: currentDate },
        endDate: { $gte: currentDate },
      },
      {
        title: 1,
        shortDescription: 1,
        image: 1,
        startDate: 1,
        endDate: 1,
        startTime: 1,
        endTime: 1,
        translations: 1,
      }
    );
    const brandIds = await Restaurant.distinct('outletManagerId', queryBrands, {
      _id: 0,
      outletManagerId: 1,
    });
    const brands = await Restaurant.find({ _id: { $in: brandIds } }, filterOptionsBrand);
    const restaurantIds = await Restaurant.distinct('_id', queryRestaurant, { _id: 1 });

    const mostReviewedFoodsQuery = [
      {
        $match: {
          restaurant: {
            $in: restaurantIds,
            $nin: hiddenRestaurantsId,
          },
          status: 'live',
          inStock: true,
        },
      },
      { $limit: 10 },
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
          addons: 1,
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
          isFavourite: 1,
          taxationEnable: 1,
          foodtaxations: 1,
          stockType: 1,
          stockNumber: 1,
        },
      },
    ];
    const mostReviewedFoods = await Food.aggregate(mostReviewedFoodsQuery);

    const popularFoodIdQuery = [
      {
        $match: {
          restaurant: {
            $in: restaurantIds,
            $nin: hiddenRestaurantsId,
          },
        },
      },
      { $unwind: '$foods' },
      { $group: { _id: '$foods', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ];

    const popularFoodIds = await Orders.aggregate(popularFoodIdQuery);
    const popularFoodIdsArray = popularFoodIds.map((food) => food._id);

    const popularFoodQuery = [
      {
        $match: {
          _id: {
            $in: popularFoodIdsArray,
          },
          status: 'live',
          inStock: true,
        },
      },
      { $limit: 10 },
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
          addons: 1,
          foodtaxations: 1,
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
          isFavourite: 1,
          taxationEnable: 1,
          stockType: 1,
          stockNumber: 1,
        },
      },
    ];

    const popularFoods = await Food.aggregate(popularFoodQuery);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const trendingFoodIDQuery = [
      {
        $match: {
          restaurant: {
            $in: restaurantIds,
            $nin: hiddenRestaurantsId,
          },
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      { $unwind: '$foods' },
      { $group: { _id: '$foods', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ];

    const trendingFoodIds = await Orders.aggregate(trendingFoodIDQuery);
    const trendingFoodIdsArray = trendingFoodIds.map((food) => food._id);

    const trendingFoodQuery = [
      {
        $match: {
          _id: {
            $in: trendingFoodIdsArray,
          },
          status: 'live',
          inStock: true,
        },
      },
      { $limit: 10 },
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
          addons: 1,
          foodtaxations: 1,
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
          isFavourite: 1,
          taxationEnable: 1,
          stockType: 1,
          stockNumber: 1,
        },
      },
    ];

    const trendingFoods = await Food.aggregate(trendingFoodQuery);

    const tiffinSubscriptionPackageQuery = [
      {
        $match: {
          restaurant: {
            $in: restaurantIds,
            $nin: hiddenRestaurantsId,
          },
          status: 'live',
        },
      },
      { $limit: 10 },
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
          shortDescription: 1,
          image: 1,
          price: {
            $round: [{ $divide: ['$price', 100] }, 2],
          },
          discountType: 1,
          discount: {
            $round: [{ $divide: ['$discount', 100] }, 2],
          },
          restaurants: {
            id: { $ifNull: ['$restaurants._id', ''] },
            name: { $ifNull: ['$restaurants.name', ''] },
            logo: { $ifNull: ['$restaurants.logo', ''] },
            cover: { $ifNull: ['$restaurants.cover', ''] },
            translations: { $ifNull: ['$restaurants.translations', []] },
          },
          foods: 1,
          interval: 1,
          totalOrder: 1,
          orderTo: 1,
          available: 1,
          translations: 1,
        },
      },
    ];

    const tiffinSubscriptionPackages = await SubscriptionTiffinPackage.aggregate(
      tiffinSubscriptionPackageQuery
    );

    const appSettings = await AppWebSetting.findOne(
      {},
      {
        showTodaysTrendingFood: 1,
        showTiffinSubscriptionPackages: 1,
        showPopularRestaurant: 1,
        showPopularFood: 1,
        showNewRestaurant: 1,
        showMostReviewedFood: 1,
      }
    );

    const cuisine = await Cuisine.find({ status: true });
    const categories = await Category.find({ status: true });
    const totalCountResult = await Restaurant.aggregate([
      {
        $geoNear: {
          near: queryPoint,
          maxDistance: radiusInMeters,
          distanceField: 'distance',
          spherical: true,
        },
      },
      {
        $match: {
          _id: { $nin: hiddenRestaurantsId },
          status: true,
          temporaryClosed: false,
        },
      },
      {
        $count: 'total',
      },
    ]);
    const totalResults = totalCountResult.length ? totalCountResult[0].total : 0;
    return Promise.all([
      appSettings,
      city,
      restaurants,
      totalCountResult,
      cuisine,
      categories,
      newArrivals,
      popularRestaurant,
      brandIds,
      brands,
      restaurantIds,
      mostReviewedFoods,
      popularFoods,
      trendingFoods,
      banners,
      headerBanner,
      restaurantCampaign,
      foodCampaign,
      tiffinSubscriptionPackages,
    ]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        appSettings,
        city,
        restaurants,
        newArrivals,
        popularRestaurant,
        brands,
        mostReviewedFoods,
        popularFoods,
        trendingFoods,
        cuisine,
        categories,
        banners,
        headerBanner,
        restaurantCampaign,
        foodCampaign,
        tiffinSubscriptionPackages,
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

const getAllRestaurant = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const results = await Restaurant.aggregate([
    {
      $match: {
        $and: [{ isOutlet: false }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
  const countResult = await Restaurant.aggregate([
    {
      $match: {
        $and: [{ isOutlet: false }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getCityzenRestaurant = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const results = await Restaurant.aggregate([
    {
      $match: {
        $and: [{ isOutlet: false }, { city: new mongoose.Types.ObjectId(city) }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
  const countResult = await Restaurant.aggregate([
    {
      $match: {
        $and: [{ isOutlet: false }, { city: new mongoose.Types.ObjectId(city) }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getMyOutletList = async (manager, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await Restaurant.aggregate([
    { $match: { isOutlet: true, outletManagerId: new mongoose.Types.ObjectId(manager) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const totalResults = await Restaurant.countDocuments({
    isOutlet: true,
    outletManagerId: new mongoose.Types.ObjectId(manager),
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

const getAllOutlet = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const results = await Restaurant.aggregate([
    {
      $match: {
        $and: [{ isOutlet: true }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'outlet',
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
      $unwind: {
        path: '$outlet',
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
        manager: {
          id: { $ifNull: ['$outlet._id', ''] },
          name: { $ifNull: ['$outlet.name', ''] },
          translations: { $ifNull: ['$outlet.translations', []] },
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
      },
    },
  ]);
  const countResult = await Restaurant.aggregate([
    {
      $match: {
        $and: [{ isOutlet: true }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getCityzenOutlet = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const results = await Restaurant.aggregate([
    {
      $match: {
        $and: [{ isOutlet: true }, { city: new mongoose.Types.ObjectId(city) }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'outlet',
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
      $unwind: {
        path: '$outlet',
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
        manager: {
          id: { $ifNull: ['$outlet._id', ''] },
          name: { $ifNull: ['$outlet.name', ''] },
          translations: { $ifNull: ['$outlet.translations', []] },
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
      },
    },
  ]);
  const countResult = await Restaurant.aggregate([
    {
      $match: {
        $and: [{ isOutlet: true }, { city: new mongoose.Types.ObjectId(city) }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getRestaurantById = async (id) => {
  return Restaurant.findById(id);
};

/**
 * City-master scoping (Batch D-1). A city-master administers their own city:
 * writing another city's restaurant is 403, not a silent cross-city edit.
 * Auth is role-rights only, so ownership is enforced here, at the service —
 * every cityzen handler for restaurant-scoped writes goes through this.
 *
 * @returns {Promise<{master: object, restaurant: object}>}
 * @throws {ApiError} 404 on missing rows, 403 on cross-city access
 */
const assertMasterOwnsRestaurant = async (masterId, restaurantId) => {
  const master = await User.findById(masterId, { city: 1 }).lean();
  if (!master) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  const restaurant = await Restaurant.findById(restaurantId, { city: 1 }).lean();
  if (!restaurant) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  if (String(restaurant.city) !== String(master.city)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Restaurant is outside your city');
  }
  return { master, restaurant };
};

const getSlots = async (id) => {
  return Restaurant.findById(id, { slots: 1 });
};

const getRestaurantByIdVendorLogin = async (outletManagerId) => {
  const response = await Restaurant.findById(outletManagerId, {
    status: 1,
    id: 1,
    pos: 1,
    ownDriver: 1,
    promote: 1,
    customCategory: 1,
    multiOutlet: 1,
    preBooking: 1,
    tableOrder: 1,
    tiffinSubscription: 1,
    ownWaiter: 1,
    ownKitchen: 1,
  });
  return response;
};

const getRestaurantManagerTypeAndCommission = async (outletManagerId) => {
  const response = await Restaurant.findById(outletManagerId, {
    type: 1,
    commission: 1,
    posOrderCommission: 1,
    tableOrderCommission: 1,
  });
  return response;
};

const updateStatus = async (restaurantId, param) => {
  const restaurant = await getRestaurantById(restaurantId);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: param.status,
    temporaryClosed: !(param && (param.status === true || param.status === 'true')),
  };

  Object.assign(restaurant, updateBody);
  await restaurant.save();
  if (
    restaurant &&
    restaurant.userId !== null &&
    restaurant.userId !== '' &&
    (updateBody.status === false || updateBody.status === 'false')
  ) {
    const userInfo = await User.findById(restaurant.userId);
    if (userInfo && userInfo !== null && userInfo.email !== null && userInfo.email !== '') {
      Object.assign(userInfo, { status: false });
      await userInfo.save();
      const { email, locale } = userInfo;
      await emailConfigService.sendAccountBlockedEmail(email, locale);
    }
  } else if (
    restaurant &&
    restaurant.userId !== null &&
    restaurant.userId !== '' &&
    (updateBody.status === true || updateBody.status === 'true')
  ) {
    const userInfo = await User.findById(restaurant.userId);
    if (userInfo && userInfo !== null && userInfo.email !== null && userInfo.email !== '') {
      Object.assign(userInfo, { status: true });
      await userInfo.save();
    }
  }
  return { success: true };
};

const getById = async (id) => {
  const restaurant = await getRestaurantById(id);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return restaurant;
};

const getByUserId = async (id) => {
  const restaurant = await Restaurant.findOne(
    { userId: id },
    {
      userId: 1,
      isOutlet: 1,
      pos: 1,
      ownDriver: 1,
      promote: 1,
      customCategory: 1,
      multiOutlet: 1,
      preBooking: 1,
      tableOrder: 1,
      tiffinSubscription: 1,
      outletManagerId: 1,
      ownWaiter: 1,
      ownKitchen: 1,
    }
  );
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return restaurant;
};

const getByUserIdVendorLogin = async (id) => {
  const restaurant = await Restaurant.findOne(
    { userId: id },
    {
      userId: 1,
      type: 1,
      status: 1,
      outletManagerId: 1,
      isOutlet: 1,
      id: 1,
      pos: 1,
      ownDriver: 1,
      promote: 1,
      customCategory: 1,
      multiOutlet: 1,
      preBooking: 1,
      tableOrder: 1,
      tiffinSubscription: 1,
      ownWaiter: 1,
      ownKitchen: 1,
    }
  );
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return restaurant;
};

const getByManagerId = async (outletManagerId) => {
  const restaurant = await Restaurant.findById(outletManagerId, {
    userId: 1,
    isOutlet: 1,
    pos: 1,
    ownDriver: 1,
    promote: 1,
    customCategory: 1,
    multiOutlet: 1,
    preBooking: 1,
    tableOrder: 1,
    tiffinSubscription: 1,
    ownWaiter: 1,
    ownKitchen: 1,
  });
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return restaurant;
};

const updateRestaurantById = async (restaurantId, param) => {
  const restaurant = await getRestaurantById(restaurantId);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    name: param.name,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    address: param.address,
    shortDescription: param.shortDescription,
    cuisine: param.cuisine,
    logo: param.logo,
    cover: param.cover,
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    type: param.type,
    commission: param.commission,
    posOrderCommission: param.posOrderCommission,
    tableOrderCommission: param.tableOrderCommission,
    subscription: param && param.subscription !== '' ? param.subscription : null,
    approxDeliveryTime: param.approxDeliveryTime,
    dishPriceForTwo: param.dishPriceForTwo,
    pos: param.pos,
    ownDriver: param.ownDriver,
    promote: param.promote,
    customCategory: param.customCategory,
    multiOutlet: param.multiOutlet,
    preBooking: param.preBooking,
    tableOrder: param.tableOrder,
    tiffinSubscription: param.tiffinSubscription,
    ownWaiter: param.ownWaiter,
    ownKitchen: param.ownKitchen,
    takeAway: param.takeAway,
    orderLimit: param.orderLimit,
    productLimit: param.productLimit,
    translations: param.translations,
    restaurantType: param.restaurantType,
    restaurantFacility: param.restaurantFacility,
    temporaryClosed: param.temporaryClosed,
    acceptScheduleDelivery: param.acceptScheduleDelivery,
    acceptHomeDelivery: param.acceptHomeDelivery,
    minOrderAmount: param.minOrderAmount,
    license: param && param.license !== '' ? param.license : null,
    licenseId: param.licenseId,
    socialFacebook:
      param && param.socialFacebook && param.socialFacebook !== '' && param.socialFacebook !== null
        ? param.socialFacebook
        : '',
    socialInstagram:
      param &&
      param.socialInstagram &&
      param.socialInstagram !== '' &&
      param.socialInstagram !== null
        ? param.socialInstagram
        : '',
    socialX:
      param && param.socialX && param.socialX !== '' && param.socialX !== null ? param.socialX : '',
    socialYoutube:
      param && param.socialYoutube && param.socialYoutube !== '' && param.socialYoutube !== null
        ? param.socialYoutube
        : '',
    socialLinkedIn:
      param && param.socialLinkedIn && param.socialLinkedIn !== '' && param.socialLinkedIn !== null
        ? param.socialLinkedIn
        : '',
    socialPinterest:
      param &&
      param.socialPinterest &&
      param.socialPinterest !== '' &&
      param.socialPinterest !== null
        ? param.socialPinterest
        : '',
  };
  if (restaurant.type === 'subscription' && restaurantData.type === 'commission') {
    await subscriberService.deleteSubscriberByRestaurant(restaurantId);
  } else if (restaurant.type === 'commission' && restaurantData.type === 'subscription') {
    const subscription = await subscriptionService.getById(restaurantData.subscription);
    const serverStartDate = DateTime.now().toFormat('yyyy-MM-dd');
    const serverEndDate = DateTime.now()
      .plus({ days: subscription.validity })
      .toFormat('yyyy-MM-dd');
    const subscriptionData = {
      subscriptions: restaurantData.subscription,
      restaurant: restaurant.id,
      trialStartDate: '',
      trialEndDate: '',
      startDate: serverStartDate,
      endDate: serverEndDate,
    };
    await subscriberService.createSubscriber(subscriptionData);
  }
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  await updateUserCityLocation(restaurant.userId, param.city);
  return { success: true };
};

const cityzenUpdateRestaurantById = async (masterId, restaurantId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const restaurant = await getRestaurantById(restaurantId);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    name: param.name,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    address: param.address,
    shortDescription: param.shortDescription,
    cuisine: param.cuisine,
    logo: param.logo,
    cover: param.cover,
    city: `${city}`,
    locality: param && param.locality !== '' ? param.locality : null,
    type: param.type,
    commission: param.commission,
    posOrderCommission: param.posOrderCommission,
    tableOrderCommission: param.tableOrderCommission,
    subscription: param && param.subscription !== '' ? param.subscription : null,
    approxDeliveryTime: param.approxDeliveryTime,
    dishPriceForTwo: param.dishPriceForTwo,
    pos: param.pos,
    ownDriver: param.ownDriver,
    promote: param.promote,
    customCategory: param.customCategory,
    multiOutlet: param.multiOutlet,
    preBooking: param.preBooking,
    tableOrder: param.tableOrder,
    tiffinSubscription: param.tiffinSubscription,
    ownWaiter: param.ownWaiter,
    ownKitchen: param.ownKitchen,
    takeAway: param.takeAway,
    orderLimit: param.orderLimit,
    productLimit: param.productLimit,
    translations: param.translations,
    restaurantType: param.restaurantType,
    restaurantFacility: param.restaurantFacility,
    temporaryClosed: param.temporaryClosed,
    acceptScheduleDelivery: param.acceptScheduleDelivery,
    acceptHomeDelivery: param.acceptHomeDelivery,
    minOrderAmount: param.minOrderAmount,
    license: param && param.license !== '' ? param.license : null,
    licenseId: param.licenseId,
    socialFacebook:
      param && param.socialFacebook && param.socialFacebook !== '' && param.socialFacebook !== null
        ? param.socialFacebook
        : '',
    socialInstagram:
      param &&
      param.socialInstagram &&
      param.socialInstagram !== '' &&
      param.socialInstagram !== null
        ? param.socialInstagram
        : '',
    socialX:
      param && param.socialX && param.socialX !== '' && param.socialX !== null ? param.socialX : '',
    socialYoutube:
      param && param.socialYoutube && param.socialYoutube !== '' && param.socialYoutube !== null
        ? param.socialYoutube
        : '',
    socialLinkedIn:
      param && param.socialLinkedIn && param.socialLinkedIn !== '' && param.socialLinkedIn !== null
        ? param.socialLinkedIn
        : '',
    socialPinterest:
      param &&
      param.socialPinterest &&
      param.socialPinterest !== '' &&
      param.socialPinterest !== null
        ? param.socialPinterest
        : '',
  };
  if (restaurant.type === 'subscription' && restaurantData.type === 'commission') {
    await subscriberService.deleteSubscriberByRestaurant(restaurantId);
  } else if (restaurant.type === 'commission' && restaurantData.type === 'subscription') {
    const subscription = await subscriptionService.getById(restaurantData.subscription);
    const serverStartDate = DateTime.now().toFormat('yyyy-MM-dd');
    const serverEndDate = DateTime.now()
      .plus({ days: subscription.validity })
      .toFormat('yyyy-MM-dd');
    const subscriptionData = {
      subscriptions: restaurantData.subscription,
      restaurant: restaurant.id,
      trialStartDate: '',
      trialEndDate: '',
      startDate: serverStartDate,
      endDate: serverEndDate,
    };
    await subscriberService.createSubscriber(subscriptionData);
  }
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  await updateUserCityLocation(restaurant.userId, city);
  return { success: true };
};

const updateOutletById = async (restaurantId, param) => {
  const restaurant = await getRestaurantById(restaurantId);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    name: param.name,
    location: { type: 'Point', coordinates: [param.longitude, param.latitude] },
    address: param.address,
    shortDescription: param.shortDescription,
    cuisine: param.cuisine,
    logo: param.logo,
    cover: param.cover,
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    approxDeliveryTime: param.approxDeliveryTime,
    dishPriceForTwo: param.dishPriceForTwo,
    takeAway: param.takeAway,
    translations: param.translations,
    restaurantType: param.restaurantType,
    restaurantFacility: param.restaurantFacility,
    acceptScheduleDelivery: param.acceptScheduleDelivery,
    acceptHomeDelivery: param.acceptHomeDelivery,
    minOrderAmount: param.minOrderAmount,
    license: param && param.license !== '' ? param.license : null,
    licenseId: param.licenseId,
    socialFacebook:
      param && param.socialFacebook && param.socialFacebook !== '' && param.socialFacebook !== null
        ? param.socialFacebook
        : '',
    socialInstagram:
      param &&
      param.socialInstagram &&
      param.socialInstagram !== '' &&
      param.socialInstagram !== null
        ? param.socialInstagram
        : '',
    socialX:
      param && param.socialX && param.socialX !== '' && param.socialX !== null ? param.socialX : '',
    socialYoutube:
      param && param.socialYoutube && param.socialYoutube !== '' && param.socialYoutube !== null
        ? param.socialYoutube
        : '',
    socialLinkedIn:
      param && param.socialLinkedIn && param.socialLinkedIn !== '' && param.socialLinkedIn !== null
        ? param.socialLinkedIn
        : '',
    socialPinterest:
      param &&
      param.socialPinterest &&
      param.socialPinterest !== '' &&
      param.socialPinterest !== null
        ? param.socialPinterest
        : '',
  };
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  await updateUserCityLocation(restaurant.userId, param.city);
  return { success: true };
};

const updateSlotByRestaurantId = async (restaurantId, param) => {
  const restaurant = await getRestaurantById(restaurantId);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    slots: param.slots,
  };
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  return { success: true };
};

const updateSlotByRestaurantIdWeb = async (restaurantId, param) => {
  const restaurant = await getRestaurantById(restaurantId);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    slots: JSON.parse(param.slots),
  };
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  return { success: true };
};

const getByCityId = async (cityId) => {
  const restaurant = await Restaurant.find({ city: cityId });
  return restaurant;
};

const getRestaurantLimitedDetails = async (id) => {
  const restaurants = await Restaurant.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'parentRestaurant',
      },
    },
    {
      $unwind: {
        path: '$parentRestaurant',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        translations: 1,
        customCategory: {
          $cond: {
            if: { $eq: ['$customCategory', true] },
            then: true,
            else: {
              $cond: {
                if: { $eq: ['$isOutlet', true] },
                then: { $ifNull: ['$parentRestaurant.customCategory', false] },
                else: false,
              },
            },
          },
        },
      },
    },
  ]);
  if (checkArrayNotEmpty(restaurants)) {
    return restaurants[0];
  }
  return null;
};

const getMyInfo = async (id) => {
  const restaurant = await Restaurant.findById(id, { city: 1 });
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return restaurant;
};

const getRestaurantsByCuisine = async (cuisineSlug, latitude, longitude, uid, options) => {
  const cuisineInfo = await Cuisine.findOne(
    { slug: cuisineSlug, status: true },
    { id: 1, status: 1 }
  );
  if (cuisineInfo !== null && cuisineInfo.id !== null && cuisineInfo.status === true) {
    const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
    const limit =
      options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;
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
    const restaurantQuery = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: {
          status: true,
          temporaryClosed: false,
          cuisine: { $in: [new mongoose.Types.ObjectId(cuisineInfo.id)] },
          _id: { $nin: hiddenRestaurantsId },
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
      slots: 1,
      rating: 1,
      restaurantType: 1,
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
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $skip: skip },
      { $limit: Number(limit) },
      { $project: filterOptions },
    ]);

    const totalCountResult = await Restaurant.aggregate([
      {
        $geoNear: {
          near: queryPoint,
          maxDistance: radiusInMeters,
          distanceField: 'distance',
          spherical: true,
          query: {
            status: true,
            temporaryClosed: false,
            cuisine: { $in: [new mongoose.Types.ObjectId(cuisineInfo.id)] },
            _id: { $nin: hiddenRestaurantsId },
          },
        },
      },
      { $count: 'total' },
    ]);
    const totalResults = totalCountResult.length ? totalCountResult[0].total : 0;
    return Promise.all([restaurants, totalCountResult]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        restaurants,
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

const getRestaurantsByCategory = async (categorySlug, latitude, longitude, uid, options) => {
  const categoryInfo = await Category.findOne(
    { slug: categorySlug, status: true },
    { id: 1, status: 1 }
  );
  if (categoryInfo !== null && categoryInfo.id !== null && categoryInfo.status === true) {
    const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
    const limit =
      options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;
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
    const restaurantQuery = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: {
          status: true,
          temporaryClosed: false,
          category: { $in: [new mongoose.Types.ObjectId(categoryInfo.id)] },
          _id: { $nin: hiddenRestaurantsId },
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
      slots: 1,
      rating: 1,
      restaurantType: 1,
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
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $skip: skip },
      { $limit: Number(limit) },
      { $project: filterOptions },
    ]);

    if (restaurants !== null && restaurants.length > 0) {
      const totalCountResult = await Restaurant.aggregate([
        {
          $geoNear: {
            near: queryPoint,
            maxDistance: radiusInMeters,
            distanceField: 'distance',
            spherical: true,
            query: {
              status: true,
              temporaryClosed: false,
              category: { $in: [new mongoose.Types.ObjectId(categoryInfo.id)] },
              _id: { $nin: hiddenRestaurantsId },
            },
          },
        },
        { $count: 'total' },
      ]);
      const totalResults = totalCountResult.length ? totalCountResult[0].total : 0;
      return Promise.all([restaurants, totalCountResult]).then(() => {
        const totalPages = Math.ceil(totalResults / limit);
        const result = {
          restaurants,
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
  }
  return { success: false };
};

const getFoodsNearMeByCategory = async (categorySlug, latitude, longitude, uid, options) => {
  const categoryInfo = await Category.findOne(
    { slug: categorySlug, status: true },
    { id: 1, status: 1 }
  );
  if (categoryInfo !== null && categoryInfo.id !== null && categoryInfo.status === true) {
    const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
    const limit =
      options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;
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
    const query = {
      location: {
        $near: {
          $geometry: queryPoint,
          $maxDistance: radiusInMeters,
        },
      },
      status: true,
      temporaryClosed: false,
      category: new mongoose.Types.ObjectId(categoryInfo.id),
    };
    const restaurantIds = await Restaurant.distinct('_id', query, { _id: 1 });
    if (restaurantIds !== null && restaurantIds.length > 0) {
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
      const fullQuery = [
        {
          $match: {
            restaurant: {
              $in: restaurantIds,
              $nin: hiddenRestaurantsId,
            },
            status: 'live',
            inStock: true,
            category: new mongoose.Types.ObjectId(categoryInfo.id),
          },
        },
        { $skip: skip },
        { $limit: Number(limit) },
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
          $unwind: {
            path: '$restaurants',
            preserveNullAndEmptyArrays: true,
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
            foodtaxations: 1,
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
            isFavourite: 1,
            taxationEnable: 1,
            stockType: 1,
            stockNumber: 1,
          },
        },
      ];
      const foods = await Food.aggregate(fullQuery);
      const totalResults = await Food.countDocuments({
        restaurant: { $in: restaurantIds },
        status: 'live',
        inStock: true,
        category: new mongoose.Types.ObjectId(categoryInfo.id),
      });
      return Promise.all([foods, totalResults]).then(() => {
        const totalPages = Math.ceil(totalResults / limit);
        const result = {
          foods,
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
  }
  return { success: false };
};

const getRestaurantsByBrands = async (outlet, latitude, longitude, uid) => {
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
  const restaurantsInfo = await Restaurant.findOne({ slug: outlet }, { id: 1, status: 1 });
  if (restaurantsInfo !== null && restaurantsInfo.id !== null && restaurantsInfo.status === true) {
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
    const restaurantQuery = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: {
          status: true,
          temporaryClosed: false,
          outletManagerId: new mongoose.Types.ObjectId(restaurantsInfo.id),
          isOutlet: true,
          _id: { $nin: hiddenRestaurantsId },
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
      slots: 1,
      rating: 1,
      restaurantType: 1,
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
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $project: filterOptions },
    ]);

    if (restaurants !== null && restaurants.length > 0) {
      const totalCountResult = await Restaurant.aggregate([
        {
          $geoNear: {
            near: queryPoint,
            maxDistance: radiusInMeters,
            distanceField: 'distance',
            spherical: true,
            query: {
              status: true,
              temporaryClosed: false,
              outletManagerId: new mongoose.Types.ObjectId(restaurantsInfo.id),
              isOutlet: true,
              _id: { $nin: hiddenRestaurantsId },
            },
          },
        },
        { $count: 'total' },
      ]);
      const totalResults = totalCountResult.length ? totalCountResult[0].total : 0;
      return Promise.all([restaurants, totalCountResult]).then(() => {
        const result = {
          restaurants,
          totalResults,
          findMode,
          success: true,
        };
        return Promise.resolve(result);
      });
    }
    return { success: false };
  }
  return { success: false };
};

const getRestaurantsByLocalities = async (
  viewedFrom,
  localitySlug,
  latitude,
  longitude,
  uid,
  options
) => {
  const localityInfo = await Locality.findOne(
    { slug: localitySlug, status: true },
    { id: 1, status: 1 }
  );
  if (localityInfo !== null && localityInfo.id !== null && localityInfo.status === true) {
    const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
    const limit =
      options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;
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
    hiddenRestaurantsId.push(new mongoose.Types.ObjectId(viewedFrom));
    const restaurantQuery = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: {
          status: true,
          locality: new mongoose.Types.ObjectId(localityInfo.id),
          _id: { $nin: hiddenRestaurantsId },
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
      slots: 1,
      rating: 1,
      restaurantType: 1,
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
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $skip: skip },
      { $limit: Number(limit) },
      { $project: filterOptions },
    ]);

    if (restaurants !== null && restaurants.length > 0) {
      hiddenRestaurantsId.push(new mongoose.Types.ObjectId(viewedFrom));
      const totalCountResult = await Restaurant.aggregate([
        {
          $geoNear: {
            near: queryPoint,
            maxDistance: radiusInMeters,
            distanceField: 'distance',
            spherical: true,
            query: {
              status: true,
              temporaryClosed: false,
              locality: new mongoose.Types.ObjectId(localityInfo.id),
              _id: { $nin: hiddenRestaurantsId },
            },
          },
        },
        { $count: 'total' },
      ]);
      const totalResults = totalCountResult.length ? totalCountResult[0].total : 0;
      return Promise.all([restaurants, totalCountResult]).then(() => {
        const totalPages = Math.ceil(totalResults / limit);
        const result = {
          restaurants,
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
  }
  return { success: false };
};

const getRestaurantsInfo = async (slugUrl, latitude, longitude, uid) => {
  const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
  const businessSettings = await BusinessSettings.findOne(
    {},
    { deliveryArea: 1, findMode: 1, haveFreeDeliveryInTotal: 1, freeDelivery: 1 }
  );
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radius =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 10;
  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
      query: { status: true, slug: slugUrl },
    },
  };
  let userId;
  if (uid === null || uid === '' || uid === undefined) {
    userId = null;
  } else {
    userId = uid;
  }
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
  const restaurantTypeLookup = {
    $lookup: {
      from: 'restauranttypes',
      localField: 'restaurantType',
      foreignField: '_id',
      as: 'restauranttypes',
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
  const restaurantHiddenLookup = {
    $lookup: {
      from: 'hiderestaurants',
      localField: '_id',
      foreignField: 'restaurant',
      as: 'hiderestaurants',
      pipeline: [{ $match: { user: new mongoose.Types.ObjectId(userId) } }],
    },
  };
  const restaurantHiddenField = {
    $addFields: {
      isHidden: {
        $cond: {
          if: { $eq: [{ $size: '$hiderestaurants' }, 0] },
          then: false,
          else: true,
        },
      },
    },
  };
  const totalRestaurantRatingLookup = {
    $lookup: {
      from: 'restaurantorderreviews',
      localField: '_id',
      foreignField: 'restaurant',
      as: 'restaurantorderreviews',
    },
  };
  const restaurantCityLookup = {
    $lookup: {
      from: 'cities',
      localField: 'city',
      foreignField: '_id',
      as: 'cities',
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
  };
  const restaurantLocalitiesLookup = {
    $lookup: {
      from: 'localities',
      localField: 'locality',
      foreignField: '_id',
      as: 'localities',
      pipeline: [
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            slug: 1,
            translations: 1,
          },
        },
      ],
    },
  };
  const restaurantFoodLicenseLookup = {
    $lookup: {
      from: 'restaurantfoodlicenses',
      localField: 'license',
      foreignField: '_id',
      as: 'restaurantfoodlicenses',
      pipeline: [
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            image: 1,
            website: 1,
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
    estimatedDeliveryTime: 1,
    dishPriceForTwo: {
      $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
    },
    translations: 1,
    slots: 1,
    rating: 1,
    totalRating: {
      $size: '$restaurantorderreviews',
    },
    restauranttypes: 1,
    status: 1,
    slug: 1,
    cuisine: 1,
    distance: 1,
    address: 1,
    isFavourite: 1,
    isHidden: 1,
    temporaryClosed: 1,
    cities: {
      id: { $ifNull: ['$cities.id', ''] },
      name: { $ifNull: ['$cities.name', ''] },
      translations: { $ifNull: ['$cities.translations', []] },
    },
    localities: {
      id: { $ifNull: ['$localities.id', ''] },
      name: { $ifNull: ['$localities.name', ''] },
      slug: { $ifNull: ['$localities.slug', ''] },
      translations: { $ifNull: ['$localities.translations', []] },
    },
    license: {
      id: { $ifNull: ['$restaurantfoodlicenses.id', ''] },
      name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
      image: { $ifNull: ['$restaurantfoodlicenses.image', ''] },
      website: { $ifNull: ['$restaurantfoodlicenses.website', ''] },
      translations: { $ifNull: ['$restaurantfoodlicenses.translations', []] },
    },
    outletManagerId: 1,
    isOutlet: 1,
    licenseId: 1,
    tiffinSubscription: {
      $cond: {
        if: { $eq: ['$tiffinSubscription', true] },
        then: true,
        else: {
          $cond: {
            if: { $eq: ['$isOutlet', true] },
            then: { $ifNull: ['$parentRestaurant.tiffinSubscription', false] },
            else: false,
          },
        },
      },
    },
    preBooking: {
      $cond: {
        if: { $eq: ['$preBooking', true] },
        then: true,
        else: {
          $cond: {
            if: { $eq: ['$isOutlet', true] },
            then: { $ifNull: ['$parentRestaurant.preBooking', false] },
            else: false,
          },
        },
      },
    },
  };
  const info = await Restaurant.aggregate([
    restaurantQuery,
    restaurantCuisineLookup,
    restaurantTypeLookup,
    restaurantCityLookup,
    outletPromoteLookup,
    outletUnwindCollection,
    {
      $addFields: {
        estimatedDeliveryTime: {
          $switch: {
            branches: [
              { case: { $lte: ['$distance', 5] }, then: 10 }, // 10 minutes for distance <= 5
              {
                case: { $and: [{ $gt: ['$distance', 5] }, { $lte: ['$distance', 10] }] },
                then: 20,
              }, // 20 minutes for 5 < distance <= 10
              {
                case: { $and: [{ $gt: ['$distance', 10] }, { $lte: ['$distance', 20] }] },
                then: 30,
              }, // 30 minutes for 10 < distance <= 20
            ],
            default: 40, // Default to 40 minutes for distance > 20
          },
        },
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    restaurantLocalitiesLookup,
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    restaurantFoodLicenseLookup,
    {
      $unwind: {
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    restaurantFavouriteLookup,
    restaurantFavouriteField,
    restaurantHiddenLookup,
    restaurantHiddenField,
    totalRestaurantRatingLookup,
    { $limit: 1 },
    { $project: filterOptions },
  ]);
  if (info !== null && info.length > 0 && info[0].slug === slugUrl) {
    const queryMainCategories = [
      {
        $match: {
          restaurant: new mongoose.Types.ObjectId(info[0].id),
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
        $lookup: {
          from: 'foodorderreviews',
          localField: '_id',
          foreignField: 'food',
          as: 'foodorderreviews',
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
              shortDescription: '$shortDescription',
              image: '$image',
              foodType: '$foodType',
              startTime: '$startTime',
              endTime: '$endTime',
              discountType: '$discountType',
              purchaseLimit: '$purchaseLimit',
              variations: '$variations',
              translations: '$translations',
              recommended: '$recommended',
              rating: '$rating',
              totalRating: {
                $size: '$foodorderreviews',
              },
              status: '$status',
              inStock: '$inStock',
              stockType: '$stockType',
              stockNumber: '$stockNumber',
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              isFavourite: '$isFavourite',
              addons: '$addons',
              foodtaxations: '$foodtaxations',
              taxationEnable: '$taxationEnable',
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
          restaurant: new mongoose.Types.ObjectId(info[0].id),
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
          from: 'foodorderreviews',
          localField: '_id',
          foreignField: 'food',
          as: 'foodorderreviews',
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
              shortDescription: '$shortDescription',
              image: '$image',
              foodType: '$foodType',
              startTime: '$startTime',
              endTime: '$endTime',
              discountType: '$discountType',
              purchaseLimit: '$purchaseLimit',
              variations: '$variations',
              translations: '$translations',
              recommended: '$recommended',
              rating: '$rating',
              totalRating: {
                $size: '$foodorderreviews',
              },
              status: '$status',
              inStock: '$inStock',
              stockType: '$stockType',
              stockNumber: '$stockNumber',
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              isFavourite: '$isFavourite',
              addons: '$addons',
              foodtaxations: '$foodtaxations',
              taxationEnable: '$taxationEnable',
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
    const queryRecommended = [
      {
        $match: {
          restaurant: new mongoose.Types.ObjectId(info[0].id),
          status: 'live',
          recommended: true,
          inStock: true,
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
          foodtaxations: 1,
          status: 1,
          inStock: 1,
          stockType: 1,
          stockNumber: 1,
          price: {
            $round: [{ $divide: ['$price', 100] }, 2],
          },
          discount: {
            $round: [{ $divide: ['$discount', 100] }, 2],
          },
          isFavourite: 1,
          taxationEnable: 1,
        },
      },
    ];
    const main = await Food.aggregate(queryMainCategories);
    const custom = await Food.aggregate(queryCustomCategories);
    const recommended = await Food.aggregate(queryRecommended);
    const foodExist = await Food.find({
      restaurant: new mongoose.Types.ObjectId(info[0].id),
      status: 'live',
    });
    const haveData = foodExist.length > 0;
    const details = info[0];
    let nearStores = 0;
    if (
      details &&
      details !== null &&
      details.localities &&
      details.localities !== null &&
      details.localities.id &&
      details.localities.id !== ''
    ) {
      nearStores = await Restaurant.countDocuments({
        $and: [
          { locality: new mongoose.Types.ObjectId(details.localities.id) },
          { status: true },
          { _id: { $nin: [new mongoose.Types.ObjectId(details.id)] } },
        ],
      });
    }
    const currentDate = new Date();
    const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
    const couponQuery = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: { status: 'live', start: { $lte: currentDate }, expires: { $gte: currentDate } },
      },
    };
    const couponFilterOptions = {
      _id: 0,
      id: '$_id',
      name: 1,
      allRestaurants: 1,
      allUsers: 1,
      code: 1,
      couponType: 1,
      discountType: 1,
      limitSameUser: {
        $round: [{ $divide: ['$limitSameUser', 100] }, 2],
      },
      loyalityPoints: {
        $round: [{ $divide: ['$loyalityPoints', 100] }, 2],
      },
      maxDiscount: {
        $round: [{ $divide: ['$maxDiscount', 100] }, 2],
      },
      minCartTotal: {
        $round: [{ $divide: ['$minCartTotal', 100] }, 2],
      },
      minDiscount: {
        $round: [{ $divide: ['$minDiscount', 100] }, 2],
      },
      restaurant: 1,
      user: 1,
      translations: 1,
    };
    const coupons = await Coupon.aggregate([couponQuery, { $project: couponFilterOptions }]);
    const notice = await RestaurantNotice.find(
      { status: true },
      { id: 1, name: 1, translations: 1 }
    );

    return Promise.all([
      info,
      main,
      custom,
      recommended,
      foodExist,
      haveData,
      nearStores,
      coupons,
      findMode,
      notice,
      businessSettings,
    ]).then(() => {
      const result = {
        details,
        main,
        custom,
        recommended,
        haveData,
        nearStores,
        coupons,
        findMode,
        notice,
        businessSettings,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const driverNearTrendingRestaurant = async (latitude, longitude, driverId) => {
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
      query: { status: true, temporaryClosed: false },
    },
  };
  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    logo: 1,
    cover: 1,
    translations: 1,
    status: 1,
    slug: 1,
    distance: 1,
    address: 1,
    orders: {
      $size: '$orders',
    },
    location: 1,
  };
  const restaurants = await Restaurant.aggregate([
    restaurantQuery,
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'orders',
      },
    },
    { $project: filterOptions },
    { $sort: { orders: -1 } },
  ]);
  const driverMeta = await User.findById(driverId, { firstName: 1, lastName: 1, status: 1 });
  const driverInfo = await Driver.findOne(
    { userId: driverId },
    { activeStatus: 1, status: 1, isBlocked: 1 }
  );
  const queryCondition = {
    $and: [{ driver: new mongoose.Types.ObjectId(driverId) }],
    $or: [
      { driverOrderStatus: 'accepted' },
      { driverOrderStatus: 'driver_reached_restaurant' },
      { driverOrderStatus: 'driver_pickpup_order' },
      { driverOrderStatus: 'driver_reached_customer' },
    ],
  };
  const orderQuery = [
    { $match: queryCondition },
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
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
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
      $unwind: {
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        driverOrderStatus: 1,
        orderFrom: 1,
        createdAt: 1,
        orderId: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          location: { $ifNull: ['$restaurants.location', null] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
      },
    },
  ];
  const orders = await DriverNewOrderStatus.aggregate(orderQuery);
  return Promise.all([restaurants, findMode, radius, driverMeta, driverInfo, orders]).then(() => {
    const result = {
      restaurants,
      findMode,
      radius,
      driverMeta,
      driverInfo,
      orders,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const globalSearch = async (latitude, longitude, searchQuery) => {
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
  const searchRegExp = RegExp(searchQuery, 'i');
  const categories = await Category.find(
    {
      $or: [
        { name: searchRegExp },
        { slug: searchRegExp },
        {
          translations: {
            $elemMatch: {
              value: { $regex: searchRegExp },
            },
          },
        },
      ],
      $and: [{ status: true }],
    },
    { id: 1, name: 1, slug: 1, image: 1, translations: 1 }
  );

  const cuisines = await Cuisine.find(
    {
      $or: [
        { name: searchRegExp },
        { slug: searchRegExp },
        {
          translations: {
            $elemMatch: {
              value: { $regex: searchRegExp },
            },
          },
        },
      ],
      $and: [{ status: true }],
    },
    { id: 1, name: 1, slug: 1, image: 1, translations: 1 }
  );

  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
    },
  };

  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    logo: 1,
    cover: 1,
    translations: 1,
    status: 1,
    slug: 1,
    distance: 1,
  };

  const restaurantFullQuery = [
    restaurantQuery,
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: true }, { temporaryClosed: false }],
      },
    },
    {
      $project: filterOptions,
    },
  ];

  const restaurants = await Restaurant.aggregate([restaurantFullQuery]);

  const queryBrands = {
    location: {
      $near: {
        $geometry: queryPoint,
        $maxDistance: radiusInMeters,
      },
    },
    $or: [
      { name: searchRegExp },
      { slug: searchRegExp },
      {
        translations: {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ],
    $and: [{ status: true, isOutlet: true }],
  };

  const brandIds = await Restaurant.distinct('outletManagerId', queryBrands, {
    _id: 0,
    outletManagerId: 1,
  });

  const filterOptionsBrand = {
    name: 1,
    slug: 1,
    logo: 1,
    cover: 1,
    translations: 1,
  };

  const brands = await Restaurant.find({ _id: { $in: brandIds } }, filterOptionsBrand);

  return Promise.all([categories, cuisines, restaurants, brands]).then(() => {
    const result = {
      categories,
      cuisines,
      restaurants,
      brands,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const globalSearchInitial = async (latitude, longitude) => {
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
  const query = {
    location: {
      $near: {
        $geometry: queryPoint,
        $maxDistance: radiusInMeters,
      },
    },
    status: true,
  };
  const city = await City.findOne(query);
  const category = await Category.find({ status: true });
  return Promise.all([city, category]).then(() => {
    const result = {
      city,
      category,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const foodSearchInitial = async (id, uid) => {
  let userId;
  if (uid === null || uid === '' || uid === undefined) {
    userId = null;
  } else {
    userId = uid;
  }
  const foodQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(id),
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
        addons: 1,
        foodtaxations: 1,
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
        isFavourite: 1,
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
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

const foodSearch = async (id, uid, searchQuery) => {
  let userId;
  if (uid === null || uid === '' || uid === undefined) {
    userId = null;
  } else {
    userId = uid;
  }
  const searchRegExp = RegExp(searchQuery, 'i');
  const foodQuery = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ inStock: true, restaurant: new mongoose.Types.ObjectId(id), status: 'live' }],
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
        addons: 1,
        foodtaxations: 1,
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
        isFavourite: 1,
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
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

const getRestaurantsByCityIdLimitedDetailsForAdmin = async (cityId) => {
  const restaurants = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(cityId),
        status: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'owner',
      },
    },
    {
      $unwind: {
        path: '$owner',
        preserveNullAndEmptyArrays: true,
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
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'parentRestaurant',
      },
    },
    {
      $unwind: {
        path: '$parentRestaurant',
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        translations: 1,
        slug: 1,
        customCategory: {
          $cond: {
            if: { $eq: ['$customCategory', true] },
            then: true,
            else: {
              $cond: {
                if: { $eq: ['$isOutlet', true] },
                then: { $ifNull: ['$parentRestaurant.customCategory', false] },
                else: false,
              },
            },
          },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        ownerInfo: {
          id: { $ifNull: ['$owner._id', ''] },
          firstName: { $ifNull: ['$owner.firstName', ''] },
          lastName: { $ifNull: ['$owner.lastName', ''] },
        },
      },
    },
  ]);
  return { restaurants };
};

const cityzenRestaurantsLimitedDetails = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const restaurants = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
        status: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'owner',
      },
    },
    {
      $unwind: {
        path: '$owner',
        preserveNullAndEmptyArrays: true,
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
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'parentRestaurant',
      },
    },
    {
      $unwind: {
        path: '$parentRestaurant',
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        translations: 1,
        slug: 1,
        customCategory: {
          $cond: {
            if: { $eq: ['$customCategory', true] },
            then: true,
            else: {
              $cond: {
                if: { $eq: ['$isOutlet', true] },
                then: { $ifNull: ['$parentRestaurant.customCategory', false] },
                else: false,
              },
            },
          },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        ownerInfo: {
          id: { $ifNull: ['$owner._id', ''] },
          firstName: { $ifNull: ['$owner.firstName', ''] },
          lastName: { $ifNull: ['$owner.lastName', ''] },
        },
      },
    },
  ]);
  return { restaurants };
};

const getRestaurantByCityIdFromCollectCash = async (cityId) => {
  const restaurants = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(cityId),
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'owner',
      },
    },
    {
      $unwind: {
        path: '$owner',
        preserveNullAndEmptyArrays: true,
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
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'parentRestaurant',
      },
    },
    {
      $unwind: {
        path: '$parentRestaurant',
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        translations: 1,
        slug: 1,
        customCategory: {
          $cond: {
            if: { $eq: ['$customCategory', true] },
            then: true,
            else: {
              $cond: {
                if: { $eq: ['$isOutlet', true] },
                then: { $ifNull: ['$parentRestaurant.customCategory', false] },
                else: false,
              },
            },
          },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        ownerInfo: {
          id: { $ifNull: ['$owner._id', ''] },
          firstName: { $ifNull: ['$owner.firstName', ''] },
          lastName: { $ifNull: ['$owner.lastName', ''] },
        },
      },
    },
  ]);
  return { restaurants };
};

const getRestaurantInfoForNewDriver = async (restaurantId) => {
  const info = await Restaurant.findById(restaurantId, {
    id: 1,
    name: 1,
    city: 1,
    locality: 1,
    location: 1,
  });
  return info;
};

const getRestaurantsByCityIdForTiffinPackagesAdmin = async (cityId) => {
  const restaurants = await Restaurant.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'ownerDetails',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'owner',
      },
    },
    {
      $unwind: {
        path: '$owner',
        preserveNullAndEmptyArrays: true,
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
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { tiffinSubscription: true, city: new mongoose.Types.ObjectId(cityId) },
          {
            $and: [
              { 'ownerDetails.tiffinSubscription': true },
              { city: new mongoose.Types.ObjectId(cityId) },
              { status: true },
              { isOutlet: true },
            ],
          },
        ],
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
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        ownerInfo: {
          id: { $ifNull: ['$owner._id', ''] },
          firstName: { $ifNull: ['$owner.firstName', ''] },
          lastName: { $ifNull: ['$owner.lastName', ''] },
        },
      },
    },
  ]);
  return { restaurants };
};

const getDiningSupportedRestaurantByCityId = async (cityId) => {
  const restaurants = await Restaurant.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'ownerDetails',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'owner',
      },
    },
    {
      $unwind: {
        path: '$owner',
        preserveNullAndEmptyArrays: true,
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
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        city: new mongoose.Types.ObjectId(cityId),
        status: true,
        $or: [
          { preBooking: true, city: new mongoose.Types.ObjectId(cityId) },
          {
            $and: [{ 'ownerDetails.preBooking': true }, { isOutlet: true }],
          },
        ],
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
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        ownerInfo: {
          id: { $ifNull: ['$owner._id', ''] },
          firstName: { $ifNull: ['$owner.firstName', ''] },
          lastName: { $ifNull: ['$owner.lastName', ''] },
        },
      },
    },
  ]);
  return { restaurants };
};

const nearMeDiningRestaurant = async (latitude, longitude, uid, options) => {
  const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  let userId;
  if (uid === null || uid === '' || uid === undefined) {
    userId = null;
  } else {
    userId = uid;
  }
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
  const queryCity = {
    location: {
      $near: {
        $geometry: queryPoint,
        $maxDistance: radiusInMeters,
      },
    },
    status: true,
  };
  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
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

  let hiddenRestaurantsId = [];
  if (userId && userId !== null && userId !== '') {
    hiddenRestaurantsId = await HideRestaurant.distinct(
      'restaurant',
      { user: new mongoose.Types.ObjectId(userId) },
      { _id: 0, restaurant: 1 }
    );
  }

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

  const city = await City.findOne(queryCity);
  if (city !== null && city.id !== null && city.status === true) {
    const dinings = await Restaurant.aggregate([
      restaurantQuery,
      {
        $match: {
          status: true,
          temporaryClosed: false,
          $or: [
            { preBooking: true },
            {
              $and: [{ 'parentRestaurant.preBooking': true }, { isOutlet: true }],
            },
          ],
          _id: {
            $nin: hiddenRestaurantsId,
          },
        },
      },
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $skip: skip },
      { $limit: Number(limit) },
      { $project: filterOptions },
    ]);
    const newArrivals = await Restaurant.aggregate([
      restaurantQuery,
      {
        $match: {
          status: true,
          temporaryClosed: false,
          $or: [
            { preBooking: true },
            {
              $and: [{ 'parentRestaurant.preBooking': true }, { isOutlet: true }],
            },
          ],
          _id: {
            $nin: hiddenRestaurantsId,
          },
        },
      },
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $sort: { createdDate: -1 } },
      { $limit: 10 },
      { $project: filterOptions },
    ]);
    const popularDining = await Restaurant.aggregate([
      restaurantQuery,
      {
        $match: {
          status: true,
          temporaryClosed: false,
          $or: [
            { preBooking: true },
            {
              $and: [{ 'parentRestaurant.preBooking': true }, { isOutlet: true }],
            },
          ],
          _id: {
            $nin: hiddenRestaurantsId,
          },
        },
      },
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $sort: { rating: -1 } },
      { $limit: 10 },
      { $project: filterOptions },
    ]);
    const countResults = await Restaurant.aggregate([
      restaurantQuery,
      {
        $match: {
          status: true,
          temporaryClosed: false,
          $or: [
            { preBooking: true },
            {
              $and: [{ 'parentRestaurant.preBooking': true }, { isOutlet: true }],
            },
          ],
        },
      },
      { $count: 'totalDiningNearMe' },
    ]);
    let totalResults = 0;
    if (countResults.length > 0) {
      totalResults = countResults[0].totalDiningNearMe;
    }
    const categories = await DiningCategory.find({ status: true });
    const currentDate = new Date();
    const diningCampaign = await DiningCampaign.find(
      {
        city: city.id,
        status: true,
        startDate: { $lte: currentDate },
        endDate: { $gte: currentDate },
      },
      {
        title: 1,
        shortDescription: 1,
        image: 1,
        translations: 1,
        startDate: 1,
        endDate: 1,
        startTime: 1,
        endTime: 1,
      }
    );
    const appSettings = await AppWebSetting.findOne(
      {},
      {
        showPopularDiningRestaurant: 1,
        showNewDiningRestaurant: 1,
      }
    );
    return Promise.all([
      city,
      dinings,
      newArrivals,
      popularDining,
      diningCampaign,
      categories,
      appSettings,
      countResults,
    ]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        city,
        dinings,
        newArrivals,
        popularDining,
        categories,
        appSettings,
        diningCampaign,
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

const nearMeDiningRestaurantOnMap = async (latitude, longitude) => {
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
  const queryCity = {
    location: {
      $near: {
        $geometry: queryPoint,
        $maxDistance: radiusInMeters,
      },
    },
    status: true,
  };
  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
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
    rating: 1,
    status: 1,
    slug: 1,
    cuisine: 1,
    distance: 1,
    address: 1,
    location: 1,
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

  const city = await City.findOne(queryCity);
  if (city !== null && city.id !== null && city.status === true) {
    const dinings = await Restaurant.aggregate([
      restaurantQuery,
      {
        $match: {
          status: true,
          temporaryClosed: false,
          $or: [
            { preBooking: true },
            {
              $and: [{ 'parentRestaurant.preBooking': true }, { isOutlet: true }],
            },
          ],
        },
      },
      restaurantCuisineLookup,
      outletPromoteLookup,
      outletUnwindCollection,
      { $project: filterOptions },
    ]);

    return Promise.all([city, dinings]).then(() => {
      const result = {
        city,
        dinings,
        findMode,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getVendorDiningInformation = async (id) => {
  const restaurantQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'diningcategories',
        localField: 'diningCategory',
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
        as: 'diningCategory',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        diningCategory: 1,
      },
    },
  ];
  const restaurantDetail = await Restaurant.aggregate(restaurantQuery);
  if (restaurantDetail == null || !restaurantDetail[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const dining = await RestaurantExtraDetail.findOne(
    { restaurant: new mongoose.Types.ObjectId(id) },
    { photos: 1, menu: 1 }
  );
  return Promise.all([dining, restaurantDetail]).then(() => {
    let menuDetail = [];
    let diningPhotos = [];
    if (dining !== null && dining.menu !== null) {
      menuDetail = dining.menu;
    }
    if (dining !== null && dining.photos !== null) {
      diningPhotos = dining.photos;
    }
    const result = {
      restaurant: restaurantDetail[0],
      menuDetail,
      diningPhotos,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getVendorDiningInformationWeb = async (id) => {
  const restaurantQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'diningcategories',
        localField: 'diningCategory',
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
        as: 'diningCategory',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        diningCategory: 1,
      },
    },
  ];
  const restaurantDetail = await Restaurant.aggregate(restaurantQuery);
  if (restaurantDetail == null || !restaurantDetail[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const categories = await DiningCategory.find(
    { status: 1 },
    { id: 1, name: 1, image: 1, translations: 1 }
  );
  const dining = await RestaurantExtraDetail.findOne(
    { restaurant: new mongoose.Types.ObjectId(id) },
    { photos: 1, menu: 1 }
  );
  return Promise.all([dining, categories, restaurantDetail]).then(() => {
    let menuDetail = [];
    let diningPhotos = [];
    if (dining !== null && dining.menu !== null) {
      menuDetail = dining.menu;
    }
    if (dining !== null && dining.photos !== null) {
      diningPhotos = dining.photos;
    }
    const result = {
      restaurant: restaurantDetail[0],
      menuDetail,
      categories,
      diningPhotos,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getRestaurantExtraInformation = async (id) => {
  const dining = await RestaurantExtraDetail.findOne(
    { restaurant: new mongoose.Types.ObjectId(id) },
    { photos: 1, menu: 1 }
  );
  return Promise.all([dining]).then(() => {
    let menuDetail = [];
    let diningPhotos = [];
    if (dining !== null && dining.menu !== null) {
      menuDetail = dining.menu;
    }
    if (dining !== null && dining.photos !== null) {
      diningPhotos = dining.photos;
    }
    const result = {
      menuDetail,
      diningPhotos,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const updateDiningInformation = async (id, param) => {
  const restaurant = await getRestaurantById(id);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    diningCategory: param.categories,
  };
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  const query = { restaurant: new mongoose.Types.ObjectId(id) };
  const options = {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  };
  const updateData = {
    menu: param.menu,
    photos: param.photos,
  };
  await RestaurantExtraDetail.findOneAndUpdate(query, updateData, options);
  return { success: true };
};

const updateMenuAndPhotoInformation = async (id, param) => {
  const query = { restaurant: new mongoose.Types.ObjectId(id) };
  const options = {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  };
  const updateData = {
    menu: param.menu,
    photos: param.photos,
  };
  await RestaurantExtraDetail.findOneAndUpdate(query, updateData, options);
  return { success: true };
};

const getDiningByCategory = async (categorySlug, latitude, longitude, uid, options) => {
  const categoryInfo = await DiningCategory.findOne(
    { slug: categorySlug, status: true },
    { id: 1, status: 1 }
  );
  if (categoryInfo !== null && categoryInfo.id !== null && categoryInfo.status === true) {
    const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
    const limit =
      options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;
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
    const restaurantQuery = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: {
          status: true,
          temporaryClosed: false,
          diningCategory: { $in: [new mongoose.Types.ObjectId(categoryInfo.id)] },
          _id: { $nin: hiddenRestaurantsId },
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
      restaurantCuisineLookup,
      restaurantFavouriteLookup,
      restaurantFavouriteField,
      outletPromoteLookup,
      outletUnwindCollection,
      { $skip: skip },
      { $limit: Number(limit) },
      { $project: filterOptions },
    ]);

    if (restaurants !== null && restaurants.length > 0) {
      const totalCountResult = await Restaurant.aggregate([
        {
          $geoNear: {
            near: queryPoint,
            maxDistance: radiusInMeters,
            distanceField: 'distance',
            spherical: true,
            query: {
              status: true,
              temporaryClosed: false,
              diningCategory: { $in: [new mongoose.Types.ObjectId(categoryInfo.id)] },
              _id: { $nin: hiddenRestaurantsId },
            },
          },
        },
        { $count: 'total' },
      ]);
      const totalResults = totalCountResult.length ? totalCountResult[0].total : 0;
      return Promise.all([restaurants, totalCountResult]).then(() => {
        const totalPages = Math.ceil(totalResults / limit);
        const result = {
          restaurants,
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
  }
  return { success: false };
};

const globalDiningSearchInitial = async (latitude, longitude) => {
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
  const query = {
    location: {
      $near: {
        $geometry: queryPoint,
        $maxDistance: radiusInMeters,
      },
    },
    status: true,
  };
  const city = await City.findOne(query);
  const category = await DiningCategory.find({ status: true });
  return Promise.all([city, category]).then(() => {
    const result = {
      city,
      category,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const globalDiningSearch = async (latitude, longitude, searchQuery) => {
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
  const searchRegExp = RegExp(searchQuery, 'i');
  const categories = await DiningCategory.find(
    {
      $or: [
        { name: searchRegExp },
        { slug: searchRegExp },
        {
          translations: {
            $elemMatch: {
              value: { $regex: searchRegExp },
            },
          },
        },
      ],
      $and: [{ status: true }],
    },
    { id: 1, name: 1, slug: 1, image: 1, translations: 1 }
  );

  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
    },
  };

  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    logo: 1,
    cover: 1,
    translations: 1,
    status: 1,
    slug: 1,
    distance: 1,
  };

  const outletPreBookingLookup = {
    $lookup: {
      from: 'restaurants',
      localField: 'outletManagerId',
      foreignField: '_id',
      as: 'parentRestaurant',
    },
  };

  const restaurantFullQuery = [
    restaurantQuery,
    outletPreBookingLookup,
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          { preBooking: true },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [
          { status: true },
          { temporaryClosed: false },
          { 'parentRestaurant.preBooking': true },
        ],
      },
    },
    {
      $project: filterOptions,
    },
  ];

  const restaurants = await Restaurant.aggregate([restaurantFullQuery]);

  return Promise.all([categories, restaurants]).then(() => {
    const result = {
      categories,
      restaurants,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getRestaurantDetailInformation = async (latitude, longitude, slugUrl, uid) => {
  let userId;
  if (uid === null || uid === '' || uid === undefined) {
    userId = null;
  } else {
    userId = uid;
  }
  const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radius =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 10;
  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
      query: { status: true, slug: slugUrl },
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
  const restaurantTypeLookup = {
    $lookup: {
      from: 'restauranttypes',
      localField: 'restaurantType',
      foreignField: '_id',
      as: 'restauranttypes',
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
  const restaurantFacitiesLookup = {
    $lookup: {
      from: 'restaurantfacilities',
      localField: 'restaurantFacility',
      foreignField: '_id',
      as: 'restaurantfacilities',
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
    },
  };
  const restaurantDiningCategoryLookup = {
    $lookup: {
      from: 'diningcategories',
      localField: 'diningCategory',
      foreignField: '_id',
      as: 'diningcategories',
      pipeline: [
        { $match: { status: true } },
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            image: 1,
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
  const restaurantHiddenLookup = {
    $lookup: {
      from: 'hiderestaurants',
      localField: '_id',
      foreignField: 'restaurant',
      as: 'hiderestaurants',
      pipeline: [{ $match: { user: new mongoose.Types.ObjectId(userId) } }],
    },
  };
  const restaurantHiddenField = {
    $addFields: {
      isHidden: {
        $cond: {
          if: { $eq: [{ $size: '$hiderestaurants' }, 0] },
          then: false,
          else: true,
        },
      },
    },
  };
  const totalRestaurantRatingLookup = {
    $lookup: {
      from: 'restaurantorderreviews',
      localField: '_id',
      foreignField: 'restaurant',
      as: 'restaurantorderreviews',
    },
  };
  const restaurantFoodLicenseLookup = {
    $lookup: {
      from: 'restaurantfoodlicenses',
      localField: 'license',
      foreignField: '_id',
      as: 'restaurantfoodlicenses',
      pipeline: [
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            image: 1,
            website: 1,
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
  const restaurantOwnerLookup = {
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
  };
  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    logo: 1,
    cover: 1,
    approxDeliveryTime: 1,
    estimatedDeliveryTime: 1,
    dishPriceForTwo: {
      $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
    },
    translations: 1,
    slots: 1,
    rating: 1,
    totalRating: {
      $size: '$restaurantorderreviews',
    },
    restauranttypes: 1,
    restaurantfacilities: 1,
    diningcategories: 1,
    status: 1,
    slug: 1,
    cuisine: 1,
    distance: 1,
    address: 1,
    shortDescription: 1,
    isFavourite: 1,
    isHidden: 1,
    temporaryClosed: 1,
    license: {
      id: { $ifNull: ['$restaurantfoodlicenses.id', ''] },
      name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
      image: { $ifNull: ['$restaurantfoodlicenses.image', ''] },
      website: { $ifNull: ['$restaurantfoodlicenses.website', ''] },
      translations: { $ifNull: ['$restaurantfoodlicenses.translations', []] },
    },
    outletManagerId: 1,
    isOutlet: 1,
    licenseId: 1,
    tiffinSubscription: {
      $cond: {
        if: { $eq: ['$tiffinSubscription', true] },
        then: true,
        else: {
          $cond: {
            if: { $eq: ['$isOutlet', true] },
            then: { $ifNull: ['$parentRestaurant.tiffinSubscription', false] },
            else: false,
          },
        },
      },
    },
    preBooking: {
      $cond: {
        if: { $eq: ['$preBooking', true] },
        then: true,
        else: {
          $cond: {
            if: { $eq: ['$isOutlet', true] },
            then: { $ifNull: ['$parentRestaurant.preBooking', false] },
            else: false,
          },
        },
      },
    },
    createdAt: 1,
    location: 1,
    owerInfo: {
      id: { $ifNull: ['$users._id', ''] },
      firstName: { $ifNull: ['$users.firstName', ''] },
      lastName: { $ifNull: ['$users.lastName', ''] },
      image: { $ifNull: ['$users.image', ''] },
      countryCode: { $ifNull: ['$users.countryCode', ''] },
      contactNumber: { $ifNull: ['$users.contactNumber', ''] },
      contactEmail: { $ifNull: ['$users.contactEmail', ''] },
    },
    socialFacebook: { $ifNull: ['$socialFacebook', ''] },
    socialInstagram: { $ifNull: ['$socialInstagram', ''] },
    socialX: { $ifNull: ['$socialX', ''] },
    socialYoutube: { $ifNull: ['$socialYoutube', ''] },
    socialLinkedIn: { $ifNull: ['$socialLinkedIn', ''] },
    socialPinterest: { $ifNull: ['$socialPinterest', ''] },
  };
  const info = await Restaurant.aggregate([
    restaurantQuery,
    restaurantCuisineLookup,
    restaurantTypeLookup,
    restaurantFacitiesLookup,
    restaurantDiningCategoryLookup,
    outletPromoteLookup,
    outletUnwindCollection,
    restaurantOwnerLookup,
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        estimatedDeliveryTime: {
          $switch: {
            branches: [
              { case: { $lte: ['$distance', 5] }, then: 10 }, // 10 minutes for distance <= 5
              {
                case: { $and: [{ $gt: ['$distance', 5] }, { $lte: ['$distance', 10] }] },
                then: 20,
              }, // 20 minutes for 5 < distance <= 10
              {
                case: { $and: [{ $gt: ['$distance', 10] }, { $lte: ['$distance', 20] }] },
                then: 30,
              }, // 30 minutes for 10 < distance <= 20
            ],
            default: 40, // Default to 40 minutes for distance > 20
          },
        },
      },
    },
    restaurantFoodLicenseLookup,
    {
      $unwind: {
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    restaurantFavouriteLookup,
    restaurantFavouriteField,
    restaurantHiddenLookup,
    restaurantHiddenField,
    totalRestaurantRatingLookup,
    { $limit: 1 },
    { $project: filterOptions },
  ]);
  if (info !== null && info.length > 0 && info[0].slug === slugUrl) {
    const details = info[0];
    const currentDate = new Date();
    const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
    const couponNearQuery = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: { status: 'live', start: { $lte: currentDate }, expires: { $gte: currentDate } },
      },
    };
    const orderCouponFilterOptions = {
      _id: 0,
      id: '$_id',
      name: 1,
      allRestaurants: 1,
      allUsers: 1,
      code: 1,
      couponType: 1,
      discountType: 1,
      limitSameUser: {
        $round: [{ $divide: ['$limitSameUser', 100] }, 2],
      },
      loyalityPoints: {
        $round: [{ $divide: ['$loyalityPoints', 100] }, 2],
      },
      maxDiscount: {
        $round: [{ $divide: ['$maxDiscount', 100] }, 2],
      },
      minCartTotal: {
        $round: [{ $divide: ['$minCartTotal', 100] }, 2],
      },
      minDiscount: {
        $round: [{ $divide: ['$minDiscount', 100] }, 2],
      },
      restaurant: 1,
      user: 1,
      translations: 1,
    };
    const diningCouponFilterOptions = {
      _id: 0,
      id: '$_id',
      name: 1,
      allRestaurants: 1,
      allUsers: 1,
      code: 1,
      couponType: 1,
      discountType: 1,
      availability: 1,
      preBookingChargeRequired: 1,
      preBookingChargeAmount: {
        $round: [{ $divide: ['$preBookingChargeAmount', 100] }, 2],
      },
      limitSameUser: {
        $round: [{ $divide: ['$limitSameUser', 100] }, 2],
      },
      maxDiscount: {
        $round: [{ $divide: ['$maxDiscount', 100] }, 2],
      },
      minDiscount: {
        $round: [{ $divide: ['$minDiscount', 100] }, 2],
      },
      restaurant: 1,
      user: 1,
      translations: 1,
    };
    const orderCoupons = await Coupon.aggregate([
      couponNearQuery,
      { $project: orderCouponFilterOptions },
    ]);
    const diningCoupons = await DiningCoupon.aggregate([
      couponNearQuery,
      { $project: diningCouponFilterOptions },
    ]);

    const findQuery = [
      { $match: { restaurant: new mongoose.Types.ObjectId(details.id) } },
      { $sort: { createdAt: -1 } },
      { $limit: Number(10) },
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
    const dining = await RestaurantExtraDetail.findOne(
      { restaurant: new mongoose.Types.ObjectId(details.id) },
      { photos: 1, menu: 1 }
    );
    const reviews = await RestaurantOrderReview.aggregate(findQuery);
    const bestFoodIDQuery = [
      {
        $match: {
          restaurant: details.id,
        },
      },
      { $unwind: '$foods' },
      { $group: { _id: '$foods', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ];
    const bestFoodIds = await Orders.aggregate(bestFoodIDQuery);
    const bestFoodIdsArray = bestFoodIds.map((food) => food._id);

    const bestFoodQuery = [
      {
        $match: {
          _id: {
            $in: bestFoodIdsArray,
          },
          status: 'live',
          inStock: true,
        },
      },
      { $limit: 10 },
      { $sort: { rating: -1 } },
      {
        $project: {
          _id: 0,
          id: '$_id',
          name: 1,
          translations: 1,
        },
      },
    ];
    const bestFoods = await Food.aggregate(bestFoodQuery);
    return Promise.all([
      info,
      findMode,
      orderCoupons,
      diningCoupons,
      reviews,
      dining,
      bestFoods,
    ]).then(() => {
      let menuDetail = [];
      let diningPhotos = [];
      if (dining !== null && dining.menu !== null) {
        menuDetail = dining.menu;
      }
      if (dining !== null && dining.photos !== null) {
        diningPhotos = dining.photos;
      }
      const result = {
        details,
        orderCoupons,
        diningCoupons,
        reviews,
        findMode,
        menuDetail,
        diningPhotos,
        bestFoods,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getDiningBookingInformation = async (latitude, longitude, slugUrl, restaurantId) => {
  const matchQuery = {
    $match: {
      slug: slugUrl,
    },
  };
  const restaurantOwnerLookup = {
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
  };
  const outletPromoteLookup = {
    $lookup: {
      from: 'restaurants',
      localField: 'outletManagerId',
      foreignField: '_id',
      as: 'parentRestaurant',
    },
  };
  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    logo: 1,
    cover: 1,
    address: 1,
    slug: 1,
    location: 1,
    dishPriceForTwo: {
      $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
    },
    preBooking: {
      $cond: {
        if: { $eq: ['$preBooking', true] },
        then: true,
        else: {
          $cond: {
            if: { $eq: ['$isOutlet', true] },
            then: {
              $cond: {
                if: { $ifNull: ['$parentRestaurant.preBooking', false] },
                then: true,
                else: false,
              },
            },
            else: false,
          },
        },
      },
    },
    translations: 1,
    owerInfo: {
      id: { $ifNull: ['$users._id', ''] },
      firstName: { $ifNull: ['$users.firstName', ''] },
      lastName: { $ifNull: ['$users.lastName', ''] },
      image: { $ifNull: ['$users.image', ''] },
      countryCode: { $ifNull: ['$users.countryCode', ''] },
      contactNumber: { $ifNull: ['$users.contactNumber', ''] },
      contactEmail: { $ifNull: ['$users.contactEmail', ''] },
    },
  };
  const info = await Restaurant.aggregate([
    matchQuery,
    outletPromoteLookup,
    restaurantOwnerLookup,
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $limit: 1 },
    { $project: filterOptions },
  ]);
  if (info !== null && info.length > 0 && info[0].slug === slugUrl) {
    const details = info[0];
    const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };
    const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
    const findMode =
      businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
        ? businessSettings.findMode
        : 'km';
    const radius =
      businessSettings &&
      businessSettings.deliveryArea !== null &&
      businessSettings.deliveryArea !== ''
        ? businessSettings.deliveryArea
        : 10;
    const currentDate = new Date();
    const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
    const couponNearQuery = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: {
          status: 'live',
          start: { $lte: currentDate },
          expires: { $gte: currentDate },
          $or: [
            { allRestaurants: true },
            { restaurant: { $in: [new mongoose.Types.ObjectId(restaurantId)] } },
          ],
        },
      },
    };
    const diningCouponFilterOptions = {
      _id: 0,
      id: '$_id',
      name: 1,
      allRestaurants: 1,
      allUsers: 1,
      code: 1,
      couponType: 1,
      discountType: 1,
      availability: 1,
      preBookingChargeRequired: 1,
      preBookingChargeAmount: {
        $round: [{ $divide: ['$preBookingChargeAmount', 100] }, 2],
      },
      limitSameUser: {
        $round: [{ $divide: ['$limitSameUser', 100] }, 2],
      },
      maxDiscount: {
        $round: [{ $divide: ['$maxDiscount', 100] }, 2],
      },
      minDiscount: {
        $round: [{ $divide: ['$minDiscount', 100] }, 2],
      },
      restaurant: 1,
      user: 1,
      translations: 1,
    };
    const diningCoupons = await DiningCoupon.aggregate([
      couponNearQuery,
      { $project: diningCouponFilterOptions },
    ]);
    const dinnigSetting = await DiningSetting.findOne(
      {},
      { minBookingCharge: 1, preBookingChargeRequired: 1, guestBooking: 1 }
    );
    const dining = await RestaurantExtraDetail.findOne(
      { restaurant: new mongoose.Types.ObjectId(details.id) },
      { photos: 1, menu: 1, slots: 1, guestAvailability: 1 }
    );
    return Promise.all([info, dining, dinnigSetting, diningCoupons]).then(() => {
      let slots = [];
      let guestAvailability = [];
      if (dining !== null && dining.slots !== null) {
        slots = dining.slots;
      }
      if (dining !== null && dining.guestAvailability !== null) {
        guestAvailability = dining.guestAvailability;
      }

      const result = {
        details,
        slots,
        guestAvailability,
        dinnigSetting,
        diningCoupons,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getDiningBookingConfirmInformation = async (slugUrl, userId, couponId) => {
  const restaurant = await Restaurant.findOne(
    { slug: slugUrl },
    { name: 1, address: 1, translations: 1 }
  );
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const notices = await DiningtNotice.find({ status: true });
  const dinnigSetting = await DiningSetting.findOne(
    {},
    { minBookingCharge: 1, preBookingChargeRequired: 1, guestBooking: 1 }
  );
  let chargeRequired = false;
  if (
    dinnigSetting !== null &&
    dinnigSetting.preBookingChargeRequired !== null &&
    dinnigSetting.preBookingChargeRequired === true
  ) {
    chargeRequired = true;
  }

  let coupon = null;
  let user = null;
  if (couponId != null && couponId !== '') {
    coupon = await DiningCoupon.findById(couponId, {
      name: 1,
      code: 1,
      discountType: 1,
      minDiscount: 1,
      maxDiscount: 1,
      preBookingChargeRequired: 1,
      preBookingChargeAmount: 1,
      translations: 1,
    });
  }
  if (
    coupon !== null &&
    coupon.preBookingChargeRequired !== null &&
    coupon.preBookingChargeRequired === true
  ) {
    chargeRequired = true;
  }
  let paymentSettings = [];
  let defaultPayment = null;
  if (chargeRequired) {
    paymentSettings = await PaymentConfig.find(
      { status: true, paymentWay: 'online' },
      { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
    );
    defaultPayment = await PaymentConfig.findOne(
      { isDefault: true, status: true, paymentWay: 'online' },
      { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
    );
  }

  if (userId != null && userId !== '') {
    user = await User.findById(userId, {
      firstName: 1,
      lastName: 1,
      countryCode: 1,
      mobile: 1,
      email: 1,
    });
  }
  return Promise.all([
    restaurant,
    notices,
    coupon,
    user,
    dinnigSetting,
    paymentSettings,
    defaultPayment,
  ]).then(() => {
    const result = {
      restaurant,
      notices,
      coupon,
      user,
      dinnigSetting,
      payments: paymentSettings,
      primary: defaultPayment,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const fetchResturantPhoneNumber = async (restaurantId) => {
  const filterOptions = {
    _id: 0,
    id: '$_id',
    contactInfo: {
      countryCode: { $ifNull: ['$users.countryCode', ''] },
      contactNumber: { $ifNull: ['$users.mobile', ''] },
    },
  };
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(restaurantId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
    { $project: filterOptions },
  ];
  const info = await Restaurant.aggregate(query);
  if (checkArrayNotEmpty(info)) {
    return { success: true, detail: info[0] };
  }
  return { success: false };
};

const getRestaurantInfoForDirectReview = async (restaurantId) => {
  const restaurantInfo = await Restaurant.findById(restaurantId, {
    address: 1,
    cover: 1,
    logo: 1,
    name: 1,
    slug: 1,
    translations: 1,
  });
  if (!restaurantInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const messages = await OrderRatingMessages.find({ status: true, type: 'restaurant' });
  const orderSettings = await OrderSettings.findOne({}, { ratingStyle: 1 });
  return Promise.all([restaurantInfo, messages, orderSettings]).then(() => {
    const result = {
      info: restaurantInfo,
      messages,
      orderSettings,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const globalRestaurantSearchForReview = async (searchQuery) => {
  const searchRegExp = RegExp(searchQuery, 'i');
  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    logo: 1,
    cover: 1,
    translations: 1,
    status: 1,
    slug: 1,
  };
  const restaurantFullQuery = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: true }, { temporaryClosed: false }],
      },
    },
    {
      $project: filterOptions,
    },
  ];

  const restaurants = await Restaurant.aggregate([restaurantFullQuery]);
  return Promise.all([restaurants]).then(() => {
    const result = {
      restaurants,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getRestaurantLoginResponse = async (id) => {
  const restaurantInfo = await Restaurant.findOne(
    { userId: new mongoose.Types.ObjectId(id) },
    { name: 1, address: 1, rating: 1, logo: 1 }
  );
  return restaurantInfo;
};

const getRestaurantDetailForUpdateApp = async (id) => {
  const query = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    {
      $lookup: {
        from: 'restauranttypes',
        localField: 'restaurantType',
        foreignField: '_id',
        as: 'restauranttypes',
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
        from: 'restaurantfacilities',
        localField: 'restaurantFacility',
        foreignField: '_id',
        as: 'restaurantfacilities',
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
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        address: 1,
        logo: 1,
        cover: 1,
        approxDeliveryTime: 1,
        dishPriceForTwo: {
          $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
        },
        pureVeg: 1,
        license: 1,
        licenseId: 1,
        takeAway: 1,
        acceptHomeDelivery: 1,
        acceptScheduleDelivery: 1,
        minOrderAmount: { $round: [{ $divide: ['$minOrderAmount', 100] }, 2] },
        shortDescription: 1,
        restauranttypes: 1,
        cuisine: 1,
        restaurantfacilities: 1,
        socialFacebook: { $ifNull: ['$socialFacebook', ''] },
        socialInstagram: { $ifNull: ['$socialInstagram', ''] },
        socialX: { $ifNull: ['$socialX', ''] },
        socialYoutube: { $ifNull: ['$socialYoutube', ''] },
        socialLinkedIn: { $ifNull: ['$socialLinkedIn', ''] },
        socialPinterest: { $ifNull: ['$socialPinterest', ''] },
        translations: 1,
      },
    },
  ];
  const restaurant = await Restaurant.aggregate(query);
  if (!restaurant || !checkArrayNotEmpty(restaurant)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const details = restaurant[0];
  const license = await RestaurantFoodLicense.find(
    { status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return Promise.all([details, license]).then(() => {
    const result = {
      details,
      license,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const updateRestaurantDetail = async (id, param) => {
  const restaurant = await getRestaurantById(id);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    name: param.name,
    address: param.address,
    shortDescription: param.shortDescription,
    cuisine: param.cuisine,
    logo: param.logo,
    cover: param.cover,
    approxDeliveryTime: param.deliveryTime,
    dishPriceForTwo: param.dishPriceForTwo,
    takeAway: param.takeaway,
    translations: param.translations,
    restaurantType: param.type,
    restaurantFacility: param.facility,
    acceptScheduleDelivery: param.scheduleOrder,
    acceptHomeDelivery: param.homeDelivery,
    minOrderAmount: param.minOrderAmount,
    license: param && param.license !== '' ? param.license : null,
    licenseId: param.licenseId,
    socialFacebook:
      param && param.socialFacebook && param.socialFacebook !== '' && param.socialFacebook !== null
        ? param.socialFacebook
        : '',
    socialInstagram:
      param &&
      param.socialInstagram &&
      param.socialInstagram !== '' &&
      param.socialInstagram !== null
        ? param.socialInstagram
        : '',
    socialX:
      param && param.socialX && param.socialX !== '' && param.socialX !== null ? param.socialX : '',
    socialYoutube:
      param && param.socialYoutube && param.socialYoutube !== '' && param.socialYoutube !== null
        ? param.socialYoutube
        : '',
    socialLinkedIn:
      param && param.socialLinkedIn && param.socialLinkedIn !== '' && param.socialLinkedIn !== null
        ? param.socialLinkedIn
        : '',
    socialPinterest:
      param &&
      param.socialPinterest &&
      param.socialPinterest !== '' &&
      param.socialPinterest !== null
        ? param.socialPinterest
        : '',
  };
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  return { success: true };
};

const getOutletPermission = async (id) => {
  const info = await Restaurant.findById(id, { orderLimit: 1, productLimit: 1, multiOutlet: 1 });
  if (!info) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return info;
};

const getOutletDetailForApp = async (id, vendorId) => {
  const results = await Restaurant.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
        outletManagerId: new mongoose.Types.ObjectId(vendorId),
      },
    },
    { $limit: 1 },
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
        from: 'restaurantfacilities',
        localField: 'restaurantFacility',
        foreignField: '_id',
        as: 'restaurantfacilities',
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
        from: 'restauranttypes',
        localField: 'restaurantType',
        foreignField: '_id',
        as: 'restauranttypes',
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        address: 1,
        city: 1,
        locality: 1,
        location: 1,
        approxDeliveryTime: 1,
        dishPriceForTwo: {
          $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
        },
        translations: 1,
        license: 1,
        licenseId: 1,
        takeAway: 1,
        acceptHomeDelivery: 1,
        acceptScheduleDelivery: 1,
        minOrderAmount: {
          $round: [{ $divide: ['$minOrderAmount', 100] }, 2],
        },
        shortDescription: 1,
        logo: 1,
        cover: 1,
        cuisine: 1,
        restaurantfacilities: 1,
        restauranttypes: 1,
        socialFacebook: { $ifNull: ['$socialFacebook', ''] },
        socialInstagram: { $ifNull: ['$socialInstagram', ''] },
        socialX: { $ifNull: ['$socialX', ''] },
        socialYoutube: { $ifNull: ['$socialYoutube', ''] },
        socialLinkedIn: { $ifNull: ['$socialLinkedIn', ''] },
        socialPinterest: { $ifNull: ['$socialPinterest', ''] },
      },
    },
  ]);
  if (!results[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantInfo = results[0];
  return restaurantInfo;
};

const closeTemporaryRestaurant = async (vendorId) => {
  const restaurant = await getRestaurantById(vendorId);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    temporaryClosed: true,
  };
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  return { success: true };
};

const reOpenTemporaryRestaurant = async (vendorId) => {
  const restaurant = await getRestaurantById(vendorId);
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const restaurantData = {
    temporaryClosed: false,
  };
  Object.assign(restaurant, restaurantData);
  await restaurant.save();
  return { success: true };
};

const addMoneyToWalletAfterDelivery = async (totalEarning, vendorId, orderId) => {
  const restaurant = await getRestaurantById(vendorId);
  if (restaurant && restaurant !== null) {
    const orderInfo = await Orders.findOne(
      {
        _id: new mongoose.Types.ObjectId(orderId),
        restaurant: new mongoose.Types.ObjectId(vendorId),
      },
      { restaurantCommission: 1 }
    );
    if (orderInfo && orderInfo !== null) {
      const walletInfo = await Wallet.findOne({
        holderId: new mongoose.Types.ObjectId(restaurant.userId),
      });
      const adminCommission = orderInfo.restaurantCommission;
      const earningAfterCommission = parseFloat(
        parseFloat(totalEarning) - parseFloat(adminCommission)
      ).toFixed(2);
      if (walletInfo !== null && walletInfo.id !== null) {
        const oldBalance = walletInfo.balance;
        const userWalletId = walletInfo.id;
        const newBalance = parseFloat(
          parseFloat(oldBalance) + parseFloat(earningAfterCommission)
        ).toFixed(2);
        Object.assign(walletInfo, { balance: newBalance });
        await walletInfo.save();
        const transactionBody = {
          payableId: restaurant.userId,
          walletId: userWalletId,
          type: 'deposite',
          amount: earningAfterCommission,
          confirmed: true,
          meta: [{ reason: `Order Earning From #${orderId}` }],
          status: true,
        };
        await Transactions.create(transactionBody);
      }
    }
  }
};

const restaurantWalletDetail = async (vendorId) => {
  const restaurant = await Restaurant.findById(vendorId, { userId: 1 });
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const walletInfo = await Wallet.findOne(
    { holderId: new mongoose.Types.ObjectId(restaurant.userId) },
    { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
  );
  const totalDeliveredOrderEarningQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendorId), status: 'delivered' } },
    {
      $group: {
        _id: null,
        itemTotalSum: { $sum: '$itemTotal' },
        packageChargeSum: { $sum: '$packageCharge' },
        packageChargeTaxSum: { $sum: '$packageChargeTax' },
      },
    },
    {
      $project: {
        _id: 0,
        itemTotal: { $round: [{ $divide: ['$itemTotalSum', 100] }, 2] },
        packageCharge: { $round: [{ $divide: ['$packageChargeSum', 100] }, 2] },
        packageChargeTax: { $round: [{ $divide: ['$packageChargeTaxSum', 100] }, 2] },
      },
    },
  ];
  const posAndTableOrderEarningQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendorId) } },
    {
      $group: {
        _id: null,
        itemTotalSum: { $sum: '$itemTotal' },
        packageChargeSum: { $sum: '$packageCharge' },
        packageChargeTaxSum: { $sum: '$packageChargeTax' },
      },
    },
    {
      $project: {
        _id: 0,
        itemTotal: { $round: [{ $divide: ['$itemTotalSum', 100] }, 2] },
        packageCharge: { $round: [{ $divide: ['$packageChargeSum', 100] }, 2] },
        packageChargeTax: { $round: [{ $divide: ['$packageChargeTaxSum', 100] }, 2] },
      },
    },
  ];
  const totalCompletedDiningBookingEarningQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendorId), status: 'completed' } },
    {
      $group: {
        _id: null,
        diningGrandTotalBillAmount: { $sum: '$diningGrandTotalBillAmount' },
      },
    },
    {
      $project: {
        _id: 0,
        diningGrandTotalBillAmount: {
          $round: [{ $divide: ['$diningGrandTotalBillAmount', 100] }, 2],
        },
      },
    },
  ];
  const totalDeliveredOrderEarning = await Orders.aggregate(totalDeliveredOrderEarningQuery);
  const posOrderEarning = await PosOrTableOrder.aggregate(posAndTableOrderEarningQuery);
  const tableOrderEarning = await TableOrder.aggregate(posAndTableOrderEarningQuery);
  const diningBookingEarning = await DiningBooking.aggregate(
    totalCompletedDiningBookingEarningQuery
  );
  const cashInHandQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendorId), status: true } },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        inHandAmount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ];
  const posAndTableOrderCommissionQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendorId), status: true } },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$totalEarning' },
      },
    },
    {
      $project: {
        _id: 0,
        commission: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ];
  let orderEarningAmount = 0;
  let posEarningAmount = 0;
  let tableOrderEarningAmount = 0;
  let diningBookingEarningAmount = 0;
  if (
    totalDeliveredOrderEarning !== null &&
    totalDeliveredOrderEarning.length > 0 &&
    checkArrayNotEmpty(totalDeliveredOrderEarning)
  ) {
    const itemTotal = parseFloat(totalDeliveredOrderEarning[0].itemTotal);
    const packageCharge = parseFloat(totalDeliveredOrderEarning[0].packageCharge);
    const packageChargeTax = parseFloat(totalDeliveredOrderEarning[0].packageChargeTax);
    orderEarningAmount = parseFloat(
      parseFloat(itemTotal) + parseFloat(packageCharge) + parseFloat(packageChargeTax)
    ).toFixed(2);
  }

  if (
    posOrderEarning !== null &&
    posOrderEarning.length > 0 &&
    checkArrayNotEmpty(posOrderEarning)
  ) {
    const itemTotal = parseFloat(posOrderEarning[0].itemTotal);
    const packageCharge = parseFloat(posOrderEarning[0].packageCharge);
    const packageChargeTax = parseFloat(posOrderEarning[0].packageChargeTax);
    posEarningAmount = parseFloat(
      parseFloat(itemTotal) + parseFloat(packageCharge) + parseFloat(packageChargeTax)
    ).toFixed(2);
  }

  if (
    tableOrderEarning !== null &&
    tableOrderEarning.length > 0 &&
    checkArrayNotEmpty(tableOrderEarning)
  ) {
    const itemTotal = parseFloat(tableOrderEarning[0].itemTotal);
    const packageCharge = parseFloat(tableOrderEarning[0].packageCharge);
    const packageChargeTax = parseFloat(tableOrderEarning[0].packageChargeTax);
    tableOrderEarningAmount = parseFloat(
      parseFloat(itemTotal) + parseFloat(packageCharge) + parseFloat(packageChargeTax)
    ).toFixed(2);
  }

  if (
    diningBookingEarning !== null &&
    diningBookingEarning.length > 0 &&
    checkArrayNotEmpty(diningBookingEarning)
  ) {
    const diningGrandTotalBillAmount = parseFloat(
      diningBookingEarning[0].diningGrandTotalBillAmount
    );
    diningBookingEarningAmount = diningGrandTotalBillAmount;
  }

  const totalEarning = parseFloat(
    parseFloat(orderEarningAmount) +
      parseFloat(posEarningAmount) +
      parseFloat(tableOrderEarningAmount) +
      parseFloat(diningBookingEarningAmount)
  ).toFixed(2);
  const totalCashInHand = await RestaurantCashInHand.aggregate(cashInHandQuery);
  const posAndTableOrderCommission = await RestaurantPosTableOrderCommission.aggregate(
    posAndTableOrderCommissionQuery
  );
  let orderEarningCashInHand = 0;
  if (
    totalCashInHand !== null &&
    totalCashInHand.length > 0 &&
    checkArrayNotEmpty(totalCashInHand)
  ) {
    orderEarningCashInHand = parseFloat(totalCashInHand[0].inHandAmount);
  }
  let posAndTableOrderCommissionAmount = 0;
  if (
    posAndTableOrderCommission !== null &&
    posAndTableOrderCommission.length > 0 &&
    checkArrayNotEmpty(posAndTableOrderCommission)
  ) {
    posAndTableOrderCommissionAmount = parseFloat(posAndTableOrderCommission[0].commission);
  }
  const inHandAmount = parseFloat(
    parseFloat(orderEarningCashInHand) + parseFloat(posAndTableOrderCommissionAmount)
  ).toFixed(2);
  const withdrawnQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendorId),
        from: 'restaurant',
        status: 'accepted',
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
      },
    },
    {
      $project: {
        _id: 0,
        withdrawn: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ];
  const withdrawn = await WithdrawalRequest.aggregate(withdrawnQuery);
  let withdrawnAmount = 0;
  if (withdrawn !== null && checkArrayNotEmpty(withdrawn)) {
    withdrawnAmount = parseFloat(withdrawn[0].withdrawn);
  }
  const orderRefundQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendorId),
        $or: [{ status: 'refunded' }, { status: 'partially_refunded' }],
      },
    },
    {
      $group: {
        _id: null,
        itemTotalSum: { $sum: '$itemTotal' },
        packageChargeSum: { $sum: '$packageCharge' },
        packageChargeTaxSum: { $sum: '$packageChargeTax' },
      },
    },
    {
      $project: {
        _id: 0,
        itemTotal: { $round: [{ $divide: ['$itemTotalSum', 100] }, 2] },
        packageCharge: { $round: [{ $divide: ['$packageChargeSum', 100] }, 2] },
        packageChargeTax: { $round: [{ $divide: ['$packageChargeTaxSum', 100] }, 2] },
      },
    },
  ];
  const diningRefundQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendorId),
        $or: [{ status: 'refunded' }, { status: 'partially_refunded' }],
      },
    },
    {
      $group: {
        _id: null,
        itemTotalSum: { $sum: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        itemTotal: { $round: [{ $divide: ['$itemTotalSum', 100] }, 2] },
      },
    },
  ];
  const orderRefund = await Orders.aggregate(orderRefundQuery);
  const tiffinRefund = await UserPurchasedTiffinSubscription.aggregate(orderRefundQuery);
  const diningRefund = await DiningBooking.aggregate(diningRefundQuery);
  let orderRefundAmount = 0;
  if (orderRefund !== null && orderRefund.length > 0 && checkArrayNotEmpty(orderRefund)) {
    const itemTotal = parseFloat(orderRefund[0].itemTotal);
    const packageCharge = parseFloat(orderRefund[0].packageCharge);
    const packageChargeTax = parseFloat(orderRefund[0].packageChargeTax);
    const amountNumber = parseFloat(
      parseFloat(itemTotal) + parseFloat(packageCharge) + parseFloat(packageChargeTax)
    );
    orderRefundAmount = amountNumber;
  }
  let tiffinRefundAmount = 0;
  if (tiffinRefund !== null && tiffinRefund.length > 0 && checkArrayNotEmpty(tiffinRefund)) {
    const itemTotal = parseFloat(tiffinRefund[0].itemTotal);
    const packageCharge = parseFloat(tiffinRefund[0].packageCharge);
    const packageChargeTax = parseFloat(tiffinRefund[0].packageChargeTax);
    const amountNumber = parseFloat(
      parseFloat(itemTotal) + parseFloat(packageCharge) + parseFloat(packageChargeTax)
    );
    tiffinRefundAmount = amountNumber;
  }
  let bookingRefundAmount = 0;
  if (diningRefund !== null && diningRefund.length > 0 && checkArrayNotEmpty(diningRefund)) {
    const amountNumber = parseFloat(diningRefund[0].itemTotal);
    bookingRefundAmount = amountNumber;
  }
  return Promise.all([
    restaurant,
    walletInfo,
    totalDeliveredOrderEarning,
    posOrderEarning,
    tableOrderEarning,
    totalCashInHand,
    posAndTableOrderCommission,
    withdrawn,
    diningBookingEarning,
    orderRefund,
    tiffinRefund,
    diningRefund,
  ]).then(() => {
    const result = {
      walletInfo,
      inHandAmount,
      totalEarning,
      withdrawnAmount,
      orderEarningAmount,
      posEarningAmount,
      tableOrderEarningAmount,
      diningBookingEarningAmount,
      orderRefundAmount,
      tiffinRefundAmount,
      bookingRefundAmount,
    };
    return Promise.resolve(result);
  });
};

const getPosData = async (vendor) => {
  const queryMainCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
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
            shortDescription: '$shortDescription',
            image: '$image',
            foodType: '$foodType',
            startTime: '$startTime',
            endTime: '$endTime',
            discountType: '$discountType',
            purchaseLimit: '$purchaseLimit',
            variations: '$variations',
            translations: '$translations',
            status: '$status',
            inStock: '$inStock',
            stockType: '$stockType',
            stockNumber: '$stockNumber',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            discount: {
              $round: [{ $divide: ['$discount', 100] }, 2],
            },
            addons: '$addons',
            foodtaxations: '$foodtaxations',
            taxationEnable: '$taxationEnable',
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
        restaurant: new mongoose.Types.ObjectId(vendor),
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
            shortDescription: '$shortDescription',
            image: '$image',
            foodType: '$foodType',
            startTime: '$startTime',
            endTime: '$endTime',
            discountType: '$discountType',
            purchaseLimit: '$purchaseLimit',
            variations: '$variations',
            translations: '$translations',
            status: '$status',
            inStock: '$inStock',
            stockType: '$stockType',
            stockNumber: '$stockNumber',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            discount: {
              $round: [{ $divide: ['$discount', 100] }, 2],
            },
            addons: '$addons',
            foodtaxations: '$foodtaxations',
            taxationEnable: '$taxationEnable',
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
  const main = await Food.aggregate(queryMainCategories);
  const custom = await Food.aggregate(queryCustomCategories);
  return Promise.all([main, custom]).then(() => {
    const result = {
      main,
      custom,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getPosDataWeb = async (vendor) => {
  const queryMainCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
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
      $group: {
        _id: '$categories._id',
        categories: {
          $first: '$categories',
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
      },
    },
  ];
  const queryCustomCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
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
      },
    },
  ];
  const main = await Food.aggregate(queryMainCategories);
  const custom = await Food.aggregate(queryCustomCategories);
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  return Promise.all([main, custom, businessSettings, restaurantSettings]).then(() => {
    const result = {
      categories: {
        category: main,
        own: custom,
      },
      business: businessSettings,
      packaging: restaurantSettings,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getPosFoodDataWeb = async (vendor, kind, category) => {
  let matchQuery = {};
  if (kind === 'all') {
    matchQuery = {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        status: 'live',
        inStock: true,
      },
    };
  } else if (kind === 'main') {
    matchQuery = {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        category: new mongoose.Types.ObjectId(category),
        ownCategory: false,
        status: 'live',
        inStock: true,
      },
    };
  } else if (kind === 'custom') {
    matchQuery = {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        customCategory: new mongoose.Types.ObjectId(category),
        ownCategory: true,
        status: 'live',
        inStock: true,
      },
    };
  }
  const foodQuery = [
    matchQuery,
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        addons: 1,
        foodtaxations: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
      },
    },
  ];
  const products = await Food.aggregate(foodQuery);
  return Promise.all([products]).then(() => {
    const result = {
      products,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const posFoodSearchInitialData = async (vendor) => {
  const foodQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        status: 'live',
        inStock: true,
      },
    },
    { $sort: { rating: -1 } },
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        addons: 1,
        foodtaxations: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
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

const posFoodSearch = async (vendor, searchQuery) => {
  const searchRegExp = RegExp(searchQuery, 'i');
  const foodQuery = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ inStock: true, restaurant: new mongoose.Types.ObjectId(vendor), status: 'live' }],
      },
    },
    { $sort: { rating: -1 } },
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        addons: 1,
        foodtaxations: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
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

const checkPosPermissionOfRestaurant = async (vendor) => {
  const restaurantInfo = await Restaurant.findOne({ _id: new mongoose.Types.ObjectId(vendor) });
  let posPermission = false;
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId, { pos: 1 });
    if (outletManager !== null && outletManager.id !== null) {
      posPermission = outletManager.pos;
    }
  } else {
    posPermission = restaurantInfo.pos;
  }
  return { posPermission };
};

const checkTableOrderPermission = async (vendor) => {
  const restaurantInfo = await Restaurant.findOne({ _id: new mongoose.Types.ObjectId(vendor) });
  let tableOrderPermission = false;
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId, {
      tableOrder: 1,
    });
    if (outletManager !== null && outletManager.id !== null) {
      tableOrderPermission = outletManager.tableOrder;
    }
  } else {
    tableOrderPermission = restaurantInfo.tableOrder;
  }
  return { tableOrderPermission };
};

const waiterFoodList = async (vendor) => {
  const queryMainCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
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
            shortDescription: '$shortDescription',
            image: '$image',
            foodType: '$foodType',
            startTime: '$startTime',
            endTime: '$endTime',
            discountType: '$discountType',
            purchaseLimit: '$purchaseLimit',
            variations: '$variations',
            translations: '$translations',
            status: '$status',
            inStock: '$inStock',
            stockType: '$stockType',
            stockNumber: '$stockNumber',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            discount: {
              $round: [{ $divide: ['$discount', 100] }, 2],
            },
            addons: '$addons',
            foodtaxations: '$foodtaxations',
            taxationEnable: '$taxationEnable',
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
        restaurant: new mongoose.Types.ObjectId(vendor),
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
            shortDescription: '$shortDescription',
            image: '$image',
            foodType: '$foodType',
            startTime: '$startTime',
            endTime: '$endTime',
            discountType: '$discountType',
            purchaseLimit: '$purchaseLimit',
            variations: '$variations',
            translations: '$translations',
            status: '$status',
            inStock: '$inStock',
            stockType: '$stockType',
            stockNumber: '$stockNumber',
            price: {
              $round: [{ $divide: ['$price', 100] }, 2],
            },
            discount: {
              $round: [{ $divide: ['$discount', 100] }, 2],
            },
            addons: '$addons',
            foodtaxations: '$foodtaxations',
            taxationEnable: '$taxationEnable',
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
  const main = await Food.aggregate(queryMainCategories);
  const custom = await Food.aggregate(queryCustomCategories);
  return Promise.all([main, custom]).then(() => {
    const result = {
      main,
      custom,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const waiterFoodSearchInitialData = async (vendor) => {
  const foodQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        status: 'live',
        inStock: true,
      },
    },
    { $sort: { rating: -1 } },
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        addons: 1,
        foodtaxations: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
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

const waiterFoodSearch = async (vendor, searchQuery) => {
  const searchRegExp = RegExp(searchQuery, 'i');
  const foodQuery = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ inStock: true, restaurant: new mongoose.Types.ObjectId(vendor), status: 'live' }],
      },
    },
    { $sort: { rating: -1 } },
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        addons: 1,
        foodtaxations: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
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

const blockExpiredSubscriptionRestaurants = async (restaurantIds) => {
  if (checkArrayNotEmpty(restaurantIds)) {
    const restaurantObjectId = restaurantIds.map((id) => new mongoose.Types.ObjectId(id));
    await Restaurant.updateMany(
      { _id: { $in: restaurantObjectId } },
      { $set: { status: false, temporaryClosed: true } }
    );
    const restaurantUserIdArray = await Restaurant.find(
      {
        _id: { $in: restaurantObjectId },
      },
      { userId: 1 }
    );
    const restaurantUserId = restaurantUserIdArray.map((x) => x.userId);
    await User.updateMany({ _id: { $in: restaurantUserId } }, { $set: { status: false } });
    const restaurantOutletIdArray = await Restaurant.find(
      { outletManagerId: { $in: restaurantObjectId }, isOutlet: true },
      { userId: 1 }
    );
    const restaurantOutletId = restaurantOutletIdArray.map((x) => x._id);
    const restaurantOutletUserId = restaurantOutletIdArray.map((x) => x.userId);
    await Restaurant.updateMany(
      { _id: { $in: restaurantOutletId } },
      { $set: { status: false, temporaryClosed: true } }
    );
    await User.updateMany({ _id: { $in: restaurantOutletUserId } }, { $set: { status: false } });
    // const userIdOfBlockedAccount = restaurantUserId.concat(restaurantOutletUserId); /// for all the restaurants including outlet
    const userIdOfBlockedAccount = restaurantUserId;
    const userBlockedEmailIdArray = await User.find(
      { _id: { $in: userIdOfBlockedAccount } },
      { email: 1 }
    );
    const userBlockedEmailId = userBlockedEmailIdArray.map((x) => x.email);
    if (checkArrayNotEmpty(userBlockedEmailId)) {
      // TODO LIVE ///
      // await emailConfigService.sendExpiredPackageBlockedEmail(userBlockedEmailId.join(','));
      // TODO LIVE ///
    }
  }
};

const getExpiringSoonRestaurants = async (restaurantIds) => {
  if (checkArrayNotEmpty(restaurantIds)) {
    const restaurantObjectId = restaurantIds.map((id) => new mongoose.Types.ObjectId(id));
    const restaurantUserIdArray = await Restaurant.find(
      {
        _id: { $in: restaurantObjectId },
      },
      { userId: 1 }
    );
    const restaurantUserId = restaurantUserIdArray.map((x) => x.userId);
    const restaurantEmailAddressToSendWarningArray = await User.find(
      { _id: { $in: restaurantUserId } },
      { email: 1 }
    );
    const restaurantEmailAddressToSendWarning = restaurantEmailAddressToSendWarningArray.map(
      (x) => x.email
    );
    if (checkArrayNotEmpty(restaurantEmailAddressToSendWarning)) {
      // TODO LIVE ///
      // await emailConfigService.sendSubscriptionExpiringSoonEmail(restaurantEmailAddressToSendWarning);
      // TODO LIVE ///
    }
  }
};

const getVendorSubscriptionStatus = async (vendor) => {
  const currentDateRange = new Date();
  currentDateRange.setHours(0, 0, 0, 0);
  const nextThreeDays = new Date();
  nextThreeDays.setDate(nextThreeDays.getDate() + 3); // For Next Three Days
  nextThreeDays.setHours(23, 59, 59, 999);
  const expiringSoon = await Subscriber.aggregate([
    {
      $match: {
        $or: [
          {
            trialEndDate: {
              $gte: currentDateRange,
              $lte: nextThreeDays,
            },
          },
          {
            endDate: {
              $gte: currentDateRange,
              $lte: nextThreeDays,
            },
          },
        ],
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'subscriptions',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        trialEndDate: 1,
        endDate: 1,
        subscriptionInfo: {
          name: { $ifNull: ['$subscriptions.name', ''] },
          translations: { $ifNull: ['$subscriptions.translations', []] },
        },
      },
    },
  ]);
  const subscriptionInfo = { expiring: false, name: '', date: '', translations: [] };
  if (checkArrayNotEmpty(expiringSoon)) {
    subscriptionInfo.expiring = true;
    const detail = expiringSoon[0];
    if (
      detail &&
      detail.subscriptionInfo &&
      detail.subscriptionInfo.name &&
      detail.subscriptionInfo.name != null
    ) {
      subscriptionInfo.name = detail.subscriptionInfo.name;
    }
    if (
      detail &&
      detail.trialEndDate &&
      detail.trialEndDate !== null &&
      detail.trialEndDate !== ''
    ) {
      subscriptionInfo.date = detail.trialEndDate;
    }
    if (detail && detail.endDate && detail.endDate !== null && detail.endDate !== '') {
      subscriptionInfo.date = detail.endDate;
    }
    if (
      detail &&
      detail.subscriptionInfo &&
      detail.subscriptionInfo.translations &&
      detail.subscriptionInfo.translations != null
    ) {
      subscriptionInfo.translations = detail.subscriptionInfo.translations;
    }
  }
  return subscriptionInfo;
};

const vendorSubscriptionInfo = async (vendor) => {
  const subscription = await Subscriber.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'subscriptions',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        trialStartDate: 1,
        trialEndDate: 1,
        startDate: 1,
        endDate: 1,
        subscriptionInfo: {
          id: { $ifNull: ['$subscriptions._id', ''] },
          name: { $ifNull: ['$subscriptions.name', ''] },
          shortDescriptions: { $ifNull: ['$subscriptions.shortDescriptions', ''] },
          customCategory: { $ifNull: ['$subscriptions.customCategory', false] },
          discount: { $divide: [{ $ifNull: ['$subscriptions.discount', 0] }, 100] },
          haveTrial: { $ifNull: ['$subscriptions.haveTrial', false] },
          icon: { $ifNull: ['$subscriptions.icon', ''] },
          multiOutlet: { $ifNull: ['$subscriptions.multiOutlet', false] },
          orderLimit: { $divide: [{ $ifNull: ['$subscriptions.orderLimit', 0] }, 100] },
          ownDriver: { $ifNull: ['$subscriptions.ownDriver', false] },
          pos: { $ifNull: ['$subscriptions.pos', false] },
          preBooking: { $ifNull: ['$subscriptions.preBooking', false] },
          price: { $divide: [{ $ifNull: ['$subscriptions.price', 0] }, 100] },
          productLimit: { $divide: [{ $ifNull: ['$subscriptions.productLimit', 0] }, 100] },
          trialValidity: { $divide: [{ $ifNull: ['$subscriptions.trialValidity', 0] }, 100] },
          validity: { $divide: [{ $ifNull: ['$subscriptions.validity', 0] }, 100] },
          promote: { $ifNull: ['$subscriptions.promote', false] },
          tableOrder: { $ifNull: ['$subscriptions.tableOrder', false] },
          tiffinSubscription: { $ifNull: ['$subscriptions.tiffinSubscription', false] },
          ownWaiter: { $ifNull: ['$subscriptions.ownWaiter', false] },
          ownKitchen: { $ifNull: ['$subscriptions.ownKitchen', false] },
          translations: { $ifNull: ['$subscriptions.translations', []] },
        },
      },
    },
  ]);
  if (checkArrayNotEmpty(subscription)) {
    const info = subscription[0];
    let trialWillExpire = 'false';
    let mainWillExpire = 'false';
    if (info && info.trialEndDate) {
      const trialEndDate = DateTime.fromJSDate(new Date(info.trialEndDate));
      const today = DateTime.now();
      const daysDifference = Math.floor(trialEndDate.diff(today, 'days').days);

      if (daysDifference <= 3 && daysDifference >= 0) {
        trialWillExpire = 'true';
      }
    }

    if (info && info.endDate) {
      const mainEndDate = DateTime.fromJSDate(new Date(info.endDate));
      const today = DateTime.now();
      const daysDifference = Math.floor(mainEndDate.diff(today, 'days').days);

      if (daysDifference <= 3 && daysDifference >= 0) {
        mainWillExpire = 'true';
      }
    }

    const paymentSettings = await PaymentConfig.find(
      { status: true, paymentWay: 'online' },
      { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
    );
    const defaultPayment = await PaymentConfig.findOne(
      { isDefault: true, status: true, paymentWay: 'online' },
      { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
    );
    return Promise.all([subscription, defaultPayment, paymentSettings]).then(() => {
      const result = {
        info,
        primary: defaultPayment,
        payments: paymentSettings,
        expireSoon: !!(trialWillExpire === 'true' || mainWillExpire === 'true'),
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const restauratReportInitialFilter = async () => {
  const city = await City.find({ status: true }, { id: 1, name: 1, location: 1, translations: 1 });
  const restaurantType = await RestaurantType.find(
    { status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return Promise.all([city, restaurantType]).then(() => {
    const result = {
      city,
      restaurantType,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const restaurantReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const name = options.search;
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? {
          restaurantType:
            options && options.category && options.category !== null && options.category !== ''
              ? { $in: [new mongoose.Types.ObjectId(options.category)] }
              : { $nin: [null] },
          type:
            options && options.type && options.type !== null && options.type !== ''
              ? { $in: [options.type] }
              : { $nin: [null] },
          city:
            options && options.city && options.city !== null && options.city !== ''
              ? new mongoose.Types.ObjectId(options.city)
              : { $ne: null },
        }
      : { restaurantType: { $nin: [null] }, city: { $ne: null }, type: { $ne: null } },
  };
  if (name && name !== '' && name !== null) {
    const searchRegExp = RegExp(name, 'i');
    matchQuery.$match = {
      $or: [
        { name: searchRegExp },
        { slug: searchRegExp },
        {
          translations: {
            $elemMatch: {
              title: { $regex: searchRegExp },
            },
          },
        },
      ],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'orders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'posortableorders',
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'tableorders',
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
        // Orders Stats //
        orderEarningAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [
                  { $divide: ['$$order.itemTotal', 100] },
                  { $divide: ['$$order.packageCharge', 100] },
                  { $divide: ['$$order.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        orderDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.itemDiscount', 100] }],
              },
            },
          },
        },
        orderRestaurantCommission: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.restaurantCommission', 100] }],
              },
            },
          },
        },
        orderFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.foodServiceCharge', 100] }],
              },
            },
          },
        },
        orderServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.serviceCharge', 100] }],
              },
            },
          },
        },
        // Orders Stats //

        // POS Stats //
        posEarningAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [
                  { $divide: ['$$pos.itemTotal', 100] },
                  { $divide: ['$$pos.packageCharge', 100] },
                  { $divide: ['$$pos.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        posDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.itemDiscount', 100] }],
              },
            },
          },
        },
        posRestaurantCommission: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.restaurantCommission', 100] }],
              },
            },
          },
        },
        posFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.foodServiceCharge', 100] }],
              },
            },
          },
        },
        posServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.serviceCharge', 100] }],
              },
            },
          },
        },
        // POS Stats //

        // Table Order Stats //
        tableOrderEarningAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [
                  { $divide: ['$$tableOrder.itemTotal', 100] },
                  { $divide: ['$$tableOrder.packageCharge', 100] },
                  { $divide: ['$$tableOrder.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        tableOrderDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.itemDiscount', 100] }],
              },
            },
          },
        },
        tableOrderRestaurantCommission: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.restaurantCommission', 100] }],
              },
            },
          },
        },
        tableOrderFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.foodServiceCharge', 100] }],
              },
            },
          },
        },
        tableOrderServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.serviceCharge', 100] }],
              },
            },
          },
        },
        // Table Order Stats //

        // Dining Booking Stats //
        diningEarningAmount: {
          $sum: {
            $map: {
              input: '$diningbookings',
              as: 'booking',
              in: {
                $add: [{ $divide: ['$$booking.grandTotal', 100] }],
              },
            },
          },
        },
        diningCommissionAmount: {
          $sum: {
            $map: {
              input: '$diningbookings',
              as: 'booking',
              in: {
                $add: [{ $divide: ['$$booking.bookingCommission', 100] }],
              },
            },
          },
        },
        // Dining Booking Stats //
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        rating: 1,
        cover: 1,
        logo: 1,
        orders: {
          $size: '$orders',
        },
        foods: {
          $size: '$foods',
        },
        diningBookings: {
          $size: '$diningbookings',
        },
        posOrders: {
          $size: '$posortableorders',
        },
        tableOrders: {
          $size: '$tableorders',
        },
        // Order Stats //
        orderEarningAmount: 1,
        orderDiscountGivenAmount: 1,
        orderRestaurantCommission: 1,
        orderFoodTaxAmount: 1,
        orderServiceChargeAmount: 1,
        // Order Stats //

        // POS Stats //
        posEarningAmount: 1,
        posDiscountGivenAmount: 1,
        posRestaurantCommission: 1,
        posFoodTaxAmount: 1,
        posServiceChargeAmount: 1,
        // POS Stats //

        // Table Order Stats //
        tableOrderEarningAmount: 1,
        tableOrderDiscountGivenAmount: 1,
        tableOrderRestaurantCommission: 1,
        tableOrderFoodTaxAmount: 1,
        tableOrderServiceChargeAmount: 1,
        // Table Order Stats //

        // Dining Booking Stats //
        diningEarningAmount: 1,
        diningCommissionAmount: 1,
        // Dining Booking Stats //
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
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
        translations: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await Restaurant.aggregate(query);
  const resultCount = await Restaurant.aggregate(countQuery);
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

const vendorOutletList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await Restaurant.aggregate([
    {
      $match: { isOutlet: true, outletManagerId: new mongoose.Types.ObjectId(options.restaurant) },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
      $unwind: {
        path: '$users',
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
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
      },
    },
  ]);
  const totalResults = await Restaurant.countDocuments({
    isOutlet: true,
    outletManagerId: new mongoose.Types.ObjectId(options.restaurant),
  });
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorInformation = async (vendorId) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(vendorId) } },
    { $limit: 1 },
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
        from: 'restauranttypes',
        localField: 'restaurantType',
        foreignField: '_id',
        as: 'restauranttypes',
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
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categories',
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
        from: 'diningcategories',
        localField: 'diningCategory',
        foreignField: '_id',
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
        as: 'diningCategory',
      },
    },
    {
      $lookup: {
        from: 'restaurantfacilities',
        localField: 'restaurantFacility',
        foreignField: '_id',
        as: 'restaurantfacilities',
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
        from: 'restaurantfoodlicenses',
        localField: 'license',
        foreignField: '_id',
        as: 'restaurantfoodlicenses',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              image: 1,
              website: 1,
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
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'outlet',
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
      $lookup: {
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $lookup: {
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'posortableorders',
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'tableorders',
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'waiters',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'waiters',
      },
    },
    {
      $lookup: {
        from: 'refundrequests',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'refundrequests',
      },
    },
    {
      $lookup: {
        from: 'diningbookingrefundrequests',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'diningbookingrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'tiffinsubscriptionrefundrequests',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'tiffinsubscriptionrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'drivers',
      },
    },
    {
      $lookup: {
        from: 'complaints',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'complaints',
      },
    },
    {
      $lookup: {
        from: 'restaurantcomplaints',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantcomplaints',
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: '_id',
        foreignField: 'outletManagerId',
        as: 'outletList',
      },
    },
    {
      $lookup: {
        from: 'restaurantdisbursements',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantdisbursements',
      },
    },
    {
      $lookup: {
        from: 'collectcashes',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'collectcashes',
      },
    },
    {
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'withdrawalrequests',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'withdrawalrequests',
      },
    },
    {
      $lookup: {
        from: 'media',
        localField: 'userId',
        foreignField: 'uid',
        as: 'media',
      },
    },
    {
      $unwind: {
        path: '$subscriptions',
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
      $unwind: {
        path: '$outlet',
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
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        address: 1,
        shortDescription: 1,
        logo: 1,
        cover: 1,
        location: 1,
        type: 1,
        commission: 1,
        posOrderCommission: 1,
        tableOrderCommission: 1,
        approxDeliveryTime: 1,
        dishPriceForTwo: {
          $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
        },
        rating: 1,
        pos: 1,
        ownDriver: 1,
        promote: 1,
        customCategory: 1,
        multiOutlet: 1,
        preBooking: 1,
        tableOrder: 1,
        tiffinSubscription: 1,
        ownWaiter: 1,
        ownKitchen: 1,
        takeAway: 1,
        isOutlet: 1,
        orderLimit: 1,
        productLimit: 1,
        translations: 1,
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        minOrderAmount: {
          $round: [{ $divide: ['$minOrderAmount', 100] }, 2],
        },
        licenseId: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
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
        manager: {
          id: { $ifNull: ['$outlet._id', ''] },
          name: { $ifNull: ['$outlet.name', ''] },
          commission: { $ifNull: ['$outlet.commission', 0] },
          posOrderCommission: { $ifNull: ['$outlet.posOrderCommission', 0] },
          tableOrderCommission: { $ifNull: ['$outlet.tableOrderCommission', 0] },
          pos: { $ifNull: ['$outlet.pos', false] },
          ownDriver: { $ifNull: ['$outlet.ownDriver', false] },
          promote: { $ifNull: ['$outlet.promote', false] },
          customCategory: { $ifNull: ['$outlet.customCategory', false] },
          multiOutlet: { $ifNull: ['$outlet.multiOutlet', false] },
          preBooking: { $ifNull: ['$outlet.preBooking', false] },
          tableOrder: { $ifNull: ['$outlet.tableOrder', false] },
          tiffinSubscription: { $ifNull: ['$outlet.tiffinSubscription', false] },
          ownWaiter: { $ifNull: ['$outlet.ownWaiter', false] },
          ownKitchen: { $ifNull: ['$outlet.ownKitchen', false] },
          translations: { $ifNull: ['$outlet.translations', []] },
        },
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          role: { $ifNull: ['$users.role', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        cuisine: 1,
        restaurantfacilities: 1,
        restauranttypes: 1,
        categories: 1,
        diningCategory: 1,
        license: {
          id: { $ifNull: ['$restaurantfoodlicenses.id', ''] },
          name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
          translations: { $ifNull: ['$restaurantfoodlicenses.translations', []] },
        },
        subscriptionInfo: {
          id: { $ifNull: ['$subscriptions._id', ''] },
          name: { $ifNull: ['$subscriptions.name', ''] },
          translations: { $ifNull: ['$subscriptions.translations', []] },
        },
        userId: 1,
        wallets: 1,
        orderCount: {
          $size: '$orders',
        },
        diningBookings: {
          $size: '$diningbookings',
        },
        tiffinPackages: {
          $size: '$subscriptiontiffinpackages',
        },
        soldTiffinPackages: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        posOrders: {
          $size: '$posortableorders',
        },
        tableOrders: {
          $size: '$tableorders',
        },
        totalProducts: {
          $size: '$foods',
        },
        totalWaiters: {
          $size: '$waiters',
        },
        totalDeliveryman: {
          $size: '$drivers',
        },
        orderRefund: {
          $size: '$refundrequests',
        },
        diningRefund: {
          $size: '$diningbookingrefundrequests',
        },
        tiffinRefund: {
          $size: '$tiffinsubscriptionrefundrequests',
        },
        orderComplaints: {
          $size: '$complaints',
        },
        restaurantComplaints: {
          $size: '$restaurantcomplaints',
        },
        totalOutlets: {
          $size: '$outletList',
        },
        disbursements: {
          $size: '$restaurantdisbursements',
        },
        collectedCash: {
          $size: '$collectcashes',
        },
        payoutAccounts: {
          $size: '$restaurantpayoutmethods',
        },
        withdrawalRequest: {
          $size: '$withdrawalrequests',
        },
        medias: {
          $size: '$media',
        },
        socialFacebook: { $ifNull: ['$socialFacebook', ''] },
        socialInstagram: { $ifNull: ['$socialInstagram', ''] },
        socialX: { $ifNull: ['$socialX', ''] },
        socialYoutube: { $ifNull: ['$socialYoutube', ''] },
        socialLinkedIn: { $ifNull: ['$socialLinkedIn', ''] },
        socialPinterest: { $ifNull: ['$socialPinterest', ''] },
        createdAt: 1,
      },
    },
  ];
  const results = await Restaurant.aggregate(query);
  if (!results[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const restaurant = results[0];
  const wallet = await restaurantWalletDetail(vendorId);
  const starCounts = await RestaurantOrderReview.aggregate([
    { $match: { restaurant: new mongoose.Types.ObjectId(vendorId) } },
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
  return Promise.all([results, wallet, starCounts]).then(() => {
    const result = {
      restaurant,
      wallet,
      percentages,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const posRestaurantListFromCity = async (city) => {
  const restaurants = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
        status: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        translations: 1,
      },
    },
  ]);
  return Promise.all([restaurants]).then(() => {
    const result = {
      restaurants,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const posRestaurantData = async (vendor) => {
  const queryMainCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
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
      $group: {
        _id: '$categories._id',
        categories: {
          $first: '$categories',
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
      },
    },
  ];
  const queryCustomCategories = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
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
      },
    },
  ];
  const main = await Food.aggregate(queryMainCategories);
  const custom = await Food.aggregate(queryCustomCategories);
  const restaurantMeta = await Restaurant.findById(vendor, {
    name: 1,
    approxDeliveryTime: 1,
    slots: 1,
    takeAway: 1,
    acceptHomeDelivery: 1,
    acceptScheduleDelivery: 1,
    minOrderAmount: 1,
    location: 1,
  });

  return Promise.all([main, custom, restaurantMeta]).then(() => {
    const result = {
      categories: {
        category: main,
        own: custom,
      },
      restaurant: restaurantMeta,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityMapDialogData = async (city, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const info = await City.findById(city, { location: 1, name: 1, translations: 1 });
  const drivers = await Driver.aggregate([
    { $match: { city: new mongoose.Types.ObjectId(city) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
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
      $unwind: {
        path: '$users',
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
      $project: {
        _id: 0,
        id: '$_id',
        location: 1,
        rating: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
      },
    },
  ]);
  const restaurants = await Restaurant.aggregate([
    { $match: { city: new mongoose.Types.ObjectId(city) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'restaurantorderreviews',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantorderreviews',
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
      $unwind: {
        path: '$localities',
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
      $project: {
        _id: 0,
        id: '$_id',
        location: 1,
        name: 1,
        translations: 1,
        logo: 1,
        cover: 1,
        rating: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
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
      },
    },
  ]);
  const allDrivers = await Driver.aggregate([
    { $match: { city: new mongoose.Types.ObjectId(city) } },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
      $project: {
        _id: 0,
        id: '$_id',
        location: 1,
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ]);
  const allRestaurants = await Restaurant.aggregate([
    { $match: { city: new mongoose.Types.ObjectId(city) } },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        location: 1,
        name: 1,
        translations: 1,
      },
    },
  ]);
  const area = await BusinessSettings.findOne({}, { findMode: 1, deliveryArea: 1 });
  const banners = await Banner.countDocuments({ city: new mongoose.Types.ObjectId(city) });
  const coupons = await Coupon.countDocuments({ city: new mongoose.Types.ObjectId(city) });
  const diningCoupon = await DiningCoupon.countDocuments({
    city: new mongoose.Types.ObjectId(city),
  });
  const totalRestaurants = await Restaurant.countDocuments({
    city: new mongoose.Types.ObjectId(city),
  });
  const totalDeliveryman = await Driver.countDocuments({ city: new mongoose.Types.ObjectId(city) });
  const locality = await Locality.countDocuments({ city: new mongoose.Types.ObjectId(city) });
  const restaurantCampaign = await RestaurantCampaign.countDocuments({
    city: new mongoose.Types.ObjectId(city),
  });
  const diningCampaign = await DiningCampaign.countDocuments({
    city: new mongoose.Types.ObjectId(city),
  });
  const foodCampaign = await FoodCampaign.countDocuments({
    city: new mongoose.Types.ObjectId(city),
  });
  return Promise.all([
    info,
    restaurants,
    drivers,
    area,
    banners,
    coupons,
    diningCoupon,
    totalRestaurants,
    locality,
    totalDeliveryman,
    restaurantCampaign,
    diningCampaign,
    foodCampaign,
    allRestaurants,
    allDrivers,
  ]).then(() => {
    const result = {
      info,
      restaurants,
      drivers,
      area,
      banners,
      coupons,
      diningCoupon,
      totalRestaurants,
      locality,
      totalDeliveryman,
      restaurantCampaign,
      diningCampaign,
      foodCampaign,
      allRestaurants,
      allDrivers,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityMapDialogRestaurants = async (city, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const restaurants = await Restaurant.aggregate([
    { $match: { city: new mongoose.Types.ObjectId(city) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'restaurantorderreviews',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantorderreviews',
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
      $unwind: {
        path: '$localities',
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
      $project: {
        _id: 0,
        id: '$_id',
        location: 1,
        name: 1,
        translations: 1,
        logo: 1,
        cover: 1,
        rating: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
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
      },
    },
  ]);
  const totalRestaurants = await Restaurant.countDocuments({
    city: new mongoose.Types.ObjectId(city),
  });
  return Promise.all([restaurants, totalRestaurants]).then(() => {
    const result = {
      restaurants,
      totalRestaurants,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const filterRestaurantList = async (id, kind, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  let matchQuery = null;
  if (kind === 'categories') {
    matchQuery = { category: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'cuisine') {
    matchQuery = { cuisine: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'facilities') {
    matchQuery = { restaurantFacility: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'types') {
    matchQuery = { restaurantType: { $in: [new mongoose.Types.ObjectId(id)] } };
  }
  const results = await Restaurant.aggregate([
    { $match: matchQuery },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const totalResults = await Restaurant.countDocuments(matchQuery);
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

const filterQueryData = async () => {
  const cities = await City.find({ status: true }, { name: 1, translations: 1 });
  const categories = await Category.find({ status: true }, { name: 1, translations: 1 });
  const cuisine = await Cuisine.find({ status: true }, { name: 1, translations: 1 });
  const facilities = await RestaurantFacility.find({ status: true }, { name: 1, translations: 1 });
  const types = await RestaurantType.find({ status: true }, { name: 1, translations: 1 });
  return Promise.all([types, facilities, cuisine, categories, cities]).then(() => {
    const result = {
      cities,
      cuisine,
      categories,
      facilities,
      types,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenFilterQueryData = async () => {
  const categories = await Category.find({ status: true }, { name: 1, translations: 1 });
  const cuisine = await Cuisine.find({ status: true }, { name: 1, translations: 1 });
  const facilities = await RestaurantFacility.find({ status: true }, { name: 1, translations: 1 });
  const types = await RestaurantType.find({ status: true }, { name: 1, translations: 1 });
  return Promise.all([types, facilities, cuisine, categories]).then(() => {
    const result = {
      cuisine,
      categories,
      facilities,
      types,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const filterQuery = async (city, cuisine, category, facility, type, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const matchQuery = [];
  if (city !== null && city !== '') {
    matchQuery.push({ city: new mongoose.Types.ObjectId(city) });
  }
  if (cuisine !== null && cuisine !== '') {
    matchQuery.push({ cuisine: { $in: [new mongoose.Types.ObjectId(cuisine)] } });
  }
  if (category !== null && category !== '') {
    matchQuery.push({ category: { $in: [new mongoose.Types.ObjectId(category)] } });
  }
  if (facility !== null && facility !== '') {
    matchQuery.push({ restaurantFacility: { $in: [new mongoose.Types.ObjectId(facility)] } });
  }
  if (type !== null && type !== '') {
    matchQuery.push({ restaurantType: { $in: [new mongoose.Types.ObjectId(type)] } });
  }
  const results = await Restaurant.aggregate([
    { $match: { $and: matchQuery } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const countQuery = [{ $match: { $and: matchQuery } }, { $count: 'totalCount' }];
  const resultCount = await Restaurant.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
  return Promise.all([results, resultCount]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenFilterQuery = async (masterId, cuisine, category, facility, type, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const matchQuery = [];
  if (city !== null && city !== '') {
    matchQuery.push({ city: new mongoose.Types.ObjectId(city) });
  }
  if (cuisine !== null && cuisine !== '') {
    matchQuery.push({ cuisine: { $in: [new mongoose.Types.ObjectId(cuisine)] } });
  }
  if (category !== null && category !== '') {
    matchQuery.push({ category: { $in: [new mongoose.Types.ObjectId(category)] } });
  }
  if (facility !== null && facility !== '') {
    matchQuery.push({ restaurantFacility: { $in: [new mongoose.Types.ObjectId(facility)] } });
  }
  if (type !== null && type !== '') {
    matchQuery.push({ restaurantType: { $in: [new mongoose.Types.ObjectId(type)] } });
  }
  const results = await Restaurant.aggregate([
    { $match: { $and: matchQuery } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const countQuery = [{ $match: { $and: matchQuery } }, { $count: 'totalCount' }];
  const resultCount = await Restaurant.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
  return Promise.all([results, resultCount]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const supportTeamRestaurantList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? {
          restaurantType:
            options && options.category && options.category !== null && options.category !== ''
              ? { $in: [new mongoose.Types.ObjectId(options.category)] }
              : { $nin: [null] },
          type:
            options && options.type && options.type !== null && options.type !== ''
              ? { $in: [options.type] }
              : { $nin: [null] },
          city:
            options && options.city && options.city !== null && options.city !== ''
              ? new mongoose.Types.ObjectId(options.city)
              : { $ne: null },
        }
      : { restaurantType: { $nin: [null] }, city: { $ne: null }, type: { $ne: null } },
  };

  const name = options.search;
  if (name && name !== '' && name !== null) {
    const searchRegExp = RegExp(name, 'i');
    matchQuery.$match = {
      $or: [
        { name: searchRegExp },
        { slug: searchRegExp },
        {
          translations: {
            $elemMatch: {
              title: { $regex: searchRegExp },
            },
          },
        },
      ],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'orders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'posortableorders',
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'tableorders',
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
        // Orders Stats //
        orderEarningAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [
                  { $divide: ['$$order.itemTotal', 100] },
                  { $divide: ['$$order.packageCharge', 100] },
                  { $divide: ['$$order.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        orderDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.itemDiscount', 100] }],
              },
            },
          },
        },
        orderRestaurantCommission: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.restaurantCommission', 100] }],
              },
            },
          },
        },
        orderFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.foodServiceCharge', 100] }],
              },
            },
          },
        },
        orderServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.serviceCharge', 100] }],
              },
            },
          },
        },
        // Orders Stats //

        // POS Stats //
        posEarningAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [
                  { $divide: ['$$pos.itemTotal', 100] },
                  { $divide: ['$$pos.packageCharge', 100] },
                  { $divide: ['$$pos.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        posDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.itemDiscount', 100] }],
              },
            },
          },
        },
        posRestaurantCommission: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.restaurantCommission', 100] }],
              },
            },
          },
        },
        posFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.foodServiceCharge', 100] }],
              },
            },
          },
        },
        posServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.serviceCharge', 100] }],
              },
            },
          },
        },
        // POS Stats //

        // Table Order Stats //
        tableOrderEarningAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [
                  { $divide: ['$$tableOrder.itemTotal', 100] },
                  { $divide: ['$$tableOrder.packageCharge', 100] },
                  { $divide: ['$$tableOrder.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        tableOrderDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.itemDiscount', 100] }],
              },
            },
          },
        },
        tableOrderRestaurantCommission: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.restaurantCommission', 100] }],
              },
            },
          },
        },
        tableOrderFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.foodServiceCharge', 100] }],
              },
            },
          },
        },
        tableOrderServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.serviceCharge', 100] }],
              },
            },
          },
        },
        // Table Order Stats //

        // Dining Booking Stats //
        diningEarningAmount: {
          $sum: {
            $map: {
              input: '$diningbookings',
              as: 'booking',
              in: {
                $add: [{ $divide: ['$$booking.grandTotal', 100] }],
              },
            },
          },
        },
        diningCommissionAmount: {
          $sum: {
            $map: {
              input: '$diningbookings',
              as: 'booking',
              in: {
                $add: [{ $divide: ['$$booking.bookingCommission', 100] }],
              },
            },
          },
        },
        // Dining Booking Stats //
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        rating: 1,
        cover: 1,
        logo: 1,
        orders: {
          $size: '$orders',
        },
        foods: {
          $size: '$foods',
        },
        diningBookings: {
          $size: '$diningbookings',
        },
        posOrders: {
          $size: '$posortableorders',
        },
        tableOrders: {
          $size: '$tableorders',
        },
        // Order Stats //
        orderEarningAmount: 1,
        orderDiscountGivenAmount: 1,
        orderRestaurantCommission: 1,
        orderFoodTaxAmount: 1,
        orderServiceChargeAmount: 1,
        // Order Stats //

        // POS Stats //
        posEarningAmount: 1,
        posDiscountGivenAmount: 1,
        posRestaurantCommission: 1,
        posFoodTaxAmount: 1,
        posServiceChargeAmount: 1,
        // POS Stats //

        // Table Order Stats //
        tableOrderEarningAmount: 1,
        tableOrderDiscountGivenAmount: 1,
        tableOrderRestaurantCommission: 1,
        tableOrderFoodTaxAmount: 1,
        tableOrderServiceChargeAmount: 1,
        // Table Order Stats //

        // Dining Booking Stats //
        diningEarningAmount: 1,
        diningCommissionAmount: 1,
        // Dining Booking Stats //
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
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
        translations: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await Restaurant.aggregate(query);
  const resultCount = await Restaurant.aggregate(countQuery);
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

const supportTeamRestaurantDetail = async (id) => {
  const restaurant = await Restaurant.findById(id, {
    userId: 1,
    name: 1,
    address: 1,
    translations: 1,
  });
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const user = await User.findById(restaurant.userId, {
    firstName: 1,
    lastName: 1,
    email: 1,
    countryCode: 1,
    mobile: 1,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return Promise.all([restaurant, user]).then(() => {
    const result = {
      restaurant,
      user,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenDetail = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return cityzen;
};

const vendorTableQrDetail = async (vendor) => {
  const detail = await Restaurant.findById(vendor, { name: 1, logo: 1, translations: 1 });
  const business = await BusinessSettings.findOne({}, { websiteUrl: 1, mobile: 1, companyName: 1 });
  return Promise.all([detail, business]).then(() => {
    const result = {
      detail,
      business,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollectionRestaurantAllData = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $and: [{ isOutlet: false }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
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
      $lookup: {
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $lookup: {
        from: 'restaurantfoodlicenses',
        localField: 'license',
        foreignField: '_id',
        as: 'restaurantfoodlicenses',
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
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        rating: 1,
        status: 1,
        slug: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          email: { $ifNull: ['$users.email', ''] },
        },
        city: {
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          name: { $ifNull: ['$localities.name', ''] },
        },
        type: 1,
        commission: 1,
        posOrderCommission: 1,
        tableOrderCommission: 1,
        approxDeliveryTime: 1,
        dishPriceForTwo: {
          $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
        },
        address: 1,
        location: 1,
        pos: 1,
        ownDriver: 1,
        promote: 1,
        customCategory: 1,
        multiOutlet: 1,
        preBooking: 1,
        tableOrder: 1,
        tiffinSubscription: 1,
        ownWaiter: 1,
        ownKitchen: 1,
        takeAway: 1,
        orderLimit: 1,
        productLimit: 1,
        temporaryClosed: 1,
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        minOrderAmount: {
          $round: [{ $divide: ['$minOrderAmount', 100] }, 2],
        },
        socialFacebook: 1,
        socialInstagram: 1,
        socialX: 1,
        socialYoutube: 1,
        socialLinkedIn: 1,
        socialPinterest: 1,
        subscriptionInfo: {
          name: { $ifNull: ['$subscriptions.name', ''] },
        },
        license: {
          name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
        },
        licenseId: 1,
      },
    },
  ];
  const results = await Restaurant.aggregate(query);
  return results;
};

const exportRawRestaurantCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $and: [{ isOutlet: false }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
  const results = await Restaurant.aggregate(query);
  return results;
};

const exportCollectionOutletAllData = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $and: [{ isOutlet: true }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'outletManagerId',
        foreignField: '_id',
        as: 'outlet',
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
      $lookup: {
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $lookup: {
        from: 'restaurantfoodlicenses',
        localField: 'license',
        foreignField: '_id',
        as: 'restaurantfoodlicenses',
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
        path: '$outlet',
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
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        rating: 1,
        status: 1,
        slug: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        manager: {
          id: { $ifNull: ['$outlet._id', ''] },
          name: { $ifNull: ['$outlet.name', ''] },
        },
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          email: { $ifNull: ['$users.email', ''] },
        },
        city: {
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          name: { $ifNull: ['$localities.name', ''] },
        },
        type: 1,
        commission: 1,
        posOrderCommission: 1,
        tableOrderCommission: 1,
        approxDeliveryTime: 1,
        dishPriceForTwo: {
          $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
        },
        address: 1,
        location: 1,
        pos: 1,
        ownDriver: 1,
        promote: 1,
        customCategory: 1,
        multiOutlet: 1,
        preBooking: 1,
        tableOrder: 1,
        tiffinSubscription: 1,
        ownWaiter: 1,
        ownKitchen: 1,
        takeAway: 1,
        orderLimit: 1,
        productLimit: 1,
        temporaryClosed: 1,
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        minOrderAmount: {
          $round: [{ $divide: ['$minOrderAmount', 100] }, 2],
        },
        socialFacebook: 1,
        socialInstagram: 1,
        socialX: 1,
        socialYoutube: 1,
        socialLinkedIn: 1,
        socialPinterest: 1,
        subscriptionInfo: {
          name: { $ifNull: ['$subscriptions.name', ''] },
        },
        license: {
          name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
        },
        licenseId: 1,
      },
    },
  ];
  const results = await Restaurant.aggregate(query);
  return results;
};

const exportRawOutletCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $and: [{ isOutlet: true }],
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
  const results = await Restaurant.aggregate(query);
  return results;
};

const exportRestaurantFilterTypeCollection = async (kind, id) => {
  let matchQuery = null;
  if (kind === 'categories') {
    matchQuery = { category: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'cuisine') {
    matchQuery = { cuisine: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'facilities') {
    matchQuery = { restaurantFacility: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'types') {
    matchQuery = { restaurantType: { $in: [new mongoose.Types.ObjectId(id)] } };
  }
  const query = [
    { $match: matchQuery },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
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
      $lookup: {
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $lookup: {
        from: 'restaurantfoodlicenses',
        localField: 'license',
        foreignField: '_id',
        as: 'restaurantfoodlicenses',
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
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        rating: 1,
        status: 1,
        slug: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          email: { $ifNull: ['$users.email', ''] },
        },
        city: {
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          name: { $ifNull: ['$localities.name', ''] },
        },
        type: 1,
        commission: 1,
        posOrderCommission: 1,
        tableOrderCommission: 1,
        approxDeliveryTime: 1,
        dishPriceForTwo: {
          $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
        },
        address: 1,
        location: 1,
        pos: 1,
        ownDriver: 1,
        promote: 1,
        customCategory: 1,
        multiOutlet: 1,
        preBooking: 1,
        tableOrder: 1,
        tiffinSubscription: 1,
        ownWaiter: 1,
        ownKitchen: 1,
        takeAway: 1,
        orderLimit: 1,
        productLimit: 1,
        temporaryClosed: 1,
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        minOrderAmount: {
          $round: [{ $divide: ['$minOrderAmount', 100] }, 2],
        },
        socialFacebook: 1,
        socialInstagram: 1,
        socialX: 1,
        socialYoutube: 1,
        socialLinkedIn: 1,
        socialPinterest: 1,
        subscriptionInfo: {
          name: { $ifNull: ['$subscriptions.name', ''] },
        },
        license: {
          name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
        },
        licenseId: 1,
      },
    },
  ];
  const results = await Restaurant.aggregate(query);
  return results;
};

const exportRawRestaurantFilterTypeCollection = async (kind, id) => {
  let matchQuery = null;
  if (kind === 'categories') {
    matchQuery = { category: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'cuisine') {
    matchQuery = { cuisine: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'facilities') {
    matchQuery = { restaurantFacility: { $in: [new mongoose.Types.ObjectId(id)] } };
  } else if (kind === 'types') {
    matchQuery = { restaurantType: { $in: [new mongoose.Types.ObjectId(id)] } };
  }
  const results = await Restaurant.find(matchQuery).lean();
  return results;
};

const exportRestaurantFilterQueryCollection = async (city, cuisine, category, facility, type) => {
  const matchQuery = [];
  if (city !== null && city !== '') {
    matchQuery.push({ city: new mongoose.Types.ObjectId(city) });
  }
  if (cuisine !== null && cuisine !== '') {
    matchQuery.push({ cuisine: { $in: [new mongoose.Types.ObjectId(cuisine)] } });
  }
  if (category !== null && category !== '') {
    matchQuery.push({ category: { $in: [new mongoose.Types.ObjectId(category)] } });
  }
  if (facility !== null && facility !== '') {
    matchQuery.push({ restaurantFacility: { $in: [new mongoose.Types.ObjectId(facility)] } });
  }
  if (type !== null && type !== '') {
    matchQuery.push({ restaurantType: { $in: [new mongoose.Types.ObjectId(type)] } });
  }
  const query = [
    // { $match: matchQuery },
    { $match: { $and: matchQuery } },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
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
      $lookup: {
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $lookup: {
        from: 'restaurantfoodlicenses',
        localField: 'license',
        foreignField: '_id',
        as: 'restaurantfoodlicenses',
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
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        cover: 1,
        rating: 1,
        status: 1,
        slug: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          email: { $ifNull: ['$users.email', ''] },
        },
        city: {
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          name: { $ifNull: ['$localities.name', ''] },
        },
        type: 1,
        commission: 1,
        posOrderCommission: 1,
        tableOrderCommission: 1,
        approxDeliveryTime: 1,
        dishPriceForTwo: {
          $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
        },
        address: 1,
        location: 1,
        pos: 1,
        ownDriver: 1,
        promote: 1,
        customCategory: 1,
        multiOutlet: 1,
        preBooking: 1,
        tableOrder: 1,
        tiffinSubscription: 1,
        ownWaiter: 1,
        ownKitchen: 1,
        takeAway: 1,
        orderLimit: 1,
        productLimit: 1,
        temporaryClosed: 1,
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        minOrderAmount: {
          $round: [{ $divide: ['$minOrderAmount', 100] }, 2],
        },
        socialFacebook: 1,
        socialInstagram: 1,
        socialX: 1,
        socialYoutube: 1,
        socialLinkedIn: 1,
        socialPinterest: 1,
        subscriptionInfo: {
          name: { $ifNull: ['$subscriptions.name', ''] },
        },
        license: {
          name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
        },
        licenseId: 1,
      },
    },
  ];
  const result = await Restaurant.aggregate(query);
  return result;
};

const exportRawRestaurantFilterQueryCollection = async (
  city,
  cuisine,
  category,
  facility,
  type
) => {
  const matchQuery = [];
  if (city !== null && city !== '') {
    matchQuery.push({ city: new mongoose.Types.ObjectId(city) });
  }
  if (cuisine !== null && cuisine !== '') {
    matchQuery.push({ cuisine: { $in: [new mongoose.Types.ObjectId(cuisine)] } });
  }
  if (category !== null && category !== '') {
    matchQuery.push({ category: { $in: [new mongoose.Types.ObjectId(category)] } });
  }
  if (facility !== null && facility !== '') {
    matchQuery.push({ restaurantFacility: { $in: [new mongoose.Types.ObjectId(facility)] } });
  }
  if (type !== null && type !== '') {
    matchQuery.push({ restaurantType: { $in: [new mongoose.Types.ObjectId(type)] } });
  }
  const results = await Restaurant.find({ $and: matchQuery }).lean();
  return results;
};

const exportRestaurantReportCollection = async (options) => {
  const name = options.search;
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? {
          restaurantType:
            options && options.category && options.category !== null && options.category !== ''
              ? { $in: [new mongoose.Types.ObjectId(options.category)] }
              : { $nin: [null] },
          type:
            options && options.type && options.type !== null && options.type !== ''
              ? { $in: [options.type] }
              : { $nin: [null] },
          city:
            options && options.city && options.city !== null && options.city !== ''
              ? new mongoose.Types.ObjectId(options.city)
              : { $ne: null },
        }
      : { restaurantType: { $nin: [null] }, city: { $ne: null }, type: { $ne: null } },
  };
  if (name && name !== '' && name !== null) {
    const searchRegExp = RegExp(name, 'i');
    matchQuery.$match = {
      $or: [
        { name: searchRegExp },
        { slug: searchRegExp },
        {
          translations: {
            $elemMatch: {
              title: { $regex: searchRegExp },
            },
          },
        },
      ],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'posortableorders',
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'tableorders',
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
        // Orders Stats //
        orderEarningAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [
                  { $divide: ['$$order.itemTotal', 100] },
                  { $divide: ['$$order.packageCharge', 100] },
                  { $divide: ['$$order.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        orderDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.itemDiscount', 100] }],
              },
            },
          },
        },
        orderRestaurantCommission: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.restaurantCommission', 100] }],
              },
            },
          },
        },
        orderFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.foodServiceCharge', 100] }],
              },
            },
          },
        },
        orderServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$orders',
              as: 'order',
              in: {
                $add: [{ $divide: ['$$order.serviceCharge', 100] }],
              },
            },
          },
        },
        // Orders Stats //

        // POS Stats //
        posEarningAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [
                  { $divide: ['$$pos.itemTotal', 100] },
                  { $divide: ['$$pos.packageCharge', 100] },
                  { $divide: ['$$pos.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        posDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.itemDiscount', 100] }],
              },
            },
          },
        },
        posRestaurantCommission: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.restaurantCommission', 100] }],
              },
            },
          },
        },
        posFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.foodServiceCharge', 100] }],
              },
            },
          },
        },
        posServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$posortableorders',
              as: 'pos',
              in: {
                $add: [{ $divide: ['$$pos.serviceCharge', 100] }],
              },
            },
          },
        },
        // POS Stats //

        // Table Order Stats //
        tableOrderEarningAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [
                  { $divide: ['$$tableOrder.itemTotal', 100] },
                  { $divide: ['$$tableOrder.packageCharge', 100] },
                  { $divide: ['$$tableOrder.packageChargeTax', 100] },
                ],
              },
            },
          },
        },
        tableOrderDiscountGivenAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.itemDiscount', 100] }],
              },
            },
          },
        },
        tableOrderRestaurantCommission: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.restaurantCommission', 100] }],
              },
            },
          },
        },
        tableOrderFoodTaxAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.foodServiceCharge', 100] }],
              },
            },
          },
        },
        tableOrderServiceChargeAmount: {
          $sum: {
            $map: {
              input: '$tableorders',
              as: 'tableOrder',
              in: {
                $add: [{ $divide: ['$$tableOrder.serviceCharge', 100] }],
              },
            },
          },
        },
        // Table Order Stats //

        // Dining Booking Stats //
        diningEarningAmount: {
          $sum: {
            $map: {
              input: '$diningbookings',
              as: 'booking',
              in: {
                $add: [{ $divide: ['$$booking.grandTotal', 100] }],
              },
            },
          },
        },
        diningCommissionAmount: {
          $sum: {
            $map: {
              input: '$diningbookings',
              as: 'booking',
              in: {
                $add: [{ $divide: ['$$booking.bookingCommission', 100] }],
              },
            },
          },
        },
        // Dining Booking Stats //
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        createdAt: 1,
        orders: {
          $size: '$orders',
        },
        foods: {
          $size: '$foods',
        },
        diningBookings: {
          $size: '$diningbookings',
        },
        posOrders: {
          $size: '$posortableorders',
        },
        tableOrders: {
          $size: '$tableorders',
        },
        // Order Stats //
        orderEarningAmount: 1,
        orderDiscountGivenAmount: 1,
        orderRestaurantCommission: 1,
        orderFoodTaxAmount: 1,
        orderServiceChargeAmount: 1,
        // Order Stats //

        // POS Stats //
        posEarningAmount: 1,
        posDiscountGivenAmount: 1,
        posRestaurantCommission: 1,
        posFoodTaxAmount: 1,
        posServiceChargeAmount: 1,
        // POS Stats //

        // Table Order Stats //
        tableOrderEarningAmount: 1,
        tableOrderDiscountGivenAmount: 1,
        tableOrderRestaurantCommission: 1,
        tableOrderFoodTaxAmount: 1,
        tableOrderServiceChargeAmount: 1,
        // Table Order Stats //

        // Dining Booking Stats //
        diningEarningAmount: 1,
        diningCommissionAmount: 1,
        // Dining Booking Stats //
        owerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
        },
      },
    },
  ];
  const result = await Restaurant.aggregate(query);
  return result;
};

function generateSecurePassword(length = 10) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';

  const hasLetterAndNumber = (password) => {
    return /[a-zA-Z]/.test(password) && /\d/.test(password);
  };

  let password = '';
  do {
    password = Array.from(
      { length },
      () => charset[Math.floor(Math.random() * charset.length)]
    ).join('');
  } while (!hasLetterAndNumber(password));

  return password;
}

const importRestaurantCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      let isValid = true;
      if (await User.isEmailTaken(param.email)) {
        isValid = false;
      }
      if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
        isValid = false;
      }
      if (isValid) {
        const cuisineList =
          param &&
          param.cuisine &&
          param.cuisine !== null &&
          param.cuisine !== '' &&
          param.cuisine !== '-'
            ? param.cuisine.split(',')
            : [];
        const diningCategoryList =
          param &&
          param.diningCategory &&
          param.diningCategory !== null &&
          param.diningCategory !== '' &&
          param.diningCategory !== '-'
            ? param.diningCategory.split(',')
            : [];
        const restaurantTypeList =
          param &&
          param.restaurantType &&
          param.restaurantType !== null &&
          param.restaurantType !== '' &&
          param.restaurantType !== '-'
            ? param.restaurantType.split(',')
            : [];
        const restaurantFacilityList =
          param &&
          param.restaurantFacility &&
          param.restaurantFacility !== null &&
          param.restaurantFacility !== '' &&
          param.restaurantFacility !== '-'
            ? param.restaurantFacility.split(',')
            : [];
        const longitude =
          param && param.longitude && param.longitude !== null && param.longitude !== ''
            ? param.longitude
            : 0;
        const latitude =
          param && param.latitude && param.latitude !== null && param.latitude !== ''
            ? param.latitude
            : 0;
        const userData = new User({
          email: param.email,
          password: generateSecurePassword(15),
          firstName:
            param && param.firstName && param.firstName !== null && param.firstName !== ''
              ? param.firstName
              : 'NA',
          lastName:
            param && param.lastName && param.lastName !== null && param.lastName !== ''
              ? param.lastName
              : 'NA',
          countryCode: param.countryCode,
          mobile: param.mobile,
          locale:
            param && param.locale && param.locale !== null && param.locale !== ''
              ? param.locale
              : 'en',
          image:
            param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
          gender:
            param && param.gender && param.gender !== null && param.gender !== ''
              ? param.gender
              : 'male',
          role: 'vendor',
          location: { type: 'Point', coordinates: [longitude, latitude] },
          city: param && param.city && param.city !== null && param.city !== '' ? param.city : null,
          status: param && (param.status === 'active' || param.status === 'Active'),
        });
        const user = await User.create(userData);
        const walletData = new Wallet({
          holderId: user.id,
        });
        if (!(await Wallet.isUserExist(walletData.holderId))) {
          await Wallet.create(walletData);
        }
        const restaurantData = new Restaurant({
          userId: user.id,
          name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
          address:
            param && param.address && param.address !== null && param.address !== ''
              ? param.address
              : 'NA',
          shortDescription:
            param &&
            param.shortDescription &&
            param.shortDescription !== null &&
            param.shortDescription !== ''
              ? param.shortDescription
              : 'NA',
          cuisine: cuisineList,
          category: [],
          logo: param && param.logo && param.logo !== null && param.logo !== '' ? param.logo : 'NA',
          cover:
            param && param.cover && param.cover !== null && param.cover !== '' ? param.cover : 'NA',
          city: param && param.city && param.city !== null && param.city !== '' ? param.city : null,
          locality:
            param &&
            param.locality &&
            param.locality !== null &&
            param.locality !== '' &&
            param.locality !== '-'
              ? param.locality
              : null,
          location: { type: 'Point', coordinates: [longitude, latitude] },
          type:
            param &&
            param.type &&
            param.type !== null &&
            param.type !== '' &&
            param.type === 'commission'
              ? 'commission'
              : 'subscription',
          commission:
            param && param.commission && param.commission !== null && param.commission !== ''
              ? param.commission
              : 0,
          posOrderCommission:
            param &&
            param.posOrderCommission &&
            param.posOrderCommission !== null &&
            param.posOrderCommission !== ''
              ? param.posOrderCommission
              : 0,
          tableOrderCommission:
            param &&
            param.tableOrderCommission &&
            param.tableOrderCommission !== null &&
            param.tableOrderCommission !== ''
              ? param.tableOrderCommission
              : 0,
          subscription:
            param &&
            param.subscription &&
            param.subscription !== null &&
            param.subscription !== '' &&
            param.subscription !== '-'
              ? param.subscription
              : null,
          approxDeliveryTime:
            param &&
            param.approxDeliveryTime &&
            param.approxDeliveryTime !== null &&
            param.approxDeliveryTime !== ''
              ? param.approxDeliveryTime
              : '10 to 20 min',
          dishPriceForTwo:
            param &&
            param.dishPriceForTwo &&
            param.dishPriceForTwo !== null &&
            param.dishPriceForTwo !== ''
              ? param.dishPriceForTwo
              : 0,
          pos: param && (param.pos === 'Yes' || param.pos === 'yes'),
          ownDriver: param && (param.ownDriver === 'Yes' || param.ownDriver === 'yes'),
          promote: param && (param.promote === 'Yes' || param.promote === 'yes'),
          customCategory:
            param && (param.customCategory === 'Yes' || param.customCategory === 'yes'),
          multiOutlet: param && (param.multiOutlet === 'Yes' || param.multiOutlet === 'yes'),
          preBooking: param && (param.preBooking === 'Yes' || param.preBooking === 'yes'),
          tableOrder: param && (param.tableOrder === 'Yes' || param.tableOrder === 'yes'),
          tiffinSubscription:
            param && (param.tiffinSubscription === 'Yes' || param.tiffinSubscription === 'yes'),
          ownWaiter: param && (param.ownWaiter === 'Yes' || param.ownWaiter === 'yes'),
          ownKitchen: param && (param.ownKitchen === 'Yes' || param.ownKitchen === 'yes'),
          takeAway: param && (param.takeAway === 'Yes' || param.takeAway === 'yes'),
          isOutlet: false,
          outletManagerId: null,
          orderLimit:
            param && param.orderLimit && param.orderLimit !== null && param.orderLimit !== ''
              ? param.orderLimit
              : -1,
          productLimit:
            param && param.productLimit && param.productLimit !== null && param.productLimit !== ''
              ? param.productLimit
              : -1,
          slots: [],
          translations: [],
          restaurantType: restaurantTypeList,
          restaurantFacility: restaurantFacilityList,
          diningCategory: diningCategoryList,
          temporaryClosed:
            param && (param.temporaryClosed === 'Yes' || param.temporaryClosed === 'yes'),
          acceptScheduleDelivery:
            param &&
            (param.acceptScheduleDelivery === 'Yes' || param.acceptScheduleDelivery === 'yes'),
          acceptHomeDelivery:
            param && (param.acceptHomeDelivery === 'Yes' || param.acceptHomeDelivery === 'yes'),
          minOrderAmount:
            param &&
            param.minOrderAmount &&
            param.minOrderAmount !== null &&
            param.minOrderAmount !== ''
              ? param.minOrderAmount
              : 0,
          license:
            param &&
            param.license &&
            param.license !== null &&
            param.license !== '' &&
            param.license !== '-'
              ? param.license
              : null,
          licenseId:
            param && param.licenseId && param.licenseId !== null && param.licenseId !== ''
              ? param.licenseId
              : 'NA',
          socialFacebook:
            param &&
            param.socialFacebook &&
            param.socialFacebook !== '' &&
            param.socialFacebook !== null
              ? param.socialFacebook
              : '',
          socialInstagram:
            param &&
            param.socialInstagram &&
            param.socialInstagram !== '' &&
            param.socialInstagram !== null
              ? param.socialInstagram
              : '',
          socialX:
            param && param.socialX && param.socialX !== '' && param.socialX !== null
              ? param.socialX
              : '',
          socialYoutube:
            param &&
            param.socialYoutube &&
            param.socialYoutube !== '' &&
            param.socialYoutube !== null
              ? param.socialYoutube
              : '',
          socialLinkedIn:
            param &&
            param.socialLinkedIn &&
            param.socialLinkedIn !== '' &&
            param.socialLinkedIn !== null
              ? param.socialLinkedIn
              : '',
          socialPinterest:
            param &&
            param.socialPinterest &&
            param.socialPinterest !== '' &&
            param.socialPinterest !== null
              ? param.socialPinterest
              : '',
          status: param && (param.status === 'active' || param.status === 'Active'),
        });
        const restaurant = await Restaurant.create(restaurantData);
        if (
          param &&
          param.subscription &&
          param.subscription !== null &&
          param.subscription !== '' &&
          param.subscription !== '-'
        ) {
          const subscription = await subscriptionService.getById(param.subscription);
          const serverStartDate = DateTime.now().toFormat('yyyy-MM-dd');
          const serverEndDate = DateTime.now()
            .plus({ days: subscription.validity })
            .toFormat('yyyy-MM-dd');
          const subscriptionData = {
            subscriptions: param.subscription,
            restaurant: restaurant.id,
            trialStartDate: '',
            trialEndDate: '',
            startDate: serverStartDate,
            endDate: serverEndDate,
          };
          await subscriberService.createSubscriber(subscriptionData);
        }
      }
    });
  }
  return { success: true };
};

const checkOutletPermissionOfRestaurant = async (vendor) => {
  const restaurantInfo = await Restaurant.findOne({ _id: new mongoose.Types.ObjectId(vendor) });
  let multiOutlet = false;
  if (
    restaurantInfo &&
    restaurantInfo !== null &&
    (restaurantInfo.multiOutlet === 'true' || restaurantInfo.multiOutlet === true)
  ) {
    multiOutlet = true;
  }
  return { multiOutlet };
};

const importRestaurantOutletCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const permission = await checkOutletPermissionOfRestaurant(param.outletRestaurantId);
      if (permission.multiOutlet) {
        let isValid = true;
        if (await User.isEmailTaken(param.email)) {
          isValid = false;
        }
        if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
          isValid = false;
        }
        if (isValid) {
          const cuisineList =
            param &&
            param.cuisine &&
            param.cuisine !== null &&
            param.cuisine !== '' &&
            param.cuisine !== '-'
              ? param.cuisine.split(',')
              : [];
          const diningCategoryList =
            param &&
            param.diningCategory &&
            param.diningCategory !== null &&
            param.diningCategory !== '' &&
            param.diningCategory !== '-'
              ? param.diningCategory.split(',')
              : [];
          const restaurantTypeList =
            param &&
            param.restaurantType &&
            param.restaurantType !== null &&
            param.restaurantType !== '' &&
            param.restaurantType !== '-'
              ? param.restaurantType.split(',')
              : [];
          const restaurantFacilityList =
            param &&
            param.restaurantFacility &&
            param.restaurantFacility !== null &&
            param.restaurantFacility !== '' &&
            param.restaurantFacility !== '-'
              ? param.restaurantFacility.split(',')
              : [];
          const longitude =
            param && param.longitude && param.longitude !== null && param.longitude !== ''
              ? param.longitude
              : 0;
          const latitude =
            param && param.latitude && param.latitude !== null && param.latitude !== ''
              ? param.latitude
              : 0;
          const userData = new User({
            email: param.email,
            password: generateSecurePassword(15),
            firstName:
              param && param.firstName && param.firstName !== null && param.firstName !== ''
                ? param.firstName
                : 'NA',
            lastName:
              param && param.lastName && param.lastName !== null && param.lastName !== ''
                ? param.lastName
                : 'NA',
            countryCode: param.countryCode,
            mobile: param.mobile,
            locale:
              param && param.locale && param.locale !== null && param.locale !== ''
                ? param.locale
                : 'en',
            image:
              param && param.image && param.image !== null && param.image !== ''
                ? param.image
                : 'NA',
            gender:
              param && param.gender && param.gender !== null && param.gender !== ''
                ? param.gender
                : 'male',
            role: 'vendorOutlet',
            location: { type: 'Point', coordinates: [longitude, latitude] },
            city:
              param && param.city && param.city !== null && param.city !== '' ? param.city : null,
            status: param && (param.status === 'active' || param.status === 'Active'),
          });
          const user = await User.create(userData);
          const walletData = new Wallet({
            holderId: user.id,
          });
          if (!(await Wallet.isUserExist(walletData.holderId))) {
            await Wallet.create(walletData);
          }
          const restaurantData = new Restaurant({
            userId: user.id,
            name:
              param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
            address:
              param && param.address && param.address !== null && param.address !== ''
                ? param.address
                : 'NA',
            shortDescription:
              param &&
              param.shortDescription &&
              param.shortDescription !== null &&
              param.shortDescription !== ''
                ? param.shortDescription
                : 'NA',
            cuisine: cuisineList,
            category: [],
            logo:
              param && param.logo && param.logo !== null && param.logo !== '' ? param.logo : 'NA',
            cover:
              param && param.cover && param.cover !== null && param.cover !== ''
                ? param.cover
                : 'NA',
            city:
              param && param.city && param.city !== null && param.city !== '' ? param.city : null,
            locality:
              param &&
              param.locality &&
              param.locality !== null &&
              param.locality !== '' &&
              param.locality !== '-'
                ? param.locality
                : null,
            location: { type: 'Point', coordinates: [longitude, latitude] },
            type: 'derived',
            commission: 0,
            posOrderCommission: 0,
            tableOrderCommission: 0,
            subscription: null,
            approxDeliveryTime:
              param &&
              param.approxDeliveryTime &&
              param.approxDeliveryTime !== null &&
              param.approxDeliveryTime !== ''
                ? param.approxDeliveryTime
                : '10 to 20 min',
            dishPriceForTwo:
              param &&
              param.dishPriceForTwo &&
              param.dishPriceForTwo !== null &&
              param.dishPriceForTwo !== ''
                ? param.dishPriceForTwo
                : 0,
            pos: false,
            ownDriver: false,
            promote: false,
            customCategory: false,
            multiOutlet: false,
            preBooking: false,
            tableOrder: false,
            tiffinSubscription: false,
            ownWaiter: false,
            ownKitchen: false,
            takeAway: param && (param.takeAway === 'Yes' || param.takeAway === 'yes'),
            isOutlet: true,
            outletManagerId:
              param &&
              param.outletRestaurantId &&
              param.outletRestaurantId !== null &&
              param.outletRestaurantId !== ''
                ? param.outletRestaurantId
                : null,
            orderLimit:
              param && param.orderLimit && param.orderLimit !== null && param.orderLimit !== ''
                ? param.orderLimit
                : -1,
            productLimit:
              param &&
              param.productLimit &&
              param.productLimit !== null &&
              param.productLimit !== ''
                ? param.productLimit
                : -1,
            slots: [],
            translations: [],
            restaurantType: restaurantTypeList,
            restaurantFacility: restaurantFacilityList,
            diningCategory: diningCategoryList,
            temporaryClosed:
              param && (param.temporaryClosed === 'Yes' || param.temporaryClosed === 'yes'),
            acceptScheduleDelivery:
              param &&
              (param.acceptScheduleDelivery === 'Yes' || param.acceptScheduleDelivery === 'yes'),
            acceptHomeDelivery:
              param && (param.acceptHomeDelivery === 'Yes' || param.acceptHomeDelivery === 'yes'),
            minOrderAmount:
              param &&
              param.minOrderAmount &&
              param.minOrderAmount !== null &&
              param.minOrderAmount !== ''
                ? param.minOrderAmount
                : 0,
            license:
              param &&
              param.license &&
              param.license !== null &&
              param.license !== '' &&
              param.license !== '-'
                ? param.license
                : null,
            licenseId:
              param && param.licenseId && param.licenseId !== null && param.licenseId !== ''
                ? param.licenseId
                : 'NA',
            socialFacebook:
              param &&
              param.socialFacebook &&
              param.socialFacebook !== '' &&
              param.socialFacebook !== null
                ? param.socialFacebook
                : '',
            socialInstagram:
              param &&
              param.socialInstagram &&
              param.socialInstagram !== '' &&
              param.socialInstagram !== null
                ? param.socialInstagram
                : '',
            socialX:
              param && param.socialX && param.socialX !== '' && param.socialX !== null
                ? param.socialX
                : '',
            socialYoutube:
              param &&
              param.socialYoutube &&
              param.socialYoutube !== '' &&
              param.socialYoutube !== null
                ? param.socialYoutube
                : '',
            socialLinkedIn:
              param &&
              param.socialLinkedIn &&
              param.socialLinkedIn !== '' &&
              param.socialLinkedIn !== null
                ? param.socialLinkedIn
                : '',
            socialPinterest:
              param &&
              param.socialPinterest &&
              param.socialPinterest !== '' &&
              param.socialPinterest !== null
                ? param.socialPinterest
                : '',
            status: param && (param.status === 'active' || param.status === 'Active'),
          });
          await Restaurant.create(restaurantData);
        }
      }
    });
  }
  return { success: true };
};

const userTableQrMenu = async (restaurantId, tableId) => {
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
  const restaurantCityLookup = {
    $lookup: {
      from: 'cities',
      localField: 'city',
      foreignField: '_id',
      as: 'cities',
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
  };
  const restaurantLocalitiesLookup = {
    $lookup: {
      from: 'localities',
      localField: 'locality',
      foreignField: '_id',
      as: 'localities',
      pipeline: [
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            slug: 1,
            translations: 1,
          },
        },
      ],
    },
  };
  const restaurantFoodLicenseLookup = {
    $lookup: {
      from: 'restaurantfoodlicenses',
      localField: 'license',
      foreignField: '_id',
      as: 'restaurantfoodlicenses',
      pipeline: [
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            image: 1,
            website: 1,
            translations: 1,
          },
        },
      ],
    },
  };
  const totalRestaurantRatingLookup = {
    $lookup: {
      from: 'restaurantorderreviews',
      localField: '_id',
      foreignField: 'restaurant',
      as: 'restaurantorderreviews',
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
    totalRating: {
      $size: '$restaurantorderreviews',
    },
    restauranttypes: 1,
    status: 1,
    slug: 1,
    cuisine: 1,
    address: 1,
    temporaryClosed: 1,
    cities: {
      id: { $ifNull: ['$cities.id', ''] },
      name: { $ifNull: ['$cities.name', ''] },
      translations: { $ifNull: ['$cities.translations', []] },
    },
    localities: {
      id: { $ifNull: ['$localities.id', ''] },
      name: { $ifNull: ['$localities.name', ''] },
      slug: { $ifNull: ['$localities.slug', ''] },
      translations: { $ifNull: ['$localities.translations', []] },
    },
    license: {
      id: { $ifNull: ['$restaurantfoodlicenses.id', ''] },
      name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
      image: { $ifNull: ['$restaurantfoodlicenses.image', ''] },
      website: { $ifNull: ['$restaurantfoodlicenses.website', ''] },
      translations: { $ifNull: ['$restaurantfoodlicenses.translations', []] },
    },
    licenseId: 1,
    tableOrder: 1,
  };
  const info = await Restaurant.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(restaurantId) } },
    restaurantCuisineLookup,
    restaurantCityLookup,
    {
      $addFields: {
        estimatedDeliveryTime: {
          $switch: {
            branches: [
              { case: { $lte: ['$distance', 5] }, then: 10 }, // 10 minutes for distance <= 5
              {
                case: { $and: [{ $gt: ['$distance', 5] }, { $lte: ['$distance', 10] }] },
                then: 20,
              }, // 20 minutes for 5 < distance <= 10
              {
                case: { $and: [{ $gt: ['$distance', 10] }, { $lte: ['$distance', 20] }] },
                then: 30,
              }, // 30 minutes for 10 < distance <= 20
            ],
            default: 40, // Default to 40 minutes for distance > 20
          },
        },
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    restaurantLocalitiesLookup,
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    restaurantFoodLicenseLookup,
    {
      $unwind: {
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    totalRestaurantRatingLookup,
    { $limit: 1 },
    { $project: filterOptions },
  ]);

  const itemQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
        tableId: new mongoose.Types.ObjectId(tableId),
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
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
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
      $unwind: {
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'foodtaxations',
        localField: 'foods.foodTax',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              taxAmount: {
                $round: [{ $divide: ['$taxAmount', 100] }, 2],
              },
            },
          },
        ],
        as: 'foodtaxations',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        uuid: 1,
        instruction: 1,
        quantity: 1,
        food: 1,
        variations: 1,
        addons: 1,
        foodtaxations: 1,
        foodInfo: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          discountType: { $ifNull: ['$foods.discountType', ''] },
          foodVariations: { $ifNull: ['$foods.variations', []] },
          taxationEnable: { $ifNull: ['$foods.taxationEnable', false] },
          foodType: { $ifNull: ['$foods.foodType', ''] },
          price: {
            $round: [{ $divide: ['$foods.price', 100] }, 2],
          },
          discount: {
            $round: [{ $divide: ['$foods.discount', 100] }, 2],
          },
          translations: { $ifNull: ['$foods.translations', []] },
        },
      },
    },
  ];
  const currentItems = await TableOrderCartItem.aggregate(itemQuery);

  if (info !== null && checkArrayNotEmpty(info)) {
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
        $lookup: {
          from: 'foodorderreviews',
          localField: '_id',
          foreignField: 'food',
          as: 'foodorderreviews',
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
              shortDescription: '$shortDescription',
              image: '$image',
              foodType: '$foodType',
              startTime: '$startTime',
              endTime: '$endTime',
              discountType: '$discountType',
              purchaseLimit: '$purchaseLimit',
              variations: '$variations',
              translations: '$translations',
              recommended: '$recommended',
              rating: '$rating',
              totalRating: {
                $size: '$foodorderreviews',
              },
              status: '$status',
              inStock: '$inStock',
              stockType: '$stockType',
              stockNumber: '$stockNumber',
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              addons: '$addons',
              foodtaxations: '$foodtaxations',
              taxationEnable: '$taxationEnable',
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
          from: 'foodorderreviews',
          localField: '_id',
          foreignField: 'food',
          as: 'foodorderreviews',
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
              shortDescription: '$shortDescription',
              image: '$image',
              foodType: '$foodType',
              startTime: '$startTime',
              endTime: '$endTime',
              discountType: '$discountType',
              purchaseLimit: '$purchaseLimit',
              variations: '$variations',
              translations: '$translations',
              recommended: '$recommended',
              rating: '$rating',
              totalRating: {
                $size: '$foodorderreviews',
              },
              status: '$status',
              inStock: '$inStock',
              stockType: '$stockType',
              stockNumber: '$stockNumber',
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              addons: '$addons',
              foodtaxations: '$foodtaxations',
              taxationEnable: '$taxationEnable',
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
    const queryRecommended = [
      {
        $match: {
          restaurant: new mongoose.Types.ObjectId(restaurantId),
          status: 'live',
          recommended: true,
          inStock: true,
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
          foodtaxations: 1,
          status: 1,
          inStock: 1,
          stockType: 1,
          stockNumber: 1,
          price: {
            $round: [{ $divide: ['$price', 100] }, 2],
          },
          discount: {
            $round: [{ $divide: ['$discount', 100] }, 2],
          },
          taxationEnable: 1,
        },
      },
    ];
    const main = await Food.aggregate(queryMainCategories);
    const custom = await Food.aggregate(queryCustomCategories);
    const recommended = await Food.aggregate(queryRecommended);
    const foodExist = await Food.find({
      restaurant: new mongoose.Types.ObjectId(restaurantId),
      status: 'live',
    });
    const haveData = foodExist.length > 0;
    const details = info[0];
    const notice = await RestaurantNotice.find(
      { status: true },
      { id: 1, name: 1, translations: 1 }
    );
    const tableDetails = await RestaurantTable.findOne(
      { _id: new mongoose.Types.ObjectId(tableId) },
      { tableNumber: 1, capacity: 1 }
    );
    const orderSettings = await OrderSettings.findOne(
      {},
      {
        timeIntervalForScheduleDelivery: 1,
        customerOrderDate: 1,
        customerCanOrderWithinDays: 1,
      }
    );
    return Promise.all([
      info,
      main,
      custom,
      recommended,
      foodExist,
      haveData,
      notice,
      currentItems,
      orderSettings,
      tableDetails,
    ]).then(() => {
      const result = {
        details,
        main,
        custom,
        recommended,
        haveData,
        notice,
        cart: currentItems,
        orders: orderSettings,
        table: tableDetails,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false, info };
};

module.exports = {
  resolveSignupRadiusMeters,
  assertMasterOwnsRestaurant,
  createRestaurant,
  createOutletRestaurant,
  nearMeRestaurant,
  getAllRestaurant,
  getRestaurantById,
  updateStatus,
  getById,
  updateRestaurantById,
  updateOutletById,
  getByCityId,
  getByUserId,
  getByManagerId,
  getRestaurantLimitedDetails,
  getMyInfo,
  getByUserIdVendorLogin,
  getRestaurantByIdVendorLogin,
  getSlots,
  updateSlotByRestaurantId,
  updateSlotByRestaurantIdWeb,
  getRestaurantsByCuisine,
  getRestaurantsByCategory,
  getFoodsNearMeByCategory,
  getRestaurantsByBrands,
  getRestaurantsInfo,
  driverNearTrendingRestaurant,
  getRestaurantsByLocalities,
  globalSearch,
  globalSearchInitial,
  foodSearchInitial,
  foodSearch,
  getAllOutlet,
  getMyOutletList,
  getRestaurantsByCityIdLimitedDetailsForAdmin,
  getRestaurantByCityIdFromCollectCash,
  getRestaurantInfoForNewDriver,
  getRestaurantsByCityIdForTiffinPackagesAdmin,
  getDiningSupportedRestaurantByCityId,
  nearMeDiningRestaurant,
  nearMeDiningRestaurantOnMap,
  getVendorDiningInformation,
  getVendorDiningInformationWeb,
  updateDiningInformation,
  getDiningByCategory,
  globalDiningSearchInitial,
  globalDiningSearch,
  getRestaurantDetailInformation,
  getDiningBookingInformation,
  getDiningBookingConfirmInformation,
  fetchResturantPhoneNumber,
  getRestaurantInfoForDirectReview,
  globalRestaurantSearchForReview,
  getRestaurantLoginResponse,
  getRestaurantExtraInformation,
  updateMenuAndPhotoInformation,
  getRestaurantDetailForUpdateApp,
  updateRestaurantDetail,
  getOutletPermission,
  getOutletDetailForApp,
  closeTemporaryRestaurant,
  reOpenTemporaryRestaurant,
  addMoneyToWalletAfterDelivery,
  restaurantWalletDetail,
  getRestaurantManagerTypeAndCommission,
  getPosData,
  getPosDataWeb,
  getPosFoodDataWeb,
  posFoodSearchInitialData,
  posFoodSearch,
  checkPosPermissionOfRestaurant,
  waiterFoodList,
  waiterFoodSearchInitialData,
  waiterFoodSearch,
  checkTableOrderPermission,
  blockExpiredSubscriptionRestaurants,
  getExpiringSoonRestaurants,
  getVendorSubscriptionStatus,
  vendorSubscriptionInfo,
  restaurantReport,
  restauratReportInitialFilter,
  vendorOutletList,
  vendorInformation,
  posRestaurantListFromCity,
  posRestaurantData,
  cityMapDialogData,
  cityMapDialogRestaurants,
  filterRestaurantList,
  filterQueryData,
  filterQuery,
  supportTeamRestaurantList,
  supportTeamRestaurantDetail,
  getCityzenRestaurant,
  getCityzenOutlet,
  cityzenFilterQueryData,
  cityzenFilterQuery,
  cityzenDetail,
  cityzenUpdateRestaurantById,
  cityzenCreateRestaurant,
  cityzenRestaurantsLimitedDetails,
  vendorTableQrDetail,
  exportCollectionRestaurantAllData,
  exportRawRestaurantCollection,
  exportCollectionOutletAllData,
  exportRawOutletCollection,
  exportRestaurantFilterTypeCollection,
  exportRawRestaurantFilterTypeCollection,
  exportRestaurantFilterQueryCollection,
  exportRawRestaurantFilterQueryCollection,
  exportRestaurantReportCollection,
  importRestaurantCollection,
  importRestaurantOutletCollection,
  userTableQrMenu,
};
