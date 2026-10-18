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
const multer = require('multer');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { updateDeliveryConfig, resolveDeliveryPolicy, narrowDeliveryConfig, resolveCustomerCoverage } = require('../utils/delivery.policy');
const {
  userService,
  walletService,
  restaurantService,
  cuisineService,
  cityService,
  subscriptionService,
  subscriberService,
  restaurantFoodLicenseService,
  driverService,
  restaurantTypeService,
  restaurantFacilitiesService,
  localityService,
  restaurantCashInHandService,
  joiningFormService,
  paymentConfigService,
  businessSettingsService,
  paymentInitiationService,
} = require('../services');
const { Wallet } = require('../models');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const {
  restaurantSchemaKeys,
  restaurantOutletSchemaKeys,
} = require('../utils/importCollectionSchema');

const registerVendorAccount = catchAsync(async (req, res) => {
  const user = await userService.createVendorAccount(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  req.body.userId = user.id;
  if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
    req.body.cuisine = req.body.cuisine.split(',');
  } else {
    req.body.cuisine = [];
  }
  if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
    req.body.restaurantType = req.body.restaurantType.split(',');
  } else {
    req.body.restaurantType = [];
  }
  if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
    req.body.restaurantFacility = req.body.restaurantFacility.split(',');
  } else {
    req.body.restaurantFacility = [];
  }
  const restaurant = await restaurantService.createRestaurant(req.body);
  if (
    req &&
    req.body &&
    req.body.subscription &&
    req.body.subscription !== '' &&
    req.body.subscription !== null
  ) {
    const subscription = await subscriptionService.getById(req.body.subscription);
    const serverStartDate = DateTime.now().toFormat('yyyy-MM-dd');
    const serverEndDate = DateTime.now()
      .plus({ days: subscription.validity })
      .toFormat('yyyy-MM-dd');
    const subscriptionData = {
      subscriptions: req.body.subscription,
      restaurant: restaurant.id,
      trialStartDate: '',
      trialEndDate: '',
      startDate: serverStartDate,
      endDate: serverEndDate,
    };
    await subscriberService.createSubscriber(subscriptionData);
  }
  res.status(201).send({ success: true });
});

const cityzenRegisterVendorAccount = catchAsync(async (req, res) => {
  const { master } = req.params;
  const user = await userService.cityzenCreateVendorAccount(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  req.body.userId = user.id;
  if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
    req.body.cuisine = req.body.cuisine.split(',');
  } else {
    req.body.cuisine = [];
  }
  if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
    req.body.restaurantType = req.body.restaurantType.split(',');
  } else {
    req.body.restaurantType = [];
  }
  if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
    req.body.restaurantFacility = req.body.restaurantFacility.split(',');
  } else {
    req.body.restaurantFacility = [];
  }
  const restaurant = await restaurantService.cityzenCreateRestaurant(master, req.body);
  if (
    req &&
    req.body &&
    req.body.subscription &&
    req.body.subscription !== '' &&
    req.body.subscription !== null
  ) {
    const subscription = await subscriptionService.getById(req.body.subscription);
    const serverStartDate = DateTime.now().toFormat('yyyy-MM-dd');
    const serverEndDate = DateTime.now()
      .plus({ days: subscription.validity })
      .toFormat('yyyy-MM-dd');
    const subscriptionData = {
      subscriptions: req.body.subscription,
      restaurant: restaurant.id,
      trialStartDate: '',
      trialEndDate: '',
      startDate: serverStartDate,
      endDate: serverEndDate,
    };
    await subscriberService.createSubscriber(subscriptionData);
  }
  res.status(201).send({ success: true });
});

const registerOutletAccount = catchAsync(async (req, res) => {
  const checkPermission = await restaurantService.getOutletPermission(req.body.managerId);
  if (checkPermission && checkPermission !== null && checkPermission.multiOutlet === true) {
    const user = await userService.createOutletAccount(req.body);
    const walletData = new Wallet({
      holderId: user.id,
    });
    await walletService.createWallet(walletData);
    req.body.userId = user.id;
    req.body.outletManagerId = req.body.managerId; // main outlet manager owner Id
    if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
      req.body.cuisine = req.body.cuisine.split(',');
    } else {
      req.body.cuisine = [];
    }
    if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
      req.body.restaurantType = req.body.restaurantType.split(',');
    } else {
      req.body.restaurantType = [];
    }
    if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
      req.body.restaurantFacility = req.body.restaurantFacility.split(',');
    } else {
      req.body.restaurantFacility = [];
    }
    req.body.orderLimit = checkPermission.orderLimit;
    req.body.productLimit = checkPermission.productLimit;
    await restaurantService.createOutletRestaurant(req.body);
    res.status(201).send({ success: true });
  } else {
    res.status(500).send({ error: 'Something went wrong' });
  }
});

const getBasicDataForNewOutlet = catchAsync(async (req, res) => {
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const cities = await cityService.getCitiesListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({ cuisine, cities, licenses, types, facilities });
});

const getBasicDataForNewOutletFromApp = catchAsync(async (req, res) => {
  const cities = await cityService.getCitiesListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const localities = await localityService.getActiveLocalites();
  res.send({ cities, localities, licenses, success: true });
});

const getBasicDataRegisterRequest = catchAsync(async (req, res) => {
  const cities = await cityService.getCitiesListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const joiningForm = await joiningFormService.getRestaurantJoiningField();
  const subscriptionPackages = await subscriptionService.getSubscriptionListForNewRestaurant();
  const payment = await paymentConfigService.getOnlinePaymentList();
  const settings = await businessSettingsService.getBusinessSettingForSelfRegistration();
  res.send({
    cities,
    licenses,
    joiningForm,
    subscriptionPackages,
    payment,
    settings,
    success: true,
  });
});

const getBasicDataRegisterRequestWeb = catchAsync(async (req, res) => {
  const cities = await cityService.getCitiesListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const joiningForm = await joiningFormService.getRestaurantJoiningField();
  const subscriptionPackages = await subscriptionService.getSubscriptionListForNewRestaurant();
  const payment = await paymentConfigService.getOnlinePaymentList();
  const settings = await businessSettingsService.getBusinessSettingForSelfRegistration();
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({
    cities,
    licenses,
    joiningForm,
    subscriptionPackages,
    payment,
    settings,
    cuisine,
    types,
    facilities,
    success: true,
  });
});

const getBasicDataForNewRestaurant = catchAsync(async (req, res) => {
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const cities = await cityService.getCitiesListForNewRestaurant();
  const subscription = await subscriptionService.getSubscriptionListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({ cuisine, cities, subscription, licenses, types, facilities });
});

const cityzenBasicDataForNewRestaurant = catchAsync(async (req, res) => {
  const { master } = req.params;
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const cityzen = await restaurantService.cityzenDetail(master);
  const subscription = await subscriptionService.getSubscriptionListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({ cityzen, cuisine, subscription, licenses, types, facilities });
});

const getNearMeRestaurants = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await restaurantService.nearMeRestaurant(
    req.body.latitude,
    req.body.longitude,
    req.body.uid,
    options
  );
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await restaurantService.getAllRestaurant(options);
  res.send(result);
});

const cityzenRestaurants = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await restaurantService.getCityzenRestaurant(master, options);
  res.send(result);
});

const getOutlets = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await restaurantService.getAllOutlet(options);
  res.send(result);
});

const cityzenOutlets = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await restaurantService.getCityzenOutlet(master, options);
  res.send(result);
});

const getMyOutlets = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await restaurantService.getMyOutletList(req.params.restaurantId, options);
  res.send(result);
});

const updateStatus = catchAsync(async (req, res) => {
  const restaurant = await restaurantService.updateStatus(req.params.restaurantId, req.body);
  res.send(restaurant);
});

const getById = catchAsync(async (req, res) => {
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const cities = await cityService.getCitiesListForNewRestaurant();
  const subscription = await subscriptionService.getSubscriptionListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const info = await restaurantService.getById(req.params.restaurantId);
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({ cuisine, cities, subscription, info, licenses, types, facilities });
});

const cityzenRestuarantGetById = catchAsync(async (req, res) => {
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const subscription = await subscriptionService.getSubscriptionListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const info = await restaurantService.getById(req.params.restaurantId);
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({ cuisine, subscription, info, licenses, types, facilities });
});

const getRestaurantDetailWebForUpdate = catchAsync(async (req, res) => {
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const info = await restaurantService.getById(req.params.restaurantId);
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({ cuisine, info, licenses, types, facilities });
});

const update = catchAsync(async (req, res) => {
  if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
    req.body.cuisine = req.body.cuisine.split(',');
  } else {
    req.body.cuisine = [];
  }
  if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
    req.body.restaurantType = req.body.restaurantType.split(',');
  } else {
    req.body.restaurantType = [];
  }
  if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
    req.body.restaurantFacility = req.body.restaurantFacility.split(',');
  } else {
    req.body.restaurantFacility = [];
  }
  const restaurant = await restaurantService.updateRestaurantById(
    req.params.restaurantId,
    req.body
  );
  res.send(restaurant);
});

const cityzenUpdateRestaurant = catchAsync(async (req, res) => {
  const { master } = req.params;
  if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
    req.body.cuisine = req.body.cuisine.split(',');
  } else {
    req.body.cuisine = [];
  }
  if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
    req.body.restaurantType = req.body.restaurantType.split(',');
  } else {
    req.body.restaurantType = [];
  }
  if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
    req.body.restaurantFacility = req.body.restaurantFacility.split(',');
  } else {
    req.body.restaurantFacility = [];
  }
  const restaurant = await restaurantService.cityzenUpdateRestaurantById(
    master,
    req.params.restaurantId,
    req.body
  );
  res.send(restaurant);
});

const updateOutlet = catchAsync(async (req, res) => {
  if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
    req.body.cuisine = req.body.cuisine.split(',');
  } else {
    req.body.cuisine = [];
  }
  if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
    req.body.restaurantType = req.body.restaurantType.split(',');
  } else {
    req.body.restaurantType = [];
  }
  if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
    req.body.restaurantFacility = req.body.restaurantFacility.split(',');
  } else {
    req.body.restaurantFacility = [];
  }
  const restaurant = await restaurantService.updateOutletById(req.params.restaurantId, req.body);
  res.send(restaurant);
});

const getMyProfile = catchAsync(async (req, res) => {
  const restaurant = await restaurantService.getByUserId(req.params.userId);
  if (restaurant && !restaurant.isOutlet) {
    res.send({ restaurant });
  } else if (restaurant && restaurant.isOutlet) {
    const manager = await restaurantService.getByManagerId(restaurant.outletManagerId);
    res.send({ restaurant, manager });
  } else {
    res.send({ restaurant });
  }
});

const getRestaurantByCityId = catchAsync(async (req, res) => {
  const restaurants = await restaurantService.getByCityId(req.params.cityId);
  res.send({ restaurants });
});

const getSlot = catchAsync(async (req, res) => {
  const slots = await restaurantService.getSlots(req.params.restaurantId);
  if (slots && slots.slots.length <= 0) {
    slots.slots = [
      {
        day: 0, // Monday
        times: [],
      },
      {
        day: 1, // Tuesday
        times: [],
      },
      {
        day: 2, // Wednesday
        times: [],
      },
      {
        day: 3, // Thursday
        times: [],
      },
      {
        day: 4, // Friday
        times: [],
      },
      {
        day: 5, // Saturday
        times: [],
      },
      {
        day: 6, // Sunday
        times: [],
      },
    ];
  }
  res.send(slots);
});

const updateSlot = catchAsync(async (req, res) => {
  const restaurant = await restaurantService.updateSlotByRestaurantId(
    req.params.restaurantId,
    req.body
  );
  res.send(restaurant);
});

const updateSlotWeb = catchAsync(async (req, res) => {
  const restaurant = await restaurantService.updateSlotByRestaurantIdWeb(
    req.params.restaurantId,
    req.body
  );
  res.send(restaurant);
});

const getRestaurantsByCuisine = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const restaurant = await restaurantService.getRestaurantsByCuisine(
    req.body.cuisine,
    req.body.latitude,
    req.body.longitude,
    req.body.uid,
    options
  );
  res.send(restaurant);
});

const getRestaurantsByCategory = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const restaurant = await restaurantService.getRestaurantsByCategory(
    req.body.category,
    req.body.latitude,
    req.body.longitude,
    req.body.uid,
    options
  );
  res.send(restaurant);
});

const getFoodsNearMeByCategory = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const restaurant = await restaurantService.getFoodsNearMeByCategory(
    req.body.category,
    req.body.latitude,
    req.body.longitude,
    req.body.uid,
    options
  );
  res.send(restaurant);
});

const getRestaurantsByBrand = catchAsync(async (req, res) => {
  const restaurant = await restaurantService.getRestaurantsByBrands(
    req.body.outlet,
    req.body.latitude,
    req.body.longitude,
    req.body.uid
  );
  res.send(restaurant);
});

const getRestaurantsByLocalities = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const restaurant = await restaurantService.getRestaurantsByLocalities(
    req.body.from,
    req.body.slug,
    req.body.latitude,
    req.body.longitude,
    req.body.uid,
    options
  );
  res.send(restaurant);
});

const getRestaurantsInfo = catchAsync(async (req, res) => {
  const info = await restaurantService.getRestaurantsInfo(
    req.body.slug,
    req.body.latitude,
    req.body.longitude,
    req.body.uid
  );
  res.send(info);
});

const driverNearTrendingRestaurant = catchAsync(async (req, res) => {
  await driverService.updateDriverLocation(
    req.body.driverId,
    req.body.latitude,
    req.body.longitude
  );
  const results = await restaurantService.driverNearTrendingRestaurant(
    req.body.latitude,
    req.body.longitude,
    req.body.driverId
  );
  res.send(results);
});

const globalSearchInitial = catchAsync(async (req, res) => {
  const { latitude, longitude } = req.body;
  const result = await restaurantService.globalSearchInitial(latitude, longitude);
  res.send(result);
});

const globalSearch = catchAsync(async (req, res) => {
  const { latitude, longitude, searchQuery } = req.body;
  const result = await restaurantService.globalSearch(latitude, longitude, searchQuery);
  res.send(result);
});

const foodSearchInitial = catchAsync(async (req, res) => {
  const { id, uid } = req.body;
  const result = await restaurantService.foodSearchInitial(id, uid);
  res.send(result);
});

const foodSearch = catchAsync(async (req, res) => {
  const { id, uid, searchQuery } = req.body;
  const result = await restaurantService.foodSearch(id, uid, searchQuery);
  res.send(result);
});

const getRestaurantsByCityIdLimitedDetailsForAdmin = catchAsync(async (req, res) => {
  const { cityId } = req.params;
  const result = await restaurantService.getRestaurantsByCityIdLimitedDetailsForAdmin(cityId);
  res.send(result);
});

const cityzenRestaurantsLimitedDetails = catchAsync(async (req, res) => {
  const { master } = req.params;
  const result = await restaurantService.cityzenRestaurantsLimitedDetails(master);
  res.send(result);
});

const getRestaurantByCityIdFromCollectCash = catchAsync(async (req, res) => {
  const { cityId } = req.params;
  const result = await restaurantService.getRestaurantByCityIdFromCollectCash(cityId);
  res.send(result);
});

const getRestaurantsByCityIdForTiffinPackagesAdmin = catchAsync(async (req, res) => {
  const { cityId } = req.params;
  const result = await restaurantService.getRestaurantsByCityIdForTiffinPackagesAdmin(cityId);
  res.send(result);
});

const getDiningSupportedRestaurantByCityId = catchAsync(async (req, res) => {
  const { cityId } = req.params;
  const result = await restaurantService.getDiningSupportedRestaurantByCityId(cityId);
  res.send(result);
});

const getNearMeDiningRestaurants = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await restaurantService.nearMeDiningRestaurant(
    req.body.latitude,
    req.body.longitude,
    req.body.uid,
    options
  );
  res.send(result);
});

const getNearMeDiningRestaurantOnMap = catchAsync(async (req, res) => {
  const { latitude, longitude } = req.body;
  const result = await restaurantService.nearMeDiningRestaurantOnMap(latitude, longitude);
  res.send(result);
});

const getVendorDiningInformation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.getVendorDiningInformation(id);
  res.send(result);
});

const getVendorDiningInformationWeb = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.getVendorDiningInformationWeb(id);
  res.send(result);
});

const getRestaurantExtraInformation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.getRestaurantExtraInformation(id);
  res.send(result);
});

const updateDiningInformation = catchAsync(async (req, res) => {
  const { id } = req.params;
  if (req && req.body && req.body.categories && req.body.categories !== '') {
    req.body.categories = req.body.categories.split(',');
  } else {
    req.body.categories = [];
  }
  const result = await restaurantService.updateDiningInformation(id, req.body);
  res.send(result);
});

const updateMenuAndPhotoInformation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.updateMenuAndPhotoInformation(id, req.body);
  res.send(result);
});

const getDiningByCategory = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const restaurant = await restaurantService.getDiningByCategory(
    req.body.category,
    req.body.latitude,
    req.body.longitude,
    req.body.uid,
    options
  );
  res.send(restaurant);
});

const globalDiningSearchInitial = catchAsync(async (req, res) => {
  const { latitude, longitude } = req.body;
  const result = await restaurantService.globalDiningSearchInitial(latitude, longitude);
  res.send(result);
});

const globalDiningSearch = catchAsync(async (req, res) => {
  const { latitude, longitude, searchQuery } = req.body;
  const result = await restaurantService.globalDiningSearch(latitude, longitude, searchQuery);
  res.send(result);
});

const getRestaurantDetailInformation = catchAsync(async (req, res) => {
  const { latitude, longitude, slug, uid } = req.body;
  const result = await restaurantService.getRestaurantDetailInformation(
    latitude,
    longitude,
    slug,
    uid
  );
  res.send(result);
});

const getDiningBookingInformation = catchAsync(async (req, res) => {
  const { slug, id, latitude, longitude } = req.body;
  const result = await restaurantService.getDiningBookingInformation(latitude, longitude, slug, id);
  res.send(result);
});

const getDiningBookingConfirmInformation = catchAsync(async (req, res) => {
  const { slug, uid, coupon } = req.body;
  const result = await restaurantService.getDiningBookingConfirmInformation(slug, uid, coupon);
  res.send(result);
});

const fetchResturantPhoneNumber = catchAsync(async (req, res) => {
  const { restaurant } = req.params;
  const result = await restaurantService.fetchResturantPhoneNumber(restaurant);
  res.send(result);
});

const getRestaurantInfoForDirectReview = catchAsync(async (req, res) => {
  const { restaurant } = req.params;
  const result = await restaurantService.getRestaurantInfoForDirectReview(restaurant);
  res.send(result);
});

const globalRestaurantSearchForReview = catchAsync(async (req, res) => {
  const { searchQuery } = req.body;
  const result = await restaurantService.globalRestaurantSearchForReview(searchQuery);
  res.send(result);
});

const getRestaurantDetailForUpdateApp = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.getRestaurantDetailForUpdateApp(id);
  res.send(result);
});

const updateRestaurantDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
    req.body.cuisine = req.body.cuisine.split(',');
  } else {
    req.body.cuisine = [];
  }
  if (req && req.body && req.body.type && req.body.type !== '') {
    req.body.type = req.body.type.split(',');
  } else {
    req.body.type = [];
  }
  if (req && req.body && req.body.facility && req.body.facility !== '') {
    req.body.facility = req.body.facility.split(',');
  } else {
    req.body.facility = [];
  }
  const result = await restaurantService.updateRestaurantDetail(id, req.body);
  res.send(result);
});

const getOutletDetailForApp = catchAsync(async (req, res) => {
  const { id, vendorId } = req.params;
  const result = await restaurantService.getOutletDetailForApp(id, vendorId);
  const cities = await cityService.getCitiesListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const localities = await localityService.getActiveLocalites();
  res.send({ result, cities, licenses, localities, success: true });
});

const closeTemporaryRestaurant = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.closeTemporaryRestaurant(id);
  res.send(result);
});

const reOpenTemporaryRestaurant = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.reOpenTemporaryRestaurant(id);
  res.send(result);
});

const restaurantWalletDetail = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.restaurantWalletDetail(vendor);
  res.send(result);
});

const getRestaurantCashInHand = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantCashInHandService.getRestaurantCashInHand(vendor);
  res.send(result);
});

const clearCashInHandAndUpdateWallet = catchAsync(async (req, res) => {
  const { vendor, method, reference } = req.body;
  const result = await restaurantCashInHandService.clearCashInHandAndUpdateWallet(
    vendor,
    method,
    reference
  );
  res.send(result);
});

const cashOnHandHistory = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await restaurantCashInHandService.cashOnHandHistory(vendor, options);
  res.send(result);
});

const posAndTableOrderCommissionHistory = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await restaurantCashInHandService.posAndTableOrderCommissionHistory(
    vendor,
    options
  );
  res.send(result);
});

const cashCollectedHistory = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await restaurantCashInHandService.cashCollectedHistory(vendor, options);
  res.send(result);
});

const getPosData = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.getPosData(vendor);
  res.send(result);
});

const getPosDataWeb = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.getPosDataWeb(vendor);
  res.send(result);
});

const getPosFoodDataWeb = catchAsync(async (req, res) => {
  const { vendor, kind, category } = req.body;
  const result = await restaurantService.getPosFoodDataWeb(vendor, kind, category);
  res.send(result);
});

const posFoodSearchInitialData = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.posFoodSearchInitialData(vendor);
  res.send(result);
});

const posFoodSearch = catchAsync(async (req, res) => {
  const { vendor, searchQuery } = req.params;
  const result = await restaurantService.posFoodSearch(vendor, searchQuery);
  res.send(result);
});

const getVendorSubscriptionStatus = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.getVendorSubscriptionStatus(vendor);
  res.send(result);
});

const vendorSubscriptionInfo = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.vendorSubscriptionInfo(vendor);
  res.send(result);
});

const vendorRenewSubscription = catchAsync(async (req, res) => {
  const { user, payment, subscriber, packageId } = req.body;
  const subscriptionInfo = await subscriptionService.getById(packageId);
  let payCharge;
  if (parseFloat(subscriptionInfo.discount) > 0) {
    const payChargeAmount = parseFloat(
      (parseFloat(subscriptionInfo.price).toFixed(2) *
        parseFloat(subscriptionInfo.discount).toFixed(2)) /
        100
    ).toFixed(2);
    const payChargeFinalPrice = (
      parseFloat(subscriptionInfo.price) - parseFloat(payChargeAmount)
    ).toFixed(2);
    payCharge = parseFloat(payChargeFinalPrice);
  } else {
    payCharge = subscriptionInfo.price;
  }
  const paymentMeta = {
    user: `${user}`,
    payment: `${payment}`,
    subscribeId: subscriber,
    amount: parseFloat(payCharge),
    from: 'renew_subscription',
    ref: `renew subscription package for ${subscriber}`,
  };
  const paymentLink = await paymentInitiationService.initiatePayment(paymentMeta);
  if (paymentLink !== null && paymentLink.id !== '') {
    res.status(201).send({ success: true, payLink: paymentLink.id });
  } else {
    res.status(400).send({
      code: 400,
      message: 'Something went wrong, please contact administrator',
      extra: '',
    });
  }
});

const restauratReportInitialFilter = catchAsync(async (req, res) => {
  const result = await restaurantService.restauratReportInitialFilter();
  res.send(result);
});

const restaurantReport = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'city',
    'type',
    'category',
    'filter',
    'search',
    'limit',
    'page',
  ]);
  const result = await restaurantService.restaurantReport(options);
  res.send(result);
});

const vendorOutletList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await restaurantService.vendorOutletList(options);
  res.send(result);
});

const vendorInformation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.vendorInformation(id);
  res.send(result);
});

const posRestaurantListFromCity = catchAsync(async (req, res) => {
  const { cityId } = req.params;
  const result = await restaurantService.posRestaurantListFromCity(cityId);
  res.send(result);
});

const posRestaurantData = catchAsync(async (req, res) => {
  const { restaurantId } = req.params;
  const result = await restaurantService.posRestaurantData(restaurantId);
  res.send(result);
});

const cityMapDialogData = catchAsync(async (req, res) => {
  const { city } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await restaurantService.cityMapDialogData(city, options);
  res.send(result);
});

const cityMapDialogRestaurants = catchAsync(async (req, res) => {
  const { city } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await restaurantService.cityMapDialogRestaurants(city, options);
  res.send(result);
});

const filterRestaurantList = catchAsync(async (req, res) => {
  const { id, kind } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await restaurantService.filterRestaurantList(id, kind, options);
  res.send(result);
});

const filterQueryData = catchAsync(async (req, res) => {
  const result = await restaurantService.filterQueryData();
  res.send(result);
});

const cityzenFilterQueryData = catchAsync(async (req, res) => {
  const result = await restaurantService.cityzenFilterQueryData();
  res.send(result);
});

const filterQuery = catchAsync(async (req, res) => {
  const { city, cuisine, category, facility, type } = req.body;
  const options = pick(req.query, ['limit', 'page']);
  const result = await restaurantService.filterQuery(
    city,
    cuisine,
    category,
    facility,
    type,
    options
  );
  res.send(result);
});

const cityzenFilterQuery = catchAsync(async (req, res) => {
  const { master, cuisine, category, facility, type } = req.body;
  const options = pick(req.query, ['limit', 'page']);
  const result = await restaurantService.cityzenFilterQuery(
    master,
    cuisine,
    category,
    facility,
    type,
    options
  );
  res.send(result);
});

const supportTeamRestaurantList = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'city',
    'type',
    'category',
    'filter',
    'search',
    'limit',
    'page',
  ]);
  const result = await restaurantService.supportTeamRestaurantList(options);
  res.send(result);
});

const supportTeamRestaurantDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantService.supportTeamRestaurantDetail(id);
  res.send(result);
});

const vendorTableQrDetail = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.vendorTableQrDetail(vendor);
  res.send(result);
});

const exportCollectionRestaurantAllData = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await restaurantService.exportCollectionRestaurantAllData(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
        pos: detail.pos ? 'Yes' : 'No',
        ownDriver: detail.ownDriver ? 'Yes' : 'No',
        promote: detail.promote ? 'Yes' : 'No',
        customCategory: detail.customCategory ? 'Yes' : 'No',
        multiOutlet: detail.multiOutlet ? 'Yes' : 'No',
        preBooking: detail.preBooking ? 'Yes' : 'No',
        tableOrder: detail.tableOrder ? 'Yes' : 'No',
        tiffinSubscription: detail.tiffinSubscription ? 'Yes' : 'No',
        ownWaiter: detail.ownWaiter ? 'Yes' : 'No',
        ownKitchen: detail.ownKitchen ? 'Yes' : 'No',
        takeAway: detail.takeAway ? 'Yes' : 'No',
        temporaryClosed: detail.temporaryClosed ? 'Yes' : 'No',
        acceptScheduleDelivery: detail.acceptScheduleDelivery ? 'Yes' : 'No',
        acceptHomeDelivery: detail.acceptHomeDelivery ? 'Yes' : 'No',
        latitude: detail.location.coordinates[1] || 0,
        longitude: detail.location.coordinates[0] || 0,
        orderLimit: detail && detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        productLimit: detail && detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        licenseName:
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        subscriptionName:
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        ownerId:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.id &&
          detail.owerInfo.id !== null &&
          detail.owerInfo.id !== ''
            ? detail.owerInfo.id
            : '-',
        ownerFirstName:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.firstName &&
          detail.owerInfo.firstName !== null &&
          detail.owerInfo.firstName !== ''
            ? detail.owerInfo.firstName
            : '-',
        ownerLastName:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.lastName &&
          detail.owerInfo.lastName !== null &&
          detail.owerInfo.lastName !== ''
            ? detail.owerInfo.lastName
            : '-',
        ownerContryCode:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.countryCode &&
          detail.owerInfo.countryCode !== null &&
          detail.owerInfo.countryCode !== ''
            ? detail.owerInfo.countryCode
            : '-',
        ownerMobile:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.mobile &&
          detail.owerInfo.mobile !== null &&
          detail.owerInfo.mobile !== ''
            ? detail.owerInfo.mobile
            : '-',
        ownerEmail:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.email &&
          detail.owerInfo.email !== null &&
          detail.owerInfo.email !== ''
            ? detail.owerInfo.email
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Restaurants');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'OwnerId', key: 'ownerId' },
        { header: 'First Name', key: 'ownerFirstName' },
        { header: 'Last Name', key: 'ownerLastName' },
        { header: 'Country Code', key: 'ownerContryCode' },
        { header: 'Mobile', key: 'ownerMobile' },
        { header: 'Email', key: 'ownerEmail' },
        { header: 'Name', key: 'name' },
        { header: 'Slug', key: 'slug' },
        { header: 'Address', key: 'address' },
        { header: 'Logo', key: 'logo' },
        { header: 'Cover', key: 'cover' },
        { header: 'City', key: 'cityName' },
        { header: 'Locality', key: 'localityName' },
        { header: 'Latitude', key: 'latitude' },
        { header: 'Longitude', key: 'longitude' },
        { header: 'Type', key: 'type' },
        { header: 'Subscription Name', key: 'subscriptionName' },
        { header: 'Regular Order Commission', key: 'commission' },
        { header: 'POS Order Commission', key: 'posOrderCommission' },
        { header: 'Table Order Commission', key: 'tableOrderCommission' },
        { header: 'Appx Delivery Time', key: 'approxDeliveryTime' },
        { header: 'POS', key: 'pos' },
        { header: 'Own Driver', key: 'ownDriver' },
        { header: 'Promote', key: 'promote' },
        { header: 'Custom Category', key: 'customCategory' },
        { header: 'Multi Outlet', key: 'multiOutlet' },
        { header: 'Pre Booking', key: 'preBooking' },
        { header: 'Table Order', key: 'tableOrder' },
        { header: 'Tiffin Subscription', key: 'tiffinSubscription' },
        { header: 'Own Waiter', key: 'ownWaiter' },
        { header: 'Own Kitchen', key: 'ownKitchen' },
        { header: 'TakeAway', key: 'takeAway' },
        { header: 'Temp Closed', key: 'temporaryClosed' },
        { header: 'Accept Schedule Delivery', key: 'acceptScheduleDelivery' },
        { header: 'Accept Home Delivery', key: 'acceptHomeDelivery' },
        { header: 'Order Limit', key: 'orderLimit' },
        { header: 'Product Limit', key: 'productLimit' },
        { header: 'License Name', key: 'licenseName' },
        { header: 'License Id', key: 'licenseId' },
        { header: 'Dish Price For Two', key: 'dishPriceForTwo' },
        { header: 'Min Order Amount', key: 'minOrderAmount' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'Facebook Handle', key: 'socialFacebook' },
        { header: 'Instagram Handle', key: 'socialInstagram' },
        { header: 'X Handle', key: 'socialX' },
        { header: 'Youtube Handle', key: 'socialYoutube' },
        { header: 'LinkedIn Handle', key: 'socialLinkedIn' },
        { header: 'Pinterest Handle', key: 'socialPinterest' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        OwnerId:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.id &&
          detail.owerInfo.id !== null &&
          detail.owerInfo.id !== ''
            ? detail.owerInfo.id
            : '-',
        'First Name':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.firstName &&
          detail.owerInfo.firstName !== null &&
          detail.owerInfo.firstName !== ''
            ? detail.owerInfo.firstName
            : '-',
        'Last Name':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.lastName &&
          detail.owerInfo.lastName !== null &&
          detail.owerInfo.lastName !== ''
            ? detail.owerInfo.lastName
            : '-',
        'Country Code':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.countryCode &&
          detail.owerInfo.countryCode !== null &&
          detail.owerInfo.countryCode !== ''
            ? detail.owerInfo.countryCode
            : '-',
        Mobile:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.mobile &&
          detail.owerInfo.mobile !== null &&
          detail.owerInfo.mobile !== ''
            ? detail.owerInfo.mobile
            : '-',
        Email:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.email &&
          detail.owerInfo.email !== null &&
          detail.owerInfo.email !== ''
            ? detail.owerInfo.email
            : '-',
        Name: detail.name,
        Slug: detail.slug,
        Address: detail.address,
        Logo: detail.logo,
        Cover: detail.cover,
        City:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        Locality:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        Latitude: detail.location.coordinates[1] || 0,
        Longitude: detail.location.coordinates[0] || 0,
        Type: detail.type,
        'Subscription Name':
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        'Regular Order Commission': detail.commission,
        'POS Order Commission': detail.posOrderCommission,
        'Table Order Commission': detail.tableOrderCommission,
        'Appx Delivery Time': detail.approxDeliveryTime,
        POS: detail.pos ? 'Yes' : 'No',
        'Own Driver': detail.ownDriver ? 'Yes' : 'No',
        Promote: detail.promote ? 'Yes' : 'No',
        'Custom Category': detail.customCategory ? 'Yes' : 'No',
        'Multi Outlet': detail.multiOutlet ? 'Yes' : 'No',
        'Pre Booking': detail.preBooking ? 'Yes' : 'No',
        'Table Order': detail.tableOrder ? 'Yes' : 'No',
        'Tiffin Subscription': detail.tiffinSubscription ? 'Yes' : 'No',
        'Own Waiter': detail.ownWaiter ? 'Yes' : 'No',
        'Own Kitchen': detail.ownKitchen ? 'Yes' : 'No',
        TakeAway: detail.takeAway ? 'Yes' : 'No',
        'Temp Closed': detail.temporaryClosed ? 'Yes' : 'No',
        'Accept Schedule Delivery': detail.acceptScheduleDelivery ? 'Yes' : 'No',
        'Accept Home Delivery': detail.acceptHomeDelivery ? 'Yes' : 'No',
        'Order Limit': detail && detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        'Product Limit': detail && detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        'License Name':
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        'License Id': detail.licenseId,
        'Dish Price For Two': detail.dishPriceForTwo,
        'Min Order Amount': detail.minOrderAmount,
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        'Facebook Handle': detail.socialFacebook,
        'Instagram Handle': detail.socialInstagram,
        'X Handle': detail.socialX,
        'Youtube Handle': detail.socialYoutube,
        'LinkedIn Handle': detail.socialLinkedIn,
        'Pinterest Handle': detail.socialPinterest,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await restaurantService.exportRawRestaurantCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/restaurants.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurants.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCollectionOutletAllData = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await restaurantService.exportCollectionOutletAllData(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
        pos: detail.pos ? 'Yes' : 'No',
        ownDriver: detail.ownDriver ? 'Yes' : 'No',
        promote: detail.promote ? 'Yes' : 'No',
        customCategory: detail.customCategory ? 'Yes' : 'No',
        multiOutlet: detail.multiOutlet ? 'Yes' : 'No',
        preBooking: detail.preBooking ? 'Yes' : 'No',
        tableOrder: detail.tableOrder ? 'Yes' : 'No',
        tiffinSubscription: detail.tiffinSubscription ? 'Yes' : 'No',
        ownWaiter: detail.ownWaiter ? 'Yes' : 'No',
        ownKitchen: detail.ownKitchen ? 'Yes' : 'No',
        takeAway: detail.takeAway ? 'Yes' : 'No',
        temporaryClosed: detail.temporaryClosed ? 'Yes' : 'No',
        acceptScheduleDelivery: detail.acceptScheduleDelivery ? 'Yes' : 'No',
        acceptHomeDelivery: detail.acceptHomeDelivery ? 'Yes' : 'No',
        latitude: detail.location.coordinates[1] || 0,
        longitude: detail.location.coordinates[0] || 0,
        orderLimit: detail && detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        productLimit: detail && detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        licenseName:
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        subscriptionName:
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        mangerId:
          detail &&
          detail.manager &&
          detail.manager.id &&
          detail.manager.id !== null &&
          detail.manager.id !== ''
            ? detail.manager.id
            : '-',
        managerName:
          detail &&
          detail.manager &&
          detail.manager.name &&
          detail.manager.name !== null &&
          detail.manager.name !== ''
            ? detail.manager.name
            : '-',
        ownerId:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.id &&
          detail.owerInfo.id !== null &&
          detail.owerInfo.id !== ''
            ? detail.owerInfo.id
            : '-',
        ownerFirstName:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.firstName &&
          detail.owerInfo.firstName !== null &&
          detail.owerInfo.firstName !== ''
            ? detail.owerInfo.firstName
            : '-',
        ownerLastName:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.lastName &&
          detail.owerInfo.lastName !== null &&
          detail.owerInfo.lastName !== ''
            ? detail.owerInfo.lastName
            : '-',
        ownerContryCode:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.countryCode &&
          detail.owerInfo.countryCode !== null &&
          detail.owerInfo.countryCode !== ''
            ? detail.owerInfo.countryCode
            : '-',
        ownerMobile:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.mobile &&
          detail.owerInfo.mobile !== null &&
          detail.owerInfo.mobile !== ''
            ? detail.owerInfo.mobile
            : '-',
        ownerEmail:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.email &&
          detail.owerInfo.email !== null &&
          detail.owerInfo.email !== ''
            ? detail.owerInfo.email
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Outlets');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Manager Id', key: 'mangerId' },
        { header: 'Manager Name', key: 'managerName' },
        { header: 'OwnerId', key: 'ownerId' },
        { header: 'First Name', key: 'ownerFirstName' },
        { header: 'Last Name', key: 'ownerLastName' },
        { header: 'Country Code', key: 'ownerContryCode' },
        { header: 'Mobile', key: 'ownerMobile' },
        { header: 'Email', key: 'ownerEmail' },
        { header: 'Name', key: 'name' },
        { header: 'Slug', key: 'slug' },
        { header: 'Address', key: 'address' },
        { header: 'Logo', key: 'logo' },
        { header: 'Cover', key: 'cover' },
        { header: 'City', key: 'cityName' },
        { header: 'Locality', key: 'localityName' },
        { header: 'Latitude', key: 'latitude' },
        { header: 'Longitude', key: 'longitude' },
        { header: 'Type', key: 'type' },
        { header: 'Subscription Name', key: 'subscriptionName' },
        { header: 'Regular Order Commission', key: 'commission' },
        { header: 'POS Order Commission', key: 'posOrderCommission' },
        { header: 'Table Order Commission', key: 'tableOrderCommission' },
        { header: 'Appx Delivery Time', key: 'approxDeliveryTime' },
        { header: 'POS', key: 'pos' },
        { header: 'Own Driver', key: 'ownDriver' },
        { header: 'Promote', key: 'promote' },
        { header: 'Custom Category', key: 'customCategory' },
        { header: 'Multi Outlet', key: 'multiOutlet' },
        { header: 'Pre Booking', key: 'preBooking' },
        { header: 'Table Order', key: 'tableOrder' },
        { header: 'Tiffin Subscription', key: 'tiffinSubscription' },
        { header: 'Own Waiter', key: 'ownWaiter' },
        { header: 'Own Kitchen', key: 'ownKitchen' },
        { header: 'TakeAway', key: 'takeAway' },
        { header: 'Temp Closed', key: 'temporaryClosed' },
        { header: 'Accept Schedule Delivery', key: 'acceptScheduleDelivery' },
        { header: 'Accept Home Delivery', key: 'acceptHomeDelivery' },
        { header: 'Order Limit', key: 'orderLimit' },
        { header: 'Product Limit', key: 'productLimit' },
        { header: 'License Name', key: 'licenseName' },
        { header: 'License Id', key: 'licenseId' },
        { header: 'Dish Price For Two', key: 'dishPriceForTwo' },
        { header: 'Min Order Amount', key: 'minOrderAmount' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'Facebook Handle', key: 'socialFacebook' },
        { header: 'Instagram Handle', key: 'socialInstagram' },
        { header: 'X Handle', key: 'socialX' },
        { header: 'Youtube Handle', key: 'socialYoutube' },
        { header: 'LinkedIn Handle', key: 'socialLinkedIn' },
        { header: 'Pinterest Handle', key: 'socialPinterest' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        'Manager Id':
          detail &&
          detail.manager &&
          detail.manager.id &&
          detail.manager.id !== null &&
          detail.manager.id !== ''
            ? detail.manager.id
            : '-',
        'Manager Name':
          detail &&
          detail.manager &&
          detail.manager.name &&
          detail.manager.name !== null &&
          detail.manager.name !== ''
            ? detail.manager.name
            : '-',
        OwnerId:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.id &&
          detail.owerInfo.id !== null &&
          detail.owerInfo.id !== ''
            ? detail.owerInfo.id
            : '-',
        'First Name':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.firstName &&
          detail.owerInfo.firstName !== null &&
          detail.owerInfo.firstName !== ''
            ? detail.owerInfo.firstName
            : '-',
        'Last Name':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.lastName &&
          detail.owerInfo.lastName !== null &&
          detail.owerInfo.lastName !== ''
            ? detail.owerInfo.lastName
            : '-',
        'Country Code':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.countryCode &&
          detail.owerInfo.countryCode !== null &&
          detail.owerInfo.countryCode !== ''
            ? detail.owerInfo.countryCode
            : '-',
        Mobile:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.mobile &&
          detail.owerInfo.mobile !== null &&
          detail.owerInfo.mobile !== ''
            ? detail.owerInfo.mobile
            : '-',
        Email:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.email &&
          detail.owerInfo.email !== null &&
          detail.owerInfo.email !== ''
            ? detail.owerInfo.email
            : '-',
        Name: detail.name,
        Slug: detail.slug,
        Address: detail.address,
        Logo: detail.logo,
        Cover: detail.cover,
        City:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        Locality:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        Latitude: detail.location.coordinates[1] || 0,
        Longitude: detail.location.coordinates[0] || 0,
        Type: detail.type,
        'Subscription Name':
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        'Regular Order Commission': detail.commission,
        'POS Order Commission': detail.posOrderCommission,
        'Table Order Commission': detail.tableOrderCommission,
        'Appx Delivery Time': detail.approxDeliveryTime,
        POS: detail.pos ? 'Yes' : 'No',
        'Own Driver': detail.ownDriver ? 'Yes' : 'No',
        Promote: detail.promote ? 'Yes' : 'No',
        'Custom Category': detail.customCategory ? 'Yes' : 'No',
        'Multi Outlet': detail.multiOutlet ? 'Yes' : 'No',
        'Pre Booking': detail.preBooking ? 'Yes' : 'No',
        'Table Order': detail.tableOrder ? 'Yes' : 'No',
        'Tiffin Subscription': detail.tiffinSubscription ? 'Yes' : 'No',
        'Own Waiter': detail.ownWaiter ? 'Yes' : 'No',
        'Own Kitchen': detail.ownKitchen ? 'Yes' : 'No',
        TakeAway: detail.takeAway ? 'Yes' : 'No',
        'Temp Closed': detail.temporaryClosed ? 'Yes' : 'No',
        'Accept Schedule Delivery': detail.acceptScheduleDelivery ? 'Yes' : 'No',
        'Accept Home Delivery': detail.acceptHomeDelivery ? 'Yes' : 'No',
        'Order Limit': detail && detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        'Product Limit': detail && detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        'License Name':
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        'License Id': detail.licenseId,
        'Dish Price For Two': detail.dishPriceForTwo,
        'Min Order Amount': detail.minOrderAmount,
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        'Facebook Handle': detail.socialFacebook,
        'Instagram Handle': detail.socialInstagram,
        'X Handle': detail.socialX,
        'Youtube Handle': detail.socialYoutube,
        'LinkedIn Handle': detail.socialLinkedIn,
        'Pinterest Handle': detail.socialPinterest,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await restaurantService.exportRawOutletCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/outlets.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'outlets.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportRestaurantFilterTypeCollection = catchAsync(async (req, res) => {
  const { type, kind, id } = req.params;
  if (type !== 'raw') {
    const result = await restaurantService.exportRestaurantFilterTypeCollection(kind, id);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
        pos: detail.pos ? 'Yes' : 'No',
        ownDriver: detail.ownDriver ? 'Yes' : 'No',
        promote: detail.promote ? 'Yes' : 'No',
        customCategory: detail.customCategory ? 'Yes' : 'No',
        multiOutlet: detail.multiOutlet ? 'Yes' : 'No',
        preBooking: detail.preBooking ? 'Yes' : 'No',
        tableOrder: detail.tableOrder ? 'Yes' : 'No',
        tiffinSubscription: detail.tiffinSubscription ? 'Yes' : 'No',
        ownWaiter: detail.ownWaiter ? 'Yes' : 'No',
        ownKitchen: detail.ownKitchen ? 'Yes' : 'No',
        takeAway: detail.takeAway ? 'Yes' : 'No',
        temporaryClosed: detail.temporaryClosed ? 'Yes' : 'No',
        acceptScheduleDelivery: detail.acceptScheduleDelivery ? 'Yes' : 'No',
        acceptHomeDelivery: detail.acceptHomeDelivery ? 'Yes' : 'No',
        latitude: detail.location.coordinates[1] || 0,
        longitude: detail.location.coordinates[0] || 0,
        orderLimit: detail && detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        productLimit: detail && detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        licenseName:
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        subscriptionName:
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        ownerId:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.id &&
          detail.owerInfo.id !== null &&
          detail.owerInfo.id !== ''
            ? detail.owerInfo.id
            : '-',
        ownerFirstName:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.firstName &&
          detail.owerInfo.firstName !== null &&
          detail.owerInfo.firstName !== ''
            ? detail.owerInfo.firstName
            : '-',
        ownerLastName:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.lastName &&
          detail.owerInfo.lastName !== null &&
          detail.owerInfo.lastName !== ''
            ? detail.owerInfo.lastName
            : '-',
        ownerContryCode:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.countryCode &&
          detail.owerInfo.countryCode !== null &&
          detail.owerInfo.countryCode !== ''
            ? detail.owerInfo.countryCode
            : '-',
        ownerMobile:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.mobile &&
          detail.owerInfo.mobile !== null &&
          detail.owerInfo.mobile !== ''
            ? detail.owerInfo.mobile
            : '-',
        ownerEmail:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.email &&
          detail.owerInfo.email !== null &&
          detail.owerInfo.email !== ''
            ? detail.owerInfo.email
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Restaurants');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'OwnerId', key: 'ownerId' },
        { header: 'First Name', key: 'ownerFirstName' },
        { header: 'Last Name', key: 'ownerLastName' },
        { header: 'Country Code', key: 'ownerContryCode' },
        { header: 'Mobile', key: 'ownerMobile' },
        { header: 'Email', key: 'ownerEmail' },
        { header: 'Name', key: 'name' },
        { header: 'Slug', key: 'slug' },
        { header: 'Address', key: 'address' },
        { header: 'Logo', key: 'logo' },
        { header: 'Cover', key: 'cover' },
        { header: 'City', key: 'cityName' },
        { header: 'Locality', key: 'localityName' },
        { header: 'Latitude', key: 'latitude' },
        { header: 'Longitude', key: 'longitude' },
        { header: 'Type', key: 'type' },
        { header: 'Subscription Name', key: 'subscriptionName' },
        { header: 'Regular Order Commission', key: 'commission' },
        { header: 'POS Order Commission', key: 'posOrderCommission' },
        { header: 'Table Order Commission', key: 'tableOrderCommission' },
        { header: 'Appx Delivery Time', key: 'approxDeliveryTime' },
        { header: 'POS', key: 'pos' },
        { header: 'Own Driver', key: 'ownDriver' },
        { header: 'Promote', key: 'promote' },
        { header: 'Custom Category', key: 'customCategory' },
        { header: 'Multi Outlet', key: 'multiOutlet' },
        { header: 'Pre Booking', key: 'preBooking' },
        { header: 'Table Order', key: 'tableOrder' },
        { header: 'Tiffin Subscription', key: 'tiffinSubscription' },
        { header: 'Own Waiter', key: 'ownWaiter' },
        { header: 'Own Kitchen', key: 'ownKitchen' },
        { header: 'TakeAway', key: 'takeAway' },
        { header: 'Temp Closed', key: 'temporaryClosed' },
        { header: 'Accept Schedule Delivery', key: 'acceptScheduleDelivery' },
        { header: 'Accept Home Delivery', key: 'acceptHomeDelivery' },
        { header: 'Order Limit', key: 'orderLimit' },
        { header: 'Product Limit', key: 'productLimit' },
        { header: 'License Name', key: 'licenseName' },
        { header: 'License Id', key: 'licenseId' },
        { header: 'Dish Price For Two', key: 'dishPriceForTwo' },
        { header: 'Min Order Amount', key: 'minOrderAmount' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'Facebook Handle', key: 'socialFacebook' },
        { header: 'Instagram Handle', key: 'socialInstagram' },
        { header: 'X Handle', key: 'socialX' },
        { header: 'Youtube Handle', key: 'socialYoutube' },
        { header: 'LinkedIn Handle', key: 'socialLinkedIn' },
        { header: 'Pinterest Handle', key: 'socialPinterest' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        OwnerId:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.id &&
          detail.owerInfo.id !== null &&
          detail.owerInfo.id !== ''
            ? detail.owerInfo.id
            : '-',
        'First Name':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.firstName &&
          detail.owerInfo.firstName !== null &&
          detail.owerInfo.firstName !== ''
            ? detail.owerInfo.firstName
            : '-',
        'Last Name':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.lastName &&
          detail.owerInfo.lastName !== null &&
          detail.owerInfo.lastName !== ''
            ? detail.owerInfo.lastName
            : '-',
        'Country Code':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.countryCode &&
          detail.owerInfo.countryCode !== null &&
          detail.owerInfo.countryCode !== ''
            ? detail.owerInfo.countryCode
            : '-',
        Mobile:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.mobile &&
          detail.owerInfo.mobile !== null &&
          detail.owerInfo.mobile !== ''
            ? detail.owerInfo.mobile
            : '-',
        Email:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.email &&
          detail.owerInfo.email !== null &&
          detail.owerInfo.email !== ''
            ? detail.owerInfo.email
            : '-',
        Name: detail.name,
        Slug: detail.slug,
        Address: detail.address,
        Logo: detail.logo,
        Cover: detail.cover,
        City:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        Locality:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        Latitude: detail.location.coordinates[1] || 0,
        Longitude: detail.location.coordinates[0] || 0,
        Type: detail.type,
        'Subscription Name':
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        'Regular Order Commission': detail.commission,
        'POS Order Commission': detail.posOrderCommission,
        'Table Order Commission': detail.tableOrderCommission,
        'Appx Delivery Time': detail.approxDeliveryTime,
        POS: detail.pos ? 'Yes' : 'No',
        'Own Driver': detail.ownDriver ? 'Yes' : 'No',
        Promote: detail.promote ? 'Yes' : 'No',
        'Custom Category': detail.customCategory ? 'Yes' : 'No',
        'Multi Outlet': detail.multiOutlet ? 'Yes' : 'No',
        'Pre Booking': detail.preBooking ? 'Yes' : 'No',
        'Table Order': detail.tableOrder ? 'Yes' : 'No',
        'Tiffin Subscription': detail.tiffinSubscription ? 'Yes' : 'No',
        'Own Waiter': detail.ownWaiter ? 'Yes' : 'No',
        'Own Kitchen': detail.ownKitchen ? 'Yes' : 'No',
        TakeAway: detail.takeAway ? 'Yes' : 'No',
        'Temp Closed': detail.temporaryClosed ? 'Yes' : 'No',
        'Accept Schedule Delivery': detail.acceptScheduleDelivery ? 'Yes' : 'No',
        'Accept Home Delivery': detail.acceptHomeDelivery ? 'Yes' : 'No',
        'Order Limit': detail && detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        'Product Limit': detail && detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        'License Name':
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        'License Id': detail.licenseId,
        'Dish Price For Two': detail.dishPriceForTwo,
        'Min Order Amount': detail.minOrderAmount,
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        'Facebook Handle': detail.socialFacebook,
        'Instagram Handle': detail.socialInstagram,
        'X Handle': detail.socialX,
        'Youtube Handle': detail.socialYoutube,
        'LinkedIn Handle': detail.socialLinkedIn,
        'Pinterest Handle': detail.socialPinterest,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await restaurantService.exportRawRestaurantFilterTypeCollection(kind, id);
    const downloadPath = path.join(__dirname, `../templates/downloads/restaurants.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurants.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportRestaurantFilterQueryCollection = catchAsync(async (req, res) => {
  const { exportType, city, cuisine, category, facility, type } = req.query;
  if (exportType !== 'raw') {
    const result = await restaurantService.exportRestaurantFilterQueryCollection(
      city,
      cuisine,
      category,
      facility,
      type
    );
    if (exportType === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
        pos: detail.pos ? 'Yes' : 'No',
        ownDriver: detail.ownDriver ? 'Yes' : 'No',
        promote: detail.promote ? 'Yes' : 'No',
        customCategory: detail.customCategory ? 'Yes' : 'No',
        multiOutlet: detail.multiOutlet ? 'Yes' : 'No',
        preBooking: detail.preBooking ? 'Yes' : 'No',
        tableOrder: detail.tableOrder ? 'Yes' : 'No',
        tiffinSubscription: detail.tiffinSubscription ? 'Yes' : 'No',
        ownWaiter: detail.ownWaiter ? 'Yes' : 'No',
        ownKitchen: detail.ownKitchen ? 'Yes' : 'No',
        takeAway: detail.takeAway ? 'Yes' : 'No',
        temporaryClosed: detail.temporaryClosed ? 'Yes' : 'No',
        acceptScheduleDelivery: detail.acceptScheduleDelivery ? 'Yes' : 'No',
        acceptHomeDelivery: detail.acceptHomeDelivery ? 'Yes' : 'No',
        latitude: detail.location.coordinates[1] || 0,
        longitude: detail.location.coordinates[0] || 0,
        orderLimit: detail && detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        productLimit: detail && detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        licenseName:
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        subscriptionName:
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        ownerId:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.id &&
          detail.owerInfo.id !== null &&
          detail.owerInfo.id !== ''
            ? detail.owerInfo.id
            : '-',
        ownerFirstName:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.firstName &&
          detail.owerInfo.firstName !== null &&
          detail.owerInfo.firstName !== ''
            ? detail.owerInfo.firstName
            : '-',
        ownerLastName:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.lastName &&
          detail.owerInfo.lastName !== null &&
          detail.owerInfo.lastName !== ''
            ? detail.owerInfo.lastName
            : '-',
        ownerContryCode:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.countryCode &&
          detail.owerInfo.countryCode !== null &&
          detail.owerInfo.countryCode !== ''
            ? detail.owerInfo.countryCode
            : '-',
        ownerMobile:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.mobile &&
          detail.owerInfo.mobile !== null &&
          detail.owerInfo.mobile !== ''
            ? detail.owerInfo.mobile
            : '-',
        ownerEmail:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.email &&
          detail.owerInfo.email !== null &&
          detail.owerInfo.email !== ''
            ? detail.owerInfo.email
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Restaurants');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'OwnerId', key: 'ownerId' },
        { header: 'First Name', key: 'ownerFirstName' },
        { header: 'Last Name', key: 'ownerLastName' },
        { header: 'Country Code', key: 'ownerContryCode' },
        { header: 'Mobile', key: 'ownerMobile' },
        { header: 'Email', key: 'ownerEmail' },
        { header: 'Name', key: 'name' },
        { header: 'Slug', key: 'slug' },
        { header: 'Address', key: 'address' },
        { header: 'Logo', key: 'logo' },
        { header: 'Cover', key: 'cover' },
        { header: 'City', key: 'cityName' },
        { header: 'Locality', key: 'localityName' },
        { header: 'Latitude', key: 'latitude' },
        { header: 'Longitude', key: 'longitude' },
        { header: 'Type', key: 'type' },
        { header: 'Subscription Name', key: 'subscriptionName' },
        { header: 'Regular Order Commission', key: 'commission' },
        { header: 'POS Order Commission', key: 'posOrderCommission' },
        { header: 'Table Order Commission', key: 'tableOrderCommission' },
        { header: 'Appx Delivery Time', key: 'approxDeliveryTime' },
        { header: 'POS', key: 'pos' },
        { header: 'Own Driver', key: 'ownDriver' },
        { header: 'Promote', key: 'promote' },
        { header: 'Custom Category', key: 'customCategory' },
        { header: 'Multi Outlet', key: 'multiOutlet' },
        { header: 'Pre Booking', key: 'preBooking' },
        { header: 'Table Order', key: 'tableOrder' },
        { header: 'Tiffin Subscription', key: 'tiffinSubscription' },
        { header: 'Own Waiter', key: 'ownWaiter' },
        { header: 'Own Kitchen', key: 'ownKitchen' },
        { header: 'TakeAway', key: 'takeAway' },
        { header: 'Temp Closed', key: 'temporaryClosed' },
        { header: 'Accept Schedule Delivery', key: 'acceptScheduleDelivery' },
        { header: 'Accept Home Delivery', key: 'acceptHomeDelivery' },
        { header: 'Order Limit', key: 'orderLimit' },
        { header: 'Product Limit', key: 'productLimit' },
        { header: 'License Name', key: 'licenseName' },
        { header: 'License Id', key: 'licenseId' },
        { header: 'Dish Price For Two', key: 'dishPriceForTwo' },
        { header: 'Min Order Amount', key: 'minOrderAmount' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'Facebook Handle', key: 'socialFacebook' },
        { header: 'Instagram Handle', key: 'socialInstagram' },
        { header: 'X Handle', key: 'socialX' },
        { header: 'Youtube Handle', key: 'socialYoutube' },
        { header: 'LinkedIn Handle', key: 'socialLinkedIn' },
        { header: 'Pinterest Handle', key: 'socialPinterest' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        OwnerId:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.id &&
          detail.owerInfo.id !== null &&
          detail.owerInfo.id !== ''
            ? detail.owerInfo.id
            : '-',
        'First Name':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.firstName &&
          detail.owerInfo.firstName !== null &&
          detail.owerInfo.firstName !== ''
            ? detail.owerInfo.firstName
            : '-',
        'Last Name':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.lastName &&
          detail.owerInfo.lastName !== null &&
          detail.owerInfo.lastName !== ''
            ? detail.owerInfo.lastName
            : '-',
        'Country Code':
          detail &&
          detail.owerInfo &&
          detail.owerInfo.countryCode &&
          detail.owerInfo.countryCode !== null &&
          detail.owerInfo.countryCode !== ''
            ? detail.owerInfo.countryCode
            : '-',
        Mobile:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.mobile &&
          detail.owerInfo.mobile !== null &&
          detail.owerInfo.mobile !== ''
            ? detail.owerInfo.mobile
            : '-',
        Email:
          detail &&
          detail.owerInfo &&
          detail.owerInfo.email &&
          detail.owerInfo.email !== null &&
          detail.owerInfo.email !== ''
            ? detail.owerInfo.email
            : '-',
        Name: detail.name,
        Slug: detail.slug,
        Address: detail.address,
        Logo: detail.logo,
        Cover: detail.cover,
        City:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        Locality:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        Latitude: detail.location.coordinates[1] || 0,
        Longitude: detail.location.coordinates[0] || 0,
        Type: detail.type,
        'Subscription Name':
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        'Regular Order Commission': detail.commission,
        'POS Order Commission': detail.posOrderCommission,
        'Table Order Commission': detail.tableOrderCommission,
        'Appx Delivery Time': detail.approxDeliveryTime,
        POS: detail.pos ? 'Yes' : 'No',
        'Own Driver': detail.ownDriver ? 'Yes' : 'No',
        Promote: detail.promote ? 'Yes' : 'No',
        'Custom Category': detail.customCategory ? 'Yes' : 'No',
        'Multi Outlet': detail.multiOutlet ? 'Yes' : 'No',
        'Pre Booking': detail.preBooking ? 'Yes' : 'No',
        'Table Order': detail.tableOrder ? 'Yes' : 'No',
        'Tiffin Subscription': detail.tiffinSubscription ? 'Yes' : 'No',
        'Own Waiter': detail.ownWaiter ? 'Yes' : 'No',
        'Own Kitchen': detail.ownKitchen ? 'Yes' : 'No',
        TakeAway: detail.takeAway ? 'Yes' : 'No',
        'Temp Closed': detail.temporaryClosed ? 'Yes' : 'No',
        'Accept Schedule Delivery': detail.acceptScheduleDelivery ? 'Yes' : 'No',
        'Accept Home Delivery': detail.acceptHomeDelivery ? 'Yes' : 'No',
        'Order Limit': detail && detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        'Product Limit': detail && detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        'License Name':
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        'License Id': detail.licenseId,
        'Dish Price For Two': detail.dishPriceForTwo,
        'Min Order Amount': detail.minOrderAmount,
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        'Facebook Handle': detail.socialFacebook,
        'Instagram Handle': detail.socialInstagram,
        'X Handle': detail.socialX,
        'Youtube Handle': detail.socialYoutube,
        'LinkedIn Handle': detail.socialLinkedIn,
        'Pinterest Handle': detail.socialPinterest,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await restaurantService.exportRawRestaurantFilterQueryCollection(
      city,
      cuisine,
      category,
      facility,
      type
    );
    const downloadPath = path.join(__dirname, `../templates/downloads/restaurants.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurants.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportRestaurantReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['city', 'type', 'category', 'filter', 'search']);
  const { exportType } = req.query;
  const result = await restaurantService.exportRestaurantReportCollection(options);
  if (exportType === 'excel') {
    const mappedResult = result.map((detail, index) => ({
      ...detail,
      serial: index + 1,
      cityId:
        detail && detail.city && detail.city.id && detail.city.id !== null && detail.city.id !== ''
          ? detail.city.id
          : '-',
      cityName:
        detail &&
        detail.city &&
        detail.city.name &&
        detail.city.name !== null &&
        detail.city.name !== ''
          ? detail.city.name
          : '-',
      localityId:
        detail &&
        detail.locality &&
        detail.locality.id &&
        detail.locality.id !== null &&
        detail.locality.id !== ''
          ? detail.locality.id
          : '-',
      localityName:
        detail &&
        detail.locality &&
        detail.locality.name &&
        detail.locality.name !== null &&
        detail.locality.name !== ''
          ? detail.locality.name
          : '-',
      owerId:
        detail &&
        detail.owerInfo &&
        detail.owerInfo.id &&
        detail.owerInfo.id !== null &&
        detail.owerInfo.id !== ''
          ? detail.owerInfo.id
          : '-',
      ownerFirstName:
        detail &&
        detail.owerInfo &&
        detail.owerInfo.firstName &&
        detail.owerInfo.firstName !== null &&
        detail.owerInfo.firstName !== ''
          ? detail.owerInfo.firstName
          : '-',
      owerLastName:
        detail &&
        detail.owerInfo &&
        detail.owerInfo.lastName &&
        detail.owerInfo.lastName !== null &&
        detail.owerInfo.lastName !== ''
          ? detail.owerInfo.lastName
          : '-',
      createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('RestaurantReports');
    worksheet.columns = [
      { header: 'S. No.', key: 'serial' },
      { header: 'Id', key: 'id' },
      { header: 'Name', key: 'name' },
      { header: 'Owner Id', key: 'owerId' },
      { header: 'Owner FirstName', key: 'ownerFirstName' },
      { header: 'Owner LastName', key: 'owerLastName' },
      { header: 'City Id', key: 'cityId' },
      { header: 'City Name', key: 'cityName' },
      { header: 'Locality Id', key: 'localityId' },
      { header: 'Locality Name', key: 'localityName' },
      { header: 'Orders', key: 'orders' },
      { header: 'Foods', key: 'foods' },
      { header: 'Dining Bookings', key: 'diningBookings' },
      { header: 'POS Orders', key: 'posOrders' },
      { header: 'Table Orders', key: 'tableOrders' },
      { header: 'Order Earning Amount', key: 'orderEarningAmount' },
      { header: 'Order Discount Given Amount', key: 'orderDiscountGivenAmount' },
      { header: 'Order Restaurant Commission', key: 'orderRestaurantCommission' },
      { header: 'Order Food Tax Amount', key: 'orderFoodTaxAmount' },
      { header: 'Order Service Charge Amount', key: 'orderServiceChargeAmount' },
      { header: 'POS Earning Amount', key: 'posEarningAmount' },
      { header: 'POS Discount Given Amount', key: 'posDiscountGivenAmount' },
      { header: 'POS Restaurant Commission', key: 'posRestaurantCommission' },
      { header: 'POS Food Tax Amount', key: 'posFoodTaxAmount' },
      { header: 'POS Service Charge Amount', key: 'posServiceChargeAmount' },
      { header: 'Table Order Earning Amount', key: 'tableOrderEarningAmount' },
      { header: 'Table Order Discount Given Amount', key: 'tableOrderDiscountGivenAmount' },
      { header: 'Table Order Restaurant Commission', key: 'tableOrderRestaurantCommission' },
      { header: 'Table Order Food Tax Amount', key: 'tableOrderFoodTaxAmount' },
      { header: 'Table Order Service Charge Amount', key: 'tableOrderServiceChargeAmount' },
      { header: 'Dining Earning Amount', key: 'diningEarningAmount' },
      { header: 'Dining Commission Amount', key: 'diningCommissionAmount' },
      { header: 'Joining Date', key: 'createdAt' },
    ];

    worksheet.addRows(mappedResult);

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          color: { argb: 'FF000000' }, // Black text
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }, // White background
        };
      });
    });

    const headerRow = worksheet.getRow(1);

    headerRow.eachCell((cell) => {
      cell.font = {
        name: 'Verdana',
        size: 12,
        bold: true,
        color: { argb: 'FF000000' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCE6F1' }, // Optional
      };
    });

    worksheet.columns.forEach((column) => {
      let maxLength = 0;

      column.eachCell({ includeEmpty: true }, (cell) => {
        let columnLength = 0;

        if (cell.value) {
          const rawValue =
            typeof cell.value === 'object' && cell.value.richText
              ? cell.value.richText.map((rt) => rt.text).join('')
              : cell.value.toString();

          // Account for line breaks and longest line in multi-line cells
          const lines = rawValue.split('\n');
          columnLength = Math.max(...lines.map((line) => line.length));
        }

        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });

      column.width = maxLength + 10; // Add some padding
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } else {
    const fieldItems = result.map((detail, index) => ({
      'S. No.': index + 1,
      Id: detail.id,
      Name: detail.name,
      'Owner Id':
        detail &&
        detail.owerInfo &&
        detail.owerInfo.id &&
        detail.owerInfo.id !== null &&
        detail.owerInfo.id !== ''
          ? detail.owerInfo.id
          : '-',
      'Owner FirstName':
        detail &&
        detail.owerInfo &&
        detail.owerInfo.firstName &&
        detail.owerInfo.firstName !== null &&
        detail.owerInfo.firstName !== ''
          ? detail.owerInfo.firstName
          : '-',
      'Owner LastName':
        detail &&
        detail.owerInfo &&
        detail.owerInfo.lastName &&
        detail.owerInfo.lastName !== null &&
        detail.owerInfo.lastName !== ''
          ? detail.owerInfo.lastName
          : '-',
      'City Id':
        detail && detail.city && detail.city.id && detail.city.id !== null && detail.city.id !== ''
          ? detail.city.id
          : '-',
      'City Name':
        detail &&
        detail.city &&
        detail.city.name &&
        detail.city.name !== null &&
        detail.city.name !== ''
          ? detail.city.name
          : '-',
      'Locality Id':
        detail &&
        detail.locality &&
        detail.locality.id &&
        detail.locality.id !== null &&
        detail.locality.id !== ''
          ? detail.locality.id
          : '-',
      'Locality Name':
        detail &&
        detail.locality &&
        detail.locality.name &&
        detail.locality.name !== null &&
        detail.locality.name !== ''
          ? detail.locality.name
          : '-',
      Orders: detail.orders,
      Foods: detail.foods,
      'Dining Bookings': detail.diningBookings,
      'POS Orders': detail.posOrders,
      'Table Orders': detail.tableOrders,
      'Order Earning Amount': detail.orderEarningAmount,
      'Order Discount Given Amount': detail.orderDiscountGivenAmount,
      'Order Restaurant Commission': detail.orderRestaurantCommission,
      'Order Food Tax Amount': detail.orderFoodTaxAmount,
      'Order Service Charge Amount': detail.orderServiceChargeAmount,
      'POS Earning Amount': detail.posEarningAmount,
      'POS Discount Given Amount': detail.posDiscountGivenAmount,
      'POS Restaurant Commission': detail.posRestaurantCommission,
      'POS Food Tax Amount': detail.posFoodTaxAmount,
      'POS Service Charge Amount': detail.posServiceChargeAmount,
      'Table Order Earning Amount': detail.tableOrderEarningAmount,
      'Table Order Discount Given Amount': detail.tableOrderDiscountGivenAmount,
      'Table Order Restaurant Commission': detail.tableOrderRestaurantCommission,
      'Table Order Food Tax Amount': detail.tableOrderFoodTaxAmount,
      'Table Order Service Charge Amount': detail.tableOrderServiceChargeAmount,
      'Dining Earning Amount': detail.diningEarningAmount,
      'Dining Commission Amount': detail.diningCommissionAmount,
      'Joining Date': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const csv = Papa.unparse(fieldItems);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.send(csv);
  }
});

const importRestaurantCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === restaurantSchemaKeys.length &&
              importKeys.every((item) => restaurantSchemaKeys.includes(item));
            if (validSchema) {
              const result = await restaurantService.importRestaurantCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === restaurantSchemaKeys.length &&
                    importKeys.every((item) => restaurantSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await restaurantService.importRestaurantCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const importRestaurantOutletCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === restaurantOutletSchemaKeys.length &&
              importKeys.every((item) => restaurantOutletSchemaKeys.includes(item));
            if (validSchema) {
              const result = await restaurantService.importRestaurantOutletCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === restaurantOutletSchemaKeys.length &&
                    importKeys.every((item) => restaurantOutletSchemaKeys.includes(item));
                  if (validSchema) {
                    const result =
                      await restaurantService.importRestaurantOutletCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const userTableQrMenu = catchAsync(async (req, res) => {
  const { restaurant, table } = req.params;
  const result = await restaurantService.userTableQrMenu(restaurant, table);
  res.send(result);
});

/**
 * PATCH delivery coverage for one restaurant (Batch B-2). The Settings
 * screen's override/reset API: any subset of `deliveryConfig` fields plus an
 * optional `clearKeys[]` to restore inheritance per field. Validation
 * (delivery.config.validation) runs in the route; the service sanitises,
 * city-guards localities and clamps — so a panel bug can never store a wild
 * radius or a cross-city tick-list.
 */
const updateDeliveryConfigHandler = catchAsync(async (req, res) => {
  const { restaurantId } = req.params;
  const { clearKeys, ...patch } = req.body || {};
  const deliveryConfig = await updateDeliveryConfig(restaurantId, patch, clearKeys);
  res.send({ deliveryConfig, success: true });
});

/**
 * City-master variant (Batch D-1): same update, additionally scoped — the
 * restaurant must be in the master's own city (403 otherwise).
 */
const cityzenUpdateDeliveryConfigHandler = catchAsync(async (req, res) => {
  const { restaurantId, master } = req.params;
  await restaurantService.assertMasterOwnsRestaurant(master, restaurantId);
  const { clearKeys, ...patch } = req.body || {};
  const deliveryConfig = await updateDeliveryConfig(restaurantId, patch, clearKeys);
  res.send({ deliveryConfig, success: true });
});

/**
 * Effective delivery policy for one restaurant (Batch B-3). The Settings
 * screen's read model: every effective value alongside its source
 * (platform | city | restaurant | inherit), so ops sees where each number
 * comes from before overriding or resetting it.
 */
const getDeliveryConfigHandler = catchAsync(async (req, res) => {
  const policy = await resolveDeliveryPolicy(req.params.restaurantId);
  res.send({ policy, success: true });
});

/**
 * Vendor self-narrowing (Batch D-2). No `:id` in the path on purpose: the
 * restaurant is resolved from the authenticated vendor, never from client
 * input — trusting a vendor-sent id is the trust-boundary violation Phase 2
 * removed from the rider picker. Shrink-only; widening is 422 with a pointer
 * to the city-master.
 */
const narrowDeliveryConfigHandler = catchAsync(async (req, res) => {
  const vendorUserId = req.user && (req.user._id || req.user.id);
  const deliveryConfig = await narrowDeliveryConfig(String(vendorUserId), req.body || {});
  res.send({ deliveryConfig, success: true });
});

/**
 * City-master variant (Batch D-1): same read model, scoped to the master's
 * own city (403 otherwise).
 */
const cityzenGetDeliveryConfigHandler = catchAsync(async (req, res) => {
  await restaurantService.assertMasterOwnsRestaurant(req.params.master, req.params.restaurantId);
  const policy = await resolveDeliveryPolicy(req.params.restaurantId);
  res.send({ policy, success: true });
});

/**
 * Customer pre-check (Batch E-1): "does this kitchen deliver to my pin?"
 * Public — the customer app calls it before checkout so the address form can
 * warn early. Read-only; the enforcing gate is `createOrder`.
 */
const getCoverageHandler = catchAsync(async (req, res) => {
  const { restaurantId } = req.params;
  const { latitude, longitude, locality } = req.query;
  const coverage = await resolveCustomerCoverage({
    restaurantId,
    customerLng: Number(longitude),
    customerLat: Number(latitude),
    customerLocalityId: locality || null,
  });
  res.send({
    inside: coverage.inside,
    reason: coverage.reason,
    level: coverage.level,
    zone: coverage.zone && coverage.zone.name ? coverage.zone.name : null,
    success: true,
  });
});

module.exports = {
  registerVendorAccount,
  registerOutletAccount,
  updateDeliveryConfigHandler,
  cityzenUpdateDeliveryConfigHandler,
  narrowDeliveryConfigHandler,
  getDeliveryConfigHandler,
  cityzenGetDeliveryConfigHandler,
  getCoverageHandler,
  getBasicDataForNewOutlet,
  getNearMeRestaurants,
  get,
  updateStatus,
  getById,
  update,
  updateOutlet,
  getMyProfile,
  getMyOutlets,
  getOutlets,
  getRestaurantByCityId,
  getSlot,
  updateSlot,
  updateSlotWeb,
  getRestaurantsByCuisine,
  getRestaurantsByCategory,
  getFoodsNearMeByCategory,
  getRestaurantsByBrand,
  getRestaurantsInfo,
  driverNearTrendingRestaurant,
  getRestaurantsByLocalities,
  globalSearchInitial,
  globalSearch,
  foodSearchInitial,
  foodSearch,
  getBasicDataForNewRestaurant,
  getRestaurantsByCityIdLimitedDetailsForAdmin,
  getRestaurantByCityIdFromCollectCash,
  getRestaurantsByCityIdForTiffinPackagesAdmin,
  getDiningSupportedRestaurantByCityId,
  getNearMeDiningRestaurants,
  getNearMeDiningRestaurantOnMap,
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
  getRestaurantExtraInformation,
  updateMenuAndPhotoInformation,
  getRestaurantDetailForUpdateApp,
  updateRestaurantDetail,
  getBasicDataForNewOutletFromApp,
  getBasicDataRegisterRequest,
  getBasicDataRegisterRequestWeb,
  getOutletDetailForApp,
  getRestaurantDetailWebForUpdate,
  closeTemporaryRestaurant,
  reOpenTemporaryRestaurant,
  restaurantWalletDetail,
  getRestaurantCashInHand,
  posAndTableOrderCommissionHistory,
  clearCashInHandAndUpdateWallet,
  cashOnHandHistory,
  cashCollectedHistory,
  getPosData,
  getPosDataWeb,
  getPosFoodDataWeb,
  posFoodSearchInitialData,
  posFoodSearch,
  getVendorSubscriptionStatus,
  vendorSubscriptionInfo,
  vendorRenewSubscription,
  restauratReportInitialFilter,
  restaurantReport,
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
  cityzenRestaurants,
  cityzenOutlets,
  cityzenFilterQueryData,
  cityzenFilterQuery,
  cityzenBasicDataForNewRestaurant,
  cityzenRestuarantGetById,
  cityzenUpdateRestaurant,
  cityzenRegisterVendorAccount,
  cityzenRestaurantsLimitedDetails,
  vendorTableQrDetail,
  exportCollectionRestaurantAllData,
  exportCollectionOutletAllData,
  exportRestaurantFilterTypeCollection,
  exportRestaurantFilterQueryCollection,
  exportRestaurantReportCollection,
  importRestaurantCollection,
  importRestaurantOutletCollection,
  userTableQrMenu,
};

