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
const {
  User,
  Driver,
  Vehicle,
  ReferralCode,
  UserSettings,
  DeletedUserAccount,
  AdminExpense,
  CartItem,
  ChatConversion,
  ChatRoom,
  CollectCash,
  Complaints,
  Coupon,
  DeliverymanCashInHand,
  DeliverymanDisbursement,
  DeliverymanPayoutMethod,
  DiningBooking,
  DiningBookingRefundRequest,
  DiningCoupon,
  DriverNewOrderStatus,
  DriverOrderReview,
  Favourite,
  FavouriteOrder,
  FoodOrderReview,
  GuestUserInfo,
  HideRestaurant,
  LoyaltyPoints,
  Media,
  NotificationList,
  Orders,
  PaymentInitiation,
  PushNotificationToken,
  RedeemReferral,
  RefundRequest,
  ReportIssueRestaurant,
  RestaurantComplaints,
  RestaurantExpense,
  Restaurant,
  RestaurantOrderReview,
  SupportChatConversion,
  SupportChatRoom,
  TiffinSubscriptionRefundRequest,
  Token,
  Transactions,
  UserAddress,
  UserPurchasedTiffinSubscription,
  Waiter,
  Wallet,
  WithdrawalRequest,
  DeletedWaiterAccount,
  TableOrder,
  DeletedDeliverymanAccount,
  RestaurantCashInHand,
  RestaurantPosTableOrderCommission,
  DeletedRestaurantAccount,
  Addons,
  Banner,
  DiningCampaign,
  DiningCampaignRequest,
  FoodCampaignRequest,
  Food,
  FoodTaxation,
  PosOrTableOrder,
  FoodCampaign,
  RestaurantCampaign,
  RestaurantCampaignRequest,
  RestaurantDisbursement,
  RestaurantExtraDetail,
  RestaurantPayoutMethod,
  RestaurantTable,
  Subscriber,
  SubscriptionTiffinPackage,
  TableOrderCartItem,
  VendorCategory,
  VendorSubCategory,
  DeletedKitchenAccount,
  KitchenOwner,
} = require('../models');
const ApiError = require('../utils/ApiError');
const { roleRights } = require('../config/roles');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createUser = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    isEmailVerified: param.isEmailVerified,
    isMobileVerified: param.isMobileVerified,
    locale: param.locale,
  });
  return User.create(userData);
};

const createGuestUser = async (param) => {
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    isEmailVerified: param.isEmailVerified,
    isMobileVerified: param.isMobileVerified,
    role: 'guest',
    locale: param.locale,
  });
  return User.create(userData);
};

const registerAdminAccountInitial = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const user = await User.findOne({ role: 'admin' });
  if (user !== null && user.id !== '') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Account already created');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    role: 'admin',
  });
  return User.create(userData);
};

const createVendorAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    city: param.city,
    role: 'vendor',
  });
  return User.create(userData);
};

const cityzenCreateVendorAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    role: 'vendor',
  });
  return User.create(userData);
};

const createOutletAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    city: param.city,
    role: 'vendorOutlet',
  });
  return User.create(userData);
};

const createDriverAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    image: param.image,
    city: param.city,
    role: 'driver',
  });
  return User.create(userData);
};

const cityzenCreateDriverAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    image: param.image,
    role: 'driver',
  });
  return User.create(userData);
};

const createWaiterAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    image: param.image,
    gender: param.gender,
    role: 'waiter',
  });
  return User.create(userData);
};

const createKitchenAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    image: param.image,
    gender: param.gender,
    role: 'kitchen',
  });
  return User.create(userData);
};

const createVendorDriverAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    city: param.city,
    image: param.image,
    role: 'vendorDriver',
  });
  return User.create(userData);
};

const isAdminSetupDone = async () => {
  if (await User.isAdminSetupDone()) {
    return true;
  }
  return false;
};

const getUserById = async (id) => {
  return User.findById(id);
};

const getUserByEmail = async (email) => {
  return User.findOne({ email });
};

const getUserByCountryCodeAndMobileNumber = async (country, mobileNumber) => {
  return User.findOne({ countryCode: country, mobile: mobileNumber });
};

const updateUserById = async (userId, param) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (param.email && (await User.isEmailTaken(param.email, userId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  Object.assign(user, param);
  await user.save();
  return user;
};

const deleteUserById = async (userId) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  await user.deleteOne();
  return user;
};

const canCreateAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  return true;
};

const findUserWithName = async (name) => {
  const searchRegExp = RegExp(name, 'i');
  const foodQuery = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
        $and: [{ role: 'user', status: true }],
      },
    },
    { $sort: { rating: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        countryCode: 1,
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
        createdAt: 1,
      },
    },
  ];
  const users = await User.aggregate(foodQuery);
  return Promise.all([users]).then(() => {
    const result = {
      users,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getMyProfile = async (userId) => {
  const userInfo = await User.findById(userId, {
    locale: 0,
    location: 0,
    status: 0,
    role: 0,
  });
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  return { info: userInfo, success: true };
};

const updateMyProfile = async (userId, param) => {
  const userInfo = await User.findById(userId);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  const updateBody = {
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    gender: param.gender,
  };
  Object.assign(userInfo, updateBody);
  await userInfo.save();
  return { success: true };
};

const getMyDriverProfile = async (driverId) => {
  const userInfo = await User.findById(driverId, {
    locale: 0,
    location: 0,
    status: 0,
  });
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');
  }
  const results = await Driver.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(driverId),
      },
    },
    { $limit: 1 },
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
        from: 'vehicles',
        localField: 'vehicle',
        foreignField: '_id',
        as: 'vehicles',
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
        path: '$vehicles',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        identity: 1,
        identityNumber: 1,
        identityProof: 1,
        drivingLicense: 1,
        dob: 1,
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
        vehicle: {
          id: { $ifNull: ['$vehicles._id', ''] },
          name: { $ifNull: ['$vehicles.name', ''] },
          translations: { $ifNull: ['$vehicles.translations', []] },
        },
      },
    },
  ]);
  if (!results && !checkArrayNotEmpty(results)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');
  }
  const query = [
    {
      $match: {
        status: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        translations: 1,
      },
    },
  ];
  const vehicleList = await Vehicle.aggregate(query);
  return Promise.all([userInfo, results, vehicleList]).then(() => {
    const result = {
      info: userInfo,
      driver: results[0],
      vehicleList,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const kitchenOwnerProfile = async (ownerId) => {
  const userInfo = await User.findById(ownerId, {
    locale: 0,
    location: 0,
    status: 0,
  });
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');
  }
  return Promise.all([userInfo]).then(() => {
    const result = {
      info: userInfo,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const updateDeliverymanProfile = async (driverId, param) => {
  const userInfo = await User.findById(driverId);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  const updateBody = {
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    gender: param.gender,
  };
  Object.assign(userInfo, updateBody);
  await userInfo.save();
  const driverInfo = await Driver.findOne({ userId: new mongoose.Types.ObjectId(driverId) });
  if (!driverInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  const updateDeliverymanBody = {
    identity: param.identity,
    identityNumber: param.identityNumber,
    identityProof: param.identityProof,
    drivingLicense: param.drivingLicense,
    vehicle: param.vehicle,
  };
  Object.assign(driverInfo, updateDeliverymanBody);
  await driverInfo.save();
  return { success: true };
};

const updateKitchenOwnerProfile = async (ownerId, param) => {
  const userInfo = await User.findById(ownerId);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  const updateBody = {
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    gender: param.gender,
  };
  Object.assign(userInfo, updateBody);
  await userInfo.save();
  return { success: true };
};

const getMyReferralCode = async (userId) => {
  const referralCode = await ReferralCode.findOne(
    { holderId: new mongoose.Types.ObjectId(userId) },
    { code: 1 }
  );
  const detail = await UserSettings.findOne(
    {},
    {
      earnPerReferral: 1,
      whoEarnReferral: 1,
      referralTitle: 1,
      referralMessage: 1,
      referralTranslations: 1,
    }
  );
  return Promise.all([referralCode, detail]).then(() => {
    const result = {
      referralCode,
      detail,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const callCustomer = async (userId) => {
  const userInfo = await User.findById(userId, { countryCode: 1, mobile: 1 });
  return userInfo;
};

const checkUserRegisterStatus = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  return { success: true };
};

const customerList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = options.filter === 'true' || options.filter === true;
  const filterStatus = options.status === 'true' || options.status === true;
  let sortBy = -1;
  const name = options.search;
  const matchQuery = {
    $match: filter
      ? { role: { $in: [options.role] }, status: filterStatus }
      : { role: { $in: ['user', 'guest'] }, status: { $in: [true, false] } },
  };
  if (name && name !== '' && name !== null) {
    matchQuery.$match = {
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }

  if (filter) {
    if (options.sortBy === 'oldest') {
      sortBy = 1;
    } else if (options.sortBy === 'newest') {
      sortBy = -1;
    }
    if (options.joiningDate !== '-') {
      const dateRangeArray = options.joiningDate.split('-');

      if (dateRangeArray && checkArrayNotEmpty(dateRangeArray)) {
        const parseDate = (dateStr) => {
          const [day, month, year] = dateStr.trim().split('/');
          return new Date(`${year}-${month}-${day}`);
        };

        const start = parseDate(dateRangeArray[0]);
        const end = parseDate(dateRangeArray[1]);

        const dateRange = {};

        if (start) dateRange.$gte = start;
        if (end) dateRange.$lte = end;

        matchQuery.$match.createdAt = dateRange;
      }
    }
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: sortBy } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
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
        createdAt: 1,
        orderCount: {
          $size: '$orders',
        },
        totalGrandTotal: {
          $divide: [{ $sum: '$orders.grandTotal' }, 100],
        },
        status: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await User.aggregate(query);
  const resultCount = await User.aggregate(countQuery);
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

const updateStatus = async (userId, param) => {
  const userInfo = await User.findById(userId);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User Not Found');
  }
  Object.assign(userInfo, param);
  await userInfo.save();
  return { success: true };
};

const customerWalletFundList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const matchQuery = { $match: { role: 'user' } };
  const name = options.search;
  if (name && name !== '' && name !== null) {
    matchQuery.$match = {
      role: 'user',
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'loyaltypoints',
        localField: '_id',
        foreignField: 'user',
        as: 'loyaltypoints',
        pipeline: [{ $match: { redeemedToWallet: false } }],
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
        firstName: 1,
        lastName: 1,
        image: 1,
        contactEmail: {
          $concat: [
            { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
            'xxxx@',
            { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
          ],
        },
        createdAt: 1,
        orderCount: {
          $size: '$orders',
        },
        totalGrandTotal: {
          $divide: [{ $sum: '$orders.grandTotal' }, 100],
        },
        wallets: 1,
        loyaltyPoints: {
          $divide: [{ $sum: '$loyaltypoints.loyaltyPointValue' }, 100],
        },
        status: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await User.aggregate(query);
  const resultCount = await User.aggregate(countQuery);
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

const customerReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const name = options.search;
  const matchQuery = {
    $match:
      options && options.kind && options.kind !== null && options.kind !== 'all'
        ? {
            role: options.kind,
          }
        : { role: { $in: ['user', 'guest'] } },
  };
  if (name && name !== '' && name !== null) {
    const searchRegExp = RegExp(name, 'i');
    matchQuery.$match = {
      role: { $in: ['user', 'guest'] },
      $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'user',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'loyaltypoints',
        localField: '_id',
        foreignField: 'user',
        as: 'loyaltypoints',
        pipeline: [{ $match: { redeemedToWallet: false } }],
      },
    },
    {
      $lookup: {
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'user',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $lookup: {
        from: 'favouriteorders',
        localField: '_id',
        foreignField: 'user',
        as: 'favouriteorders',
      },
    },
    {
      $lookup: {
        from: 'refundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'refundrequests',
      },
    },
    {
      $lookup: {
        from: 'diningbookingrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'diningbookingrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'tiffinsubscriptionrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'tiffinsubscriptionrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'hiderestaurants',
        localField: '_id',
        foreignField: 'user',
        as: 'hiderestaurants',
      },
    },
    {
      $lookup: {
        from: 'media',
        localField: '_id',
        foreignField: 'uid',
        as: 'media',
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'user',
        as: 'favRest',
        pipeline: [{ $match: { type: 'restaurant' } }],
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'user',
        as: 'favFood',
        pipeline: [{ $match: { type: 'food' } }],
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
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
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
        orderCount: {
          $size: '$orders',
        },
        diningBookings: {
          $size: '$diningbookings',
        },
        tiffinPackages: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        favRest: {
          $size: '$favRest',
        },
        favFood: {
          $size: '$favFood',
        },
        favOrders: {
          $size: '$favouriteorders',
        },
        medias: {
          $size: '$media',
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
        hiddenRest: {
          $size: '$hiderestaurants',
        },
        diningGrandTotal: {
          $divide: [{ $sum: '$diningbookings.grandTotal' }, 100],
        },
        orderGrandTotal: {
          $divide: [{ $sum: '$orders.grandTotal' }, 100],
        },
        tiffinPackageGrandTotal: {
          $divide: [{ $sum: '$userpurchasedtiffinsubscriptions.grandTotal' }, 100],
        },
        wallets: 1,
        loyaltyPoints: {
          $divide: [{ $sum: '$loyaltypoints.loyaltyPointValue' }, 100],
        },
        createdAt: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await User.aggregate(query);
  const resultCount = await User.aggregate(countQuery);
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

const customerDetail = async (userId) => {
  const queryCondition = { _id: new mongoose.Types.ObjectId(userId) };
  const query = [
    { $match: queryCondition },
    { $limit: 1 },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'user',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'loyaltypoints',
        localField: '_id',
        foreignField: 'user',
        as: 'loyaltypoints',
        pipeline: [{ $match: { redeemedToWallet: false } }],
      },
    },
    {
      $lookup: {
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'user',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $lookup: {
        from: 'favouriteorders',
        localField: '_id',
        foreignField: 'user',
        as: 'favouriteorders',
      },
    },
    {
      $lookup: {
        from: 'refundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'refundrequests',
      },
    },
    {
      $lookup: {
        from: 'refundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'acceptedRefundRequest',
        pipeline: [{ $match: { $or: [{ status: 'refunded' }, { status: 'partially_refunded' }] } }],
      },
    },
    {
      $lookup: {
        from: 'diningbookingrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'diningbookingrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'diningbookingrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'acceptedDiningRefundRequest',
        pipeline: [{ $match: { $or: [{ status: 'refunded' }, { status: 'partially_refunded' }] } }],
      },
    },
    {
      $lookup: {
        from: 'tiffinsubscriptionrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'tiffinsubscriptionrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'tiffinsubscriptionrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'acceptedTiffinRefundRequest',
        pipeline: [{ $match: { $or: [{ status: 'refunded' }, { status: 'partially_refunded' }] } }],
      },
    },
    {
      $lookup: {
        from: 'hiderestaurants',
        localField: '_id',
        foreignField: 'user',
        as: 'hiderestaurants',
      },
    },
    {
      $lookup: {
        from: 'media',
        localField: '_id',
        foreignField: 'uid',
        as: 'media',
      },
    },
    {
      $lookup: {
        from: 'useraddresses',
        localField: '_id',
        foreignField: 'user',
        as: 'useraddresses',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: '_id',
        foreignField: 'user',
        as: 'driverorderreviews',
      },
    },
    {
      $lookup: {
        from: 'restaurantorderreviews',
        localField: '_id',
        foreignField: 'user',
        as: 'restaurantorderreviews',
      },
    },
    {
      $lookup: {
        from: 'foodorderreviews',
        localField: '_id',
        foreignField: 'user',
        as: 'foodorderreviews',
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'user',
        as: 'favRest',
        pipeline: [{ $match: { type: 'restaurant' } }],
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'user',
        as: 'favFood',
        pipeline: [{ $match: { type: 'food' } }],
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
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
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
        orderCount: {
          $size: '$orders',
        },
        diningBookings: {
          $size: '$diningbookings',
        },
        tiffinPackages: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        favRest: {
          $size: '$favRest',
        },
        favFood: {
          $size: '$favFood',
        },
        favOrders: {
          $size: '$favouriteorders',
        },
        address: {
          $size: '$useraddresses',
        },
        medias: {
          $size: '$media',
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
        hiddenRest: {
          $size: '$hiderestaurants',
        },
        restaurantReviews: {
          $size: '$restaurantorderreviews',
        },
        foodReviews: {
          $size: '$foodorderreviews',
        },
        deliverymanReviews: {
          $size: '$driverorderreviews',
        },
        diningGrandTotal: {
          $divide: [{ $sum: '$diningbookings.grandTotal' }, 100],
        },
        diningRefundTotal: {
          $divide: [{ $sum: '$acceptedDiningRefundRequest.amount' }, 100],
        },
        orderGrandTotal: {
          $divide: [{ $sum: '$orders.grandTotal' }, 100],
        },
        orderRefundTotal: {
          $divide: [{ $sum: '$acceptedRefundRequest.amount' }, 100],
        },
        tiffinPackageGrandTotal: {
          $divide: [{ $sum: '$userpurchasedtiffinsubscriptions.grandTotal' }, 100],
        },
        tiffinRefundTotal: {
          $divide: [{ $sum: '$acceptedTiffinRefundRequest.amount' }, 100],
        },
        wallets: 1,
        loyaltyPoints: {
          $divide: [{ $sum: '$loyaltypoints.loyaltyPointValue' }, 100],
        },
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const results = await User.aggregate(query);
  if (!results[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const userInfo = results[0];
  return Promise.all([results]).then(() => {
    const result = {
      userInfo,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const adminCreateCustomer = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    role: 'user',
    isEmailVerified: false,
    isMobileVerified: false,
    locale: 'en',
  });
  return User.create(userData);
};

const adminPosCustomerDetail = async (userId) => {
  const queryCondition = { _id: new mongoose.Types.ObjectId(userId) };
  const query = [
    { $match: queryCondition },
    { $limit: 1 },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'loyaltypoints',
        localField: '_id',
        foreignField: 'user',
        as: 'loyaltypoints',
        pipeline: [{ $match: { redeemedToWallet: false } }],
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
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
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
        wallets: 1,
        loyaltyPoints: {
          $divide: [{ $sum: '$loyaltypoints.loyaltyPointValue' }, 100],
        },
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const results = await User.aggregate(query);
  if (!results[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const userInfo = results[0];
  return Promise.all([results]).then(() => {
    const result = {
      userInfo,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const posAdminUserDetail = async (userId) => {
  const user = await User.findById(userId, {
    firstName: 1,
    lastName: 1,
    countryCode: 1,
    mobile: 1,
  });
  if (!user) {
    return {
      firstName: 'POS',
      lastName: 'Order',
      countryCode: 1,
      mobile: '0000000000',
      id: '',
    };
  }
  return user;
};

const getRoleAccountList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    { $sort: { createdAt: -1 } },
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
        // Supervisors live in the same register: a kind of supportTeam
        // includes both tiers, otherwise newly created supervisors vanish
        // from the list the moment they are saved.
        $and: [{ role: options.kind === 'supportTeam' ? { $in: ['supportTeam', 'supportSupervisor'] } : options.kind }],
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        countryCode: 1,
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
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await User.aggregate(query);
  const countResult = await User.aggregate([
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
        $and: [{ role: options.kind }],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([results, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const result = {
      results,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const addAdminAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    isEmailVerified: true,
    isMobileVerified: true,
    image: param.image,
    locale: 'en',
    role: 'admin',
  });
  const user = await User.create(userData);
  return { user, success: true };
};

const addAccountantAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    isEmailVerified: true,
    isMobileVerified: true,
    image: param.image,
    locale: 'en',
    role: 'accountant',
  });
  const user = await User.create(userData);
  return { user, success: true };
};

const addSupportTeamAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    isEmailVerified: true,
    isMobileVerified: true,
    image: param.image,
    locale: 'en',
    role: param.role === 'supportSupervisor' ? 'supportSupervisor' : 'supportTeam',
  });
  const user = await User.create(userData);
  return { user, success: true };
};

const cityMasterList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
        $and: [{ role: 'cityMaster' }],
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
        firstName: 1,
        lastName: 1,
        image: 1,
        countryCode: 1,
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
        status: 1,
        createdAt: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          slug: { $ifNull: ['$cities.slug', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
      },
    },
  ];
  const results = await User.aggregate(query);
  const countResult = await User.aggregate([
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
        $and: [{ role: 'cityMaster' }],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([results, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const result = {
      results,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const addCityMaterAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    isEmailVerified: true,
    isMobileVerified: true,
    image: param.image,
    locale: 'en',
    role: 'cityMaster',
    city: param.city,
  });
  const user = await User.create(userData);
  return { user, success: true };
};

const updateRoleStatus = async (id, param) => {
  const userInfo = await User.findById(id);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  Object.assign(userInfo, param);
  await userInfo.save();
  return { success: true };
};

const roleAccountDetail = async (id) => {
  const detail = await User.findById(id, {
    firstName: 1,
    lastName: 1,
    email: 1,
    image: 1,
    countryCode: 1,
    mobile: 1,
  });
  if (!detail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  return { detail, success: true };
};

const cityMasterAccountDetail = async (id) => {
  const query = [
    { $sort: { createdAt: -1 } },
    { $match: { role: 'cityMaster', _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
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
        firstName: 1,
        lastName: 1,
        image: 1,
        email: 1,
        mobile: 1,
        countryCode: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          slug: { $ifNull: ['$cities.slug', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
      },
    },
  ];
  const results = await User.aggregate(query);
  if (!checkArrayNotEmpty(results)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  const detail = results[0];
  return { detail, success: true };
};

const updateRoleDetail = async (id, param) => {
  const userInfo = await User.findById(id);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  let updateEmail = '';
  let updateCountryCode = '';
  let updateMobile = '';
  if (userInfo.email === param.email) {
    updateEmail = userInfo.email;
  } else if (userInfo.email !== param.email) {
    if (await User.isEmailTaken(param.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
    updateEmail = userInfo.email;
  }
  if (
    parseInt(userInfo.countryCode, 10) === parseInt(param.countryCode, 10) &&
    userInfo.mobile.toString() === param.mobile.toString()
  ) {
    updateCountryCode = userInfo.countryCode;
    updateMobile = userInfo.mobile;
  } else if (
    parseInt(userInfo.countryCode, 10) !== parseInt(param.countryCode, 10) ||
    userInfo.mobile.toString() !== param.mobile.toString()
  ) {
    if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
    }
    updateCountryCode = userInfo.countryCode;
    updateMobile = userInfo.mobile;
  }

  const updateBody = {
    email: updateEmail,
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    countryCode: updateCountryCode,
    mobile: updateMobile,
  };
  // Promote/demote between agent and supervisor tiers from the same dialog.
  if (param.role === 'supportTeam' || param.role === 'supportSupervisor') {
    updateBody.role = param.role;
  }
  Object.assign(userInfo, updateBody);
  await userInfo.save();
  return { success: true };
};

const updateCityMasterDetail = async (id, param) => {
  const userInfo = await User.findById(id);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  let updateEmail = '';
  let updateCountryCode = '';
  let updateMobile = '';
  if (userInfo.email === param.email) {
    updateEmail = userInfo.email;
  } else if (userInfo.email !== param.email) {
    if (await User.isEmailTaken(param.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
    updateEmail = userInfo.email;
  }
  if (
    parseInt(userInfo.countryCode, 10) === parseInt(param.countryCode, 10) &&
    userInfo.mobile.toString() === param.mobile.toString()
  ) {
    updateCountryCode = userInfo.countryCode;
    updateMobile = userInfo.mobile;
  } else if (
    parseInt(userInfo.countryCode, 10) !== parseInt(param.countryCode, 10) ||
    userInfo.mobile.toString() !== param.mobile.toString()
  ) {
    if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
    }
    updateCountryCode = userInfo.countryCode;
    updateMobile = userInfo.mobile;
  }

  const updateBody = {
    email: updateEmail,
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    countryCode: updateCountryCode,
    mobile: updateMobile,
    city: new mongoose.Types.ObjectId(param.city),
  };
  Object.assign(userInfo, updateBody);
  await userInfo.save();
  return { success: true };
};

const adminProfile = async (id) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (!(user.role === 'admin')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  /**
   * The admin panel's session check, called by `adminAuthGuard` on every navigation.
   *
   * Also returns the operator's rights. The guard itself only ever checks
   * `success`, so adding `rights` is additive and cannot break the guard — but it
   * gives the frontend what it needs to hide controls the operator cannot use,
   * instead of rendering every button and letting the API return a 403 on click.
   *
   * The rights are the role's static list, not anything user-specific, so this
   * leaks nothing the role does not already imply.
   */
  return { success: true, rights: roleRights.get(user.role) || [], role: user.role };
};

const accountantProfile = async (id) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (!(user.role === 'accountant')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  return { success: true };
};

const supportTeamProfile = async (id) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  // Both tiers enter through the support door. Checking only `supportTeam`
  // 401s every supervisor right after a successful login.
  if (!(user.role === 'supportTeam' || user.role === 'supportSupervisor')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  return { success: true };
};

const cityMasterTeamProfile = async (id) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (!(user.role === 'cityMaster')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  return { success: true };
};

const supportTeamCustomerDetail = async (id) => {
  const user = await User.findById(id, {
    firstName: 1,
    lastName: 1,
    email: 1,
    countryCode: 1,
    mobile: 1,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  return { user, success: true };
};

const checkMobileNumberExist = async (countryCode, mobile) => {
  if (await User.isPhoneTaken(countryCode, mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  return { success: true };
};

const createSocialUserAccount = async (param) => {
  if (await User.isEmailTaken(param.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const userData = new User({
    email: param.email,
    password: param.password,
    firstName: param.firstName,
    lastName: param.lastName,
    countryCode: param.countryCode,
    mobile: param.mobile,
    isEmailVerified: true,
    isMobileVerified: false,
    locale: param.locale,
  });
  return User.create(userData);
};

const getAdminProfile = async (id) => {
  const user = await User.findById(id, {
    locale: 0,
    location: 0,
    status: 0,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  return { user, success: true };
};

const getAccountantProfile = async (id) => {
  const user = await User.findById(id, {
    locale: 0,
    location: 0,
    status: 0,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  return { user, success: true };
};

const getVendorProfile = async (id) => {
  const user = await User.findById(id, {
    locale: 0,
    location: 0,
    status: 0,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  return { user, success: true };
};

const getSupportTeamProfile = async (id) => {
  const user = await User.findById(id, {
    locale: 0,
    location: 0,
    status: 0,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  return { user, success: true };
};

const getCityzenProfile = async (id) => {
  const user = await User.findById(id, {
    locale: 0,
    location: 0,
    status: 0,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  return { user, success: true };
};

const updateAdminProfile = async (id, param) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const newCountryCode = param.countryCode.toString().replace(/\+/g, '');
  const oldCountryCode = user.countryCode.toString().replace(/\+/g, '');
  const newMobileNumber = param.mobile.toString();
  const oldMobileNumber = user.mobile.toString();
  let updatedCountryCode;
  let updatedMobileNumber;
  let credentialsUpdated = false;
  if (`${newCountryCode}${newMobileNumber}` === `${oldCountryCode}${oldMobileNumber}`) {
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
  } else {
    if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
    }
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
    credentialsUpdated = true;
  }
  let updatedEmail;
  if (param.email === user.email) {
    updatedEmail = param.email;
  } else {
    if (await User.isEmailTaken(param.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
    updatedEmail = param.email;
    credentialsUpdated = true;
  }
  const updateBody = {
    email: updatedEmail,
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    countryCode: updatedCountryCode,
    mobile: updatedMobileNumber,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true, reload: credentialsUpdated };
};

const updateAccountantProfile = async (id, param) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const newCountryCode = param.countryCode.toString().replace(/\+/g, '');
  const oldCountryCode = user.countryCode.toString().replace(/\+/g, '');
  const newMobileNumber = param.mobile.toString();
  const oldMobileNumber = user.mobile.toString();
  let updatedCountryCode;
  let updatedMobileNumber;
  let credentialsUpdated = false;
  if (`${newCountryCode}${newMobileNumber}` === `${oldCountryCode}${oldMobileNumber}`) {
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
  } else {
    if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
    }
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
    credentialsUpdated = true;
  }
  let updatedEmail;
  if (param.email === user.email) {
    updatedEmail = param.email;
  } else {
    if (await User.isEmailTaken(param.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
    updatedEmail = param.email;
    credentialsUpdated = true;
  }
  const updateBody = {
    email: updatedEmail,
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    countryCode: updatedCountryCode,
    mobile: updatedMobileNumber,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true, reload: credentialsUpdated };
};

const updateVendorProfile = async (id, param) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const newCountryCode = param.countryCode.toString().replace(/\+/g, '');
  const oldCountryCode = user.countryCode.toString().replace(/\+/g, '');
  const newMobileNumber = param.mobile.toString();
  const oldMobileNumber = user.mobile.toString();
  let updatedCountryCode;
  let updatedMobileNumber;
  let credentialsUpdated = false;
  if (`${newCountryCode}${newMobileNumber}` === `${oldCountryCode}${oldMobileNumber}`) {
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
  } else {
    if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
    }
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
    credentialsUpdated = true;
  }
  let updatedEmail;
  if (param.email === user.email) {
    updatedEmail = param.email;
  } else {
    if (await User.isEmailTaken(param.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
    updatedEmail = param.email;
    credentialsUpdated = true;
  }
  const updateBody = {
    email: updatedEmail,
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    countryCode: updatedCountryCode,
    mobile: updatedMobileNumber,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true, reload: credentialsUpdated };
};

const updateSupportTeamProfile = async (id, param) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const newCountryCode = param.countryCode.toString().replace(/\+/g, '');
  const oldCountryCode = user.countryCode.toString().replace(/\+/g, '');
  const newMobileNumber = param.mobile.toString();
  const oldMobileNumber = user.mobile.toString();
  let updatedCountryCode;
  let updatedMobileNumber;
  let credentialsUpdated = false;
  if (`${newCountryCode}${newMobileNumber}` === `${oldCountryCode}${oldMobileNumber}`) {
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
  } else {
    if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
    }
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
    credentialsUpdated = true;
  }
  let updatedEmail;
  if (param.email === user.email) {
    updatedEmail = param.email;
  } else {
    if (await User.isEmailTaken(param.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
    updatedEmail = param.email;
    credentialsUpdated = true;
  }
  const updateBody = {
    email: updatedEmail,
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    countryCode: updatedCountryCode,
    mobile: updatedMobileNumber,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true, reload: credentialsUpdated };
};

const updateAdminPassword = async (id, newPassword) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const updateBody = {
    password: newPassword,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

const updateAccountantPassword = async (id, newPassword) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const updateBody = {
    password: newPassword,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

const updateVendorPassword = async (id, newPassword) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const updateBody = {
    password: newPassword,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

const updateSupportTeamPassword = async (id, newPassword) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const updateBody = {
    password: newPassword,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

const updateCityzenPassword = async (id, newPassword) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const updateBody = {
    password: newPassword,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

const updateCityzenProfile = async (id, param) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const newCountryCode = param.countryCode.toString().replace(/\+/g, '');
  const oldCountryCode = user.countryCode.toString().replace(/\+/g, '');
  const newMobileNumber = param.mobile.toString();
  const oldMobileNumber = user.mobile.toString();
  let updatedCountryCode;
  let updatedMobileNumber;
  let credentialsUpdated = false;
  if (`${newCountryCode}${newMobileNumber}` === `${oldCountryCode}${oldMobileNumber}`) {
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
  } else {
    if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
    }
    updatedCountryCode = newCountryCode;
    updatedMobileNumber = newMobileNumber;
    credentialsUpdated = true;
  }
  let updatedEmail;
  if (param.email === user.email) {
    updatedEmail = param.email;
  } else {
    if (await User.isEmailTaken(param.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
    updatedEmail = param.email;
    credentialsUpdated = true;
  }
  const updateBody = {
    email: updatedEmail,
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    countryCode: updatedCountryCode,
    mobile: updatedMobileNumber,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true, reload: credentialsUpdated };
};

const updatePassword = async (id, newPassword) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const updateBody = {
    password: newPassword,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

const updateEmail = async (id, email) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  if (await User.isEmailTaken(email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  return { success: true };
};

const updateEmailAfterVerification = async (id, email) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  if (await User.isEmailTaken(email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  const updateBody = {
    email: `${email}`,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

const updateMobileNumber = async (id, countryCode, mobile) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const newCountryCode = countryCode.toString().replace(/\+/g, '');
  const newMobileNumber = mobile.toString();
  if (await User.isPhoneTaken(newCountryCode, newMobileNumber)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  return { success: true };
};

const updateMobileNumberAfterVerification = async (id, countryCode, mobile) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const newCountryCode = countryCode.toString().replace(/\+/g, '');
  const newMobileNumber = mobile.toString();
  if (await User.isPhoneTaken(newCountryCode, newMobileNumber)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }
  const updateBody = {
    countryCode: `${countryCode}`,
    mobile: `${mobile}`,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

const userDeleteAccount = async (user, reason) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(user) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'user',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'loyaltypoints',
        localField: '_id',
        foreignField: 'user',
        as: 'loyaltypoints',
        pipeline: [{ $match: { redeemedToWallet: false } }],
      },
    },
    {
      $lookup: {
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'user',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $lookup: {
        from: 'favouriteorders',
        localField: '_id',
        foreignField: 'user',
        as: 'favouriteorders',
      },
    },
    {
      $lookup: {
        from: 'refundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'refundrequests',
      },
    },
    {
      $lookup: {
        from: 'diningbookingrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'diningbookingrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'tiffinsubscriptionrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'tiffinsubscriptionrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'hiderestaurants',
        localField: '_id',
        foreignField: 'user',
        as: 'hiderestaurants',
      },
    },
    {
      $lookup: {
        from: 'complaints',
        localField: '_id',
        foreignField: 'user',
        as: 'complaints',
      },
    },
    {
      $lookup: {
        from: 'restaurantcomplaints',
        localField: '_id',
        foreignField: 'customer',
        as: 'restaurantcomplaints',
      },
    },
    {
      $lookup: {
        from: 'chatrooms',
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [{ $eq: ['$senderId', '$$userId'] }, { $eq: ['$receiverId', '$$userId'] }],
              },
            },
          },
        ],
        as: 'directchat',
      },
    },
    {
      $lookup: {
        from: 'supportchatrooms',
        localField: '_id',
        foreignField: 'userId',
        as: 'supportchatrooms',
      },
    },
    {
      $lookup: {
        from: 'media',
        localField: '_id',
        foreignField: 'uid',
        as: 'media',
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'user',
        as: 'favRest',
        pipeline: [{ $match: { type: 'restaurant' } }],
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'user',
        as: 'favFood',
        pipeline: [{ $match: { type: 'food' } }],
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
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        orderCount: {
          $size: '$orders',
        },
        diningBookings: {
          $size: '$diningbookings',
        },
        tiffinPackages: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        favRest: {
          $size: '$favRest',
        },
        favFood: {
          $size: '$favFood',
        },
        favOrders: {
          $size: '$favouriteorders',
        },
        medias: {
          $size: '$media',
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
        hiddenRest: {
          $size: '$hiderestaurants',
        },
        userComplaints: {
          $size: '$complaints',
        },
        restaurantComplaints: {
          $size: '$restaurantcomplaints',
        },
        directChat: {
          $size: '$directchat',
        },
        supportChat: {
          $size: '$supportchatrooms',
        },
        diningGrandTotal: {
          $divide: [{ $sum: '$diningbookings.grandTotal' }, 100],
        },
        orderGrandTotal: {
          $divide: [{ $sum: '$orders.grandTotal' }, 100],
        },
        tiffinPackageGrandTotal: {
          $divide: [{ $sum: '$userpurchasedtiffinsubscriptions.grandTotal' }, 100],
        },
        wallets: 1,
        loyaltyPoints: {
          $divide: [{ $sum: '$loyaltypoints.loyaltyPointValue' }, 100],
        },
        createdAt: 1,
      },
    },
  ];
  const userDetail = await User.aggregate(query);
  if (!checkArrayNotEmpty(userDetail)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  const info = userDetail[0];
  let walletBalance = 0;
  if (info && info.wallets && info.wallets !== null && info.wallets.balance) {
    walletBalance = info.wallets.balance;
  }
  const deletedData = new DeletedUserAccount({
    firstName: info.firstName,
    lastName: info.lastName,
    email: info.email,
    countryCode: info.countryCode,
    mobile: info.mobile,
    gender: info.gender,
    reason: `${reason}`,
    diningBookings: info.diningBookings,
    diningGrandTotal: info.diningGrandTotal,
    diningRefund: info.diningRefund,
    favFood: info.favFood,
    favOrders: info.favOrders,
    favRest: info.favRest,
    hiddenRest: info.hiddenRest,
    loyaltyPoints: info.loyaltyPoints,
    medias: info.medias,
    orderCount: info.orderCount,
    orderGrandTotal: info.orderGrandTotal,
    orderRefund: info.orderRefund,
    tiffinPackageGrandTotal: info.tiffinPackageGrandTotal,
    tiffinPackages: info.tiffinPackages,
    tiffinRefund: info.tiffinRefund,
    walletBalance: `${walletBalance}`,
    userComplaints: info.userComplaints,
    restaurantComplaints: info.restaurantComplaints,
    directChat: info.directChat,
    supportChat: info.supportChat,
  });
  const deleteDetail = await DeletedUserAccount.create(deletedData);
  const adminExpenseDrop = await AdminExpense.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const cartItemDrop = await CartItem.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const chatConversionDrop = await ChatConversion.deleteMany({
    senderId: new mongoose.Types.ObjectId(user),
  });
  const chatRoomDrop = await ChatRoom.deleteMany({
    $or: [
      { senderId: new mongoose.Types.ObjectId(user) },
      { receiverId: new mongoose.Types.ObjectId(user) },
    ],
  });
  const collectCashDrop = await CollectCash.deleteMany({
    deliveryman: new mongoose.Types.ObjectId(user),
  });
  const complaintDrop = await Complaints.deleteMany({
    $or: [
      { user: new mongoose.Types.ObjectId(user) },
      { driver: new mongoose.Types.ObjectId(user) },
    ],
  });
  const couponUsersDrop = await Coupon.updateMany(
    { user: new mongoose.Types.ObjectId(user) },
    { $pull: { user: new mongoose.Types.ObjectId(user) } }
  );
  const couponCreatorDrop = await Coupon.deleteMany({
    createdById: new mongoose.Types.ObjectId(user),
  });
  const deliverymanCashInHandDrop = await DeliverymanCashInHand.deleteMany({
    deliveryman: new mongoose.Types.ObjectId(user),
  });
  const deliverymanDisbursementDrop = await DeliverymanDisbursement.deleteMany({
    userId: new mongoose.Types.ObjectId(user),
  });
  const deliverymanPayoutDrop = await DeliverymanPayoutMethod.deleteMany({
    deliveryman: new mongoose.Types.ObjectId(user),
  });
  const diningBookingDrop = await DiningBooking.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const diningBookingRefundDrop = await DiningBookingRefundRequest.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const diningCouponUsersDrop = await DiningCoupon.updateMany(
    { user: new mongoose.Types.ObjectId(user) },
    { $pull: { user: new mongoose.Types.ObjectId(user) } }
  );
  const diningCouponCreatorDrop = await DiningCoupon.deleteMany({
    createdById: new mongoose.Types.ObjectId(user),
  });
  const driverDrop = await Driver.deleteMany({ userId: new mongoose.Types.ObjectId(user) });
  const driverNewOrderStatusDrop = await DriverNewOrderStatus.deleteMany({
    driver: new mongoose.Types.ObjectId(user),
  });
  const driverOrderReviewDrop = await DriverOrderReview.deleteMany({
    $or: [
      { user: new mongoose.Types.ObjectId(user) },
      { driver: new mongoose.Types.ObjectId(user) },
    ],
  });
  const favouriteDrop = await Favourite.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const favouriteOrderDrop = await FavouriteOrder.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const foodOrderReviewDrop = await FoodOrderReview.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const guestUserInfoDrop = await GuestUserInfo.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const hiddenRestDrop = await HideRestaurant.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const loyaltyPointDrop = await LoyaltyPoints.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const mediaDrop = await Media.deleteMany({ uid: new mongoose.Types.ObjectId(user) });
  const notificationListDrop = await NotificationList.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const ordersDrop = await Orders.deleteMany({
    $or: [
      { user: new mongoose.Types.ObjectId(user) },
      { driver: new mongoose.Types.ObjectId(user) },
    ],
  });
  const paymentInitiationDrop = await PaymentInitiation.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const notificationTokenDrop = await PushNotificationToken.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const redeemReferralDrop = await RedeemReferral.deleteMany({
    $or: [
      { owner: new mongoose.Types.ObjectId(user) },
      { redeemer: new mongoose.Types.ObjectId(user) },
    ],
  });
  const referralCodeDrop = await ReferralCode.deleteMany({
    holderId: new mongoose.Types.ObjectId(user),
  });
  const orderRefundDrop = await RefundRequest.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const reportIssueRestaurantDrop = await ReportIssueRestaurant.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const restaurantComplaintDrop = await RestaurantComplaints.deleteMany({
    $or: [
      { driver: new mongoose.Types.ObjectId(user) },
      { customer: new mongoose.Types.ObjectId(user) },
    ],
  });
  const restaurantExpenseDrop = await RestaurantExpense.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const restaurantDrop = await Restaurant.deleteMany({ userId: new mongoose.Types.ObjectId(user) });
  const restaurantOrderReviewDrop = await RestaurantOrderReview.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const supportChatConversionDrop = await SupportChatConversion.deleteMany({
    senderId: new mongoose.Types.ObjectId(user),
  });
  const supportChatUsersDrop = await SupportChatRoom.updateMany(
    { supportTeam: new mongoose.Types.ObjectId(user) },
    { $pull: { user: new mongoose.Types.ObjectId(user) } }
  );
  const supportChatDrop = await SupportChatRoom.deleteMany({
    $or: [
      { userId: new mongoose.Types.ObjectId(user) },
      { resolvedBy: new mongoose.Types.ObjectId(user) },
    ],
  });
  const tiffinSubscriptionRefundDrop = await TiffinSubscriptionRefundRequest.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const tokenDrop = await Token.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const transactionDrop = await Transactions.deleteMany({
    payableId: new mongoose.Types.ObjectId(user),
  });
  const userAddressDrop = await UserAddress.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const userPurchasedTiffinSubscriptionDrop = await UserPurchasedTiffinSubscription.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const waiterDrop = await Waiter.deleteMany({ userId: new mongoose.Types.ObjectId(user) });
  const walletDrop = await Wallet.deleteMany({ holderId: new mongoose.Types.ObjectId(user) });
  const withdrawalDrop = await WithdrawalRequest.deleteMany({
    deliveryman: new mongoose.Types.ObjectId(user),
  });
  const deleteUser = await User.findById(user);
  await deleteUser.deleteOne();
  return Promise.all([
    userDetail,
    deleteDetail,
    adminExpenseDrop,
    cartItemDrop,
    chatConversionDrop,
    chatRoomDrop,
    collectCashDrop,
    complaintDrop,
    couponUsersDrop,
    couponCreatorDrop,
    deliverymanCashInHandDrop,
    deliverymanDisbursementDrop,
    deliverymanPayoutDrop,
    diningBookingDrop,
    diningBookingRefundDrop,
    diningCouponUsersDrop,
    diningCouponCreatorDrop,
    driverDrop,
    driverNewOrderStatusDrop,
    driverOrderReviewDrop,
    favouriteDrop,
    favouriteOrderDrop,
    foodOrderReviewDrop,
    guestUserInfoDrop,
    hiddenRestDrop,
    loyaltyPointDrop,
    mediaDrop,
    notificationListDrop,
    ordersDrop,
    paymentInitiationDrop,
    notificationTokenDrop,
    redeemReferralDrop,
    referralCodeDrop,
    orderRefundDrop,
    reportIssueRestaurantDrop,
    restaurantComplaintDrop,
    restaurantExpenseDrop,
    restaurantDrop,
    restaurantOrderReviewDrop,
    supportChatConversionDrop,
    supportChatUsersDrop,
    supportChatDrop,
    tiffinSubscriptionRefundDrop,
    tokenDrop,
    transactionDrop,
    userAddressDrop,
    userPurchasedTiffinSubscriptionDrop,
    waiterDrop,
    walletDrop,
    withdrawalDrop,
    deleteUser,
  ]).then(() => {
    const result = {
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerDeletedAccount = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
      },
    },
    {
      $unwind: {
        path: '$userdeleteaccountreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        diningBookings: 1,
        diningGrandTotal: {
          $round: [{ $divide: ['$diningGrandTotal', 100] }, 2],
        },
        diningRefund: 1,
        favFood: 1,
        favOrders: 1,
        favRest: 1,
        hiddenRest: 1,
        loyaltyPoints: {
          $round: [{ $divide: ['$loyaltyPoints', 100] }, 2],
        },
        medias: 1,
        orderCount: 1,
        orderGrandTotal: {
          $round: [{ $divide: ['$orderGrandTotal', 100] }, 2],
        },
        orderRefund: 1,
        tiffinPackageGrandTotal: {
          $round: [{ $divide: ['$tiffinPackageGrandTotal', 100] }, 2],
        },
        tiffinPackages: 1,
        tiffinRefund: 1,
        walletBalance: {
          $round: [{ $divide: ['$walletBalance', 100] }, 2],
        },
        userComplaints: 1,
        restaurantComplaints: 1,
        directChat: 1,
        supportChat: 1,
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
          translations: { $ifNull: ['$userdeleteaccountreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedUserAccount.aggregate(query);
  const countResult = await DeletedUserAccount.aggregate([
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
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

const restaurantDeleteAccount = async (user, vendorId, reason) => {
  const restaurant = await Restaurant.findById(vendorId, { userId: 1, name: 1 });
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Restaurant not found');
  }
  const outletList = await Restaurant.find(
    { outletManagerId: new mongoose.Types.ObjectId(vendorId) },
    { name: 1, userId: 1 }
  );
  const restaurantIds = [
    ...new Set(outletList.map((item) => new mongoose.Types.ObjectId(item.id))),
  ];
  restaurantIds.push(new mongoose.Types.ObjectId(vendorId));
  const userIds = [...new Set(outletList.map((item) => new mongoose.Types.ObjectId(item.userId)))];
  userIds.push(new mongoose.Types.ObjectId(user));
  const cashInHandQuery = [
    { $match: { restaurant: { $in: restaurantIds }, status: true } },
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
    { $match: { restaurant: { $in: restaurantIds }, status: true } },
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
  let orderEarningCashInHand = 0;
  let posAndTableOrderCommissionAmount = 0;
  const totalCashInHand = await RestaurantCashInHand.aggregate(cashInHandQuery);
  const posAndTableOrderCommission = await RestaurantPosTableOrderCommission.aggregate(
    posAndTableOrderCommissionQuery
  );
  if (
    totalCashInHand !== null &&
    totalCashInHand.length > 0 &&
    checkArrayNotEmpty(totalCashInHand)
  ) {
    orderEarningCashInHand = parseFloat(totalCashInHand[0].inHandAmount);
  }
  if (
    posAndTableOrderCommission !== null &&
    posAndTableOrderCommission.length > 0 &&
    checkArrayNotEmpty(posAndTableOrderCommission)
  ) {
    posAndTableOrderCommissionAmount = parseFloat(posAndTableOrderCommission[0].commission);
  }
  const cashInHandAmount = parseFloat(
    parseFloat(orderEarningCashInHand) + parseFloat(posAndTableOrderCommissionAmount)
  );
  if (cashInHandAmount > 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `Please clear cash in hand amount before deleting account from your account and from outlet`
    );
  }

  const restaurantQuery = [
    { $match: { _id: { $in: restaurantIds } } },
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
      $lookup: {
        from: 'wallets',
        localField: 'userId',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'chatrooms',
        let: { userId: '$userId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [{ $eq: ['$senderId', '$$userId'] }, { $eq: ['$receiverId', '$$userId'] }],
              },
            },
          },
        ],
        as: 'directchat',
      },
    },
    {
      $lookup: {
        from: 'supportchatrooms',
        localField: 'userId',
        foreignField: 'userId',
        as: 'supportchatrooms',
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
      $lookup: {
        from: 'restaurantorderreviews',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantorderreviews',
      },
    },
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'deliverymans',
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
      $unwind: {
        path: '$users',
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
        slug: 1,
        address: 1,
        rating: 1,
        cover: 1,
        logo: 1,
        type: 1,
        commission: 1,
        posOrderCommission: 1,
        tableOrderCommission: 1,
        subscription: 1,
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
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        deliverymans: {
          $size: '$deliverymans',
        },
        tiffinPackages: {
          $size: '$subscriptiontiffinpackages',
        },
        soldTiffinPackages: {
          $size: '$userpurchasedtiffinsubscriptions',
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
        userComplaints: {
          $size: '$complaints',
        },
        restaurantComplaints: {
          $size: '$restaurantcomplaints',
        },
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
          email: { $ifNull: ['$users.email', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          gender: { $ifNull: ['$users.gender', ''] },
        },
        city: 1,
        locality: 1,
        wallets: 1,
        medias: {
          $size: '$media',
        },
        directChat: {
          $size: '$directchat',
        },
        supportChat: {
          $size: '$supportchatrooms',
        },
        translations: 1,
      },
    },
  ];
  const results = await Restaurant.aggregate(restaurantQuery);
  const deletedRestaurantArray = [];
  if (results !== null && checkArrayNotEmpty(results)) {
    results.forEach((info) => {
      const firstName =
        info &&
        info.owerInfo &&
        info.owerInfo !== null &&
        info.owerInfo.firstName !== null &&
        info.owerInfo.firstName !== ''
          ? info.owerInfo.firstName
          : '-';
      const lastName =
        info &&
        info.owerInfo &&
        info.owerInfo !== null &&
        info.owerInfo.lastName !== null &&
        info.owerInfo.lastName !== ''
          ? info.owerInfo.lastName
          : '-';
      const email =
        info &&
        info.owerInfo &&
        info.owerInfo !== null &&
        info.owerInfo.email !== null &&
        info.owerInfo.email !== ''
          ? info.owerInfo.email
          : 'unknown@foodbite.com';
      const countryCode =
        info &&
        info.owerInfo &&
        info.owerInfo !== null &&
        info.owerInfo.countryCode !== null &&
        info.owerInfo.countryCode !== ''
          ? info.owerInfo.countryCode
          : 1;
      const mobile =
        info &&
        info.owerInfo &&
        info.owerInfo !== null &&
        info.owerInfo.mobile !== null &&
        info.owerInfo.mobile !== ''
          ? info.owerInfo.mobile
          : '0000000000';
      const gender =
        info &&
        info.owerInfo &&
        info.owerInfo !== null &&
        info.owerInfo.gender !== null &&
        info.owerInfo.gender !== ''
          ? info.owerInfo.gender
          : 'male';
      const cityId = info && info.city && info.city !== null && info.city !== '' ? info.city : null;
      const localityId =
        info && info.locality && info.locality !== null && info.locality !== ''
          ? info.locality
          : null;
      let walletBalance = 0;
      if (info && info.wallets && info.wallets !== null && info.wallets.balance) {
        walletBalance = info.wallets.balance;
      }
      const deletedParam = {
        firstName: `${firstName}`,
        lastName: `${lastName}`,
        email: `${email}`,
        countryCode: `${countryCode}`,
        mobile: `${mobile}`,
        gender: `${gender}`,
        city: cityId,
        locality: localityId,
        reason: `${reason}`,
        name: info.name,
        address: info.address,
        slug: info.slug,
        rating: info.rating,
        type: info.type,
        commission: info.commission,
        posOrderCommission: info.posOrderCommission,
        tableOrderCommission: info.tableOrderCommission,
        subscription: info.subscription,
        walletBalance: `${walletBalance}`,
        orderEarningAmount: info.orderEarningAmount,
        orderDiscountGivenAmount: info.orderDiscountGivenAmount,
        orderRestaurantCommission: info.orderRestaurantCommission,
        orderFoodTaxAmount: info.orderFoodTaxAmount,
        orderServiceChargeAmount: info.orderServiceChargeAmount,
        posEarningAmount: info.posEarningAmount,
        posDiscountGivenAmount: info.posDiscountGivenAmount,
        posRestaurantCommission: info.posRestaurantCommission,
        posFoodTaxAmount: info.posFoodTaxAmount,
        posServiceChargeAmount: info.posServiceChargeAmount,
        tableOrderEarningAmount: info.tableOrderEarningAmount,
        tableOrderDiscountGivenAmount: info.tableOrderDiscountGivenAmount,
        tableOrderRestaurantCommission: info.tableOrderRestaurantCommission,
        tableOrderFoodTaxAmount: info.tableOrderFoodTaxAmount,
        tableOrderServiceChargeAmount: info.tableOrderServiceChargeAmount,
        diningEarningAmount: info.diningEarningAmount,
        diningCommissionAmount: info.diningCommissionAmount,
        totalRating: info.totalRating,
        deliverymans: info.deliverymans,
        tiffinPackages: info.tiffinPackages,
        soldTiffinPackages: info.soldTiffinPackages,
        orderRefund: info.orderRefund,
        diningRefund: info.diningRefund,
        tiffinRefund: info.tiffinRefund,
        userComplaints: info.userComplaints,
        restaurantComplaints: info.restaurantComplaints,
        orders: info.orders,
        foods: info.foods,
        diningBookings: info.diningBookings,
        posOrders: info.posOrders,
        tableOrders: info.tableOrders,
        medias: info.medias,
        directChat: info.directChat,
        supportChat: info.supportChat,
        pos: info.pos,
        ownDriver: info.ownDriver,
        promote: info.promote,
        customCategory: info.customCategory,
        multiOutlet: info.multiOutlet,
        preBooking: info.preBooking,
        tableOrder: info.tableOrder,
        tiffinSubscription: info.tiffinSubscription,
        ownWaiter: info.ownWaiter,
        ownKitchen: info.ownKitchen,
        takeAway: info.takeAway,
        acceptScheduleDelivery: info.acceptScheduleDelivery,
        acceptHomeDelivery: info.acceptHomeDelivery,
        translations: info.translations,
      };
      deletedRestaurantArray.push(deletedParam);
    });
  }
  const deliverymanIds = await Driver.distinct(
    'userId',
    { restaurant: { $in: restaurantIds } },
    { userId: 1 }
  );

  const deliverymanQuery = [
    { $match: { _id: { $in: deliverymanIds } } },
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'userId',
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
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverneworderstatuses',
        pipeline: [{ $match: { driverOrderStatus: 'delivered' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'rejectedOrders',
        pipeline: [{ $match: { driverOrderStatus: 'rejected' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'cancelledOrders',
        pipeline: [{ $match: { driverOrderStatus: 'cancelled' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'lateAccept',
        pipeline: [{ $match: { driverOrderStatus: 'accepted_another' } }],
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'chatrooms',
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [{ $eq: ['$senderId', '$$userId'] }, { $eq: ['$receiverId', '$$userId'] }],
              },
            },
          },
        ],
        as: 'directchat',
      },
    },
    {
      $lookup: {
        from: 'supportchatrooms',
        localField: '_id',
        foreignField: 'userId',
        as: 'supportchatrooms',
      },
    },
    {
      $lookup: {
        from: 'media',
        localField: '_id',
        foreignField: 'uid',
        as: 'media',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        createdAt: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        countryCode: 1,
        mobile: 1,
        email: 1,
        gender: 1,
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          type: { $ifNull: ['$drivers.type', ''] },
          rating: { $ifNull: ['$drivers.rating', 0] },
          city: { $ifNull: ['$drivers.city', null] },
          locality: { $ifNull: ['$drivers.locality', null] },
          restaurant: { $ifNull: ['$drivers.restaurant', null] },
        },
        totalEarning: {
          $divide: [{ $sum: '$driverneworderstatuses.earning' }, 100],
        },
        tipAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.tipAmount' }, 100],
        },
        incentiveAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.incentiveAmount' }, 100],
        },
        extraEarningOnShiftAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.extraEarningOnShiftAmount' }, 100],
        },
        deliveredOrders: {
          $size: '$driverneworderstatuses',
        },
        rejectedOrder: {
          $size: '$rejectedOrders',
        },
        cancelledOrder: {
          $size: '$cancelledOrders',
        },
        delayedOrder: {
          $size: '$lateAccept',
        },
        wallets: 1,
        medias: {
          $size: '$media',
        },
        directChat: {
          $size: '$directchat',
        },
        supportChat: {
          $size: '$supportchatrooms',
        },
      },
    },
  ];
  const deliverymanList = await User.aggregate(deliverymanQuery);
  const deletedDeliverymanArray = [];
  if (deliverymanList !== null && checkArrayNotEmpty(deliverymanList)) {
    deliverymanList.forEach((info) => {
      let walletBalance = 0;
      if (info && info.wallets && info.wallets !== null && info.wallets.balance) {
        walletBalance = info.wallets.balance;
      }
      let cityId = null;
      let localityId = null;
      let restaurantId = null;
      if (
        info &&
        info.driverInfo &&
        info.driverInfo !== null &&
        info.driverInfo.city &&
        info.driverInfo.city !== null
      ) {
        cityId = info.driverInfo.city;
      }
      if (
        info &&
        info.driverInfo &&
        info.driverInfo !== null &&
        info.driverInfo.locality &&
        info.driverInfo.locality !== null &&
        info.driverInfo.locality !== ''
      ) {
        localityId = info.driverInfo.locality;
      }
      if (
        info &&
        info.driverInfo &&
        info.driverInfo !== null &&
        info.driverInfo.restaurant &&
        info.driverInfo.restaurant !== null
      ) {
        restaurantId = info.driverInfo.restaurant;
      }
      const deliverymanParam = {
        firstName: info.firstName,
        lastName: info.lastName,
        email: info.email,
        countryCode: info.countryCode,
        mobile: info.mobile,
        gender: info.gender,
        city: cityId,
        locality: localityId,
        restaurant: restaurantId,
        reason: `${reason}`,
        cancelledOrder: info.cancelledOrder,
        delayedOrder: info.delayedOrder,
        deliveredOrders: info.deliveredOrders,
        rating: info.rating,
        type: info.type,
        extraEarningOnShiftAmount: info.extraEarningOnShiftAmount,
        incentiveAmount: info.incentiveAmount,
        rejectedOrder: info.rejectedOrder,
        role: info.role,
        tipAmount: info.tipAmount,
        totalEarning: info.totalEarning,
        totalRating: info.totalRating,
        walletBalance: `${walletBalance}`,
        medias: info.medias,
        directChat: info.directChat,
        supportChat: info.supportChat,
      };
      deletedDeliverymanArray.push(deliverymanParam);
    });
  }

  const waiterIds = await Waiter.distinct(
    'userId',
    { restaurant: { $in: restaurantIds } },
    { userId: 1 }
  );
  const waiterQuery = [
    { $match: { _id: { $in: waiterIds } } },
    {
      $lookup: {
        from: 'waiters',
        localField: '_id',
        foreignField: 'userId',
        as: 'waiters',
        pipeline: [
          {
            $project: {
              _id: 0,
              restaurant: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: '_id',
        foreignField: 'waiters',
        as: 'tableorders',
      },
    },
    {
      $unwind: {
        path: '$waiters',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        gender: 1,
        waiters: 1,
        orderCount: {
          $size: '$tableorders',
        },
      },
    },
  ];
  const waiterList = await User.aggregate(waiterQuery);
  const deletedWaiterArray = [];
  if (waiterList !== null && checkArrayNotEmpty(waiterList)) {
    waiterList.forEach((info) => {
      const restaurantId =
        info && info.waiters && info.waiters.restaurant ? info.waiters.restaurant : null;
      const waiterParam = {
        firstName: info.firstName,
        lastName: info.lastName,
        email: info.email,
        countryCode: info.countryCode,
        mobile: info.mobile,
        gender: info.gender,
        reason: `${reason}`,
        restaurant: restaurantId,
        orderCount: info.orderCount,
      };
      deletedWaiterArray.push(waiterParam);
    });
  }
  const kitchenIds = await KitchenOwner.distinct(
    'userId',
    { restaurant: { $in: restaurantIds } },
    { userId: 1 }
  );
  const kitchenQuery = [
    { $match: { _id: { $in: kitchenIds } } },
    {
      $lookup: {
        from: 'kitchenowners',
        localField: '_id',
        foreignField: 'userId',
        as: 'kitchenowners',
        pipeline: [
          {
            $project: {
              _id: 0,
              restaurant: 1,
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$kitchenowners',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        gender: 1,
        kitchenowners: 1,
      },
    },
  ];
  const kitchenOwnerList = await User.aggregate(kitchenQuery);
  const deletedKitchenArray = [];
  if (kitchenOwnerList !== null && checkArrayNotEmpty(kitchenOwnerList)) {
    kitchenOwnerList.forEach((info) => {
      const restaurantId =
        info && info.kitchenowners && info.kitchenowners.restaurant
          ? info.kitchenowners.restaurant
          : null;
      const kitchenParam = {
        firstName: info.firstName,
        lastName: info.lastName,
        email: info.email,
        countryCode: info.countryCode,
        mobile: info.mobile,
        gender: info.gender,
        reason: `${reason}`,
        restaurant: restaurantId,
      };
      deletedKitchenArray.push(kitchenParam);
    });
  }
  const foodList = await Food.find({ restaurant: { $in: restaurantIds } });
  const foodIdsToRemove = foodList.map((food) => food.id);
  const foodCampaigDrop = await FoodCampaign.updateMany(
    {},
    { $pull: { foods: { $in: foodIdsToRemove } } }
  );
  const deletedData = await DeletedRestaurantAccount.insertMany(deletedRestaurantArray);
  const addonDrop = await Addons.deleteMany({ restaurant: { $in: restaurantIds } });
  const bannerDrop = await Banner.deleteMany({ restaurant: { $in: restaurantIds } });
  const cartItemDrop = await CartItem.deleteMany({ restaurant: { $in: restaurantIds } });
  const collectCashDrop = await CollectCash.deleteMany({ restaurant: { $in: restaurantIds } });
  const complaintDrop = await Complaints.deleteMany({ restaurant: { $in: restaurantIds } });
  const couponRestaurantDrop = await Coupon.updateMany(
    { restaurant: { $in: restaurantIds } },
    { $pull: { restaurant: { $in: restaurantIds } } }
  );
  const deliverymanDeletedData =
    await DeletedDeliverymanAccount.insertMany(deletedDeliverymanArray);
  const waiterDeletedData = await DeletedWaiterAccount.insertMany(deletedWaiterArray);
  const kitchenDeletedData = await DeletedKitchenAccount.insertMany(deletedKitchenArray);
  const diningBookingDrop = await DiningBooking.deleteMany({ restaurant: { $in: restaurantIds } });
  const diningBookingRefundDrop = await DiningBookingRefundRequest.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const diningCampaignRestaurantDrop = await DiningCampaign.updateMany(
    { restaurant: { $in: restaurantIds } },
    { $pull: { restaurant: { $in: restaurantIds } } }
  );
  const diningCampaignRequestDrop = await DiningCampaignRequest.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const diningCouponRestaurantDrop = await DiningCoupon.updateMany(
    { restaurant: { $in: restaurantIds } },
    { $pull: { restaurant: { $in: restaurantIds } } }
  );
  const deliverymanDrop = await Driver.deleteMany({ restaurant: { $in: restaurantIds } });
  const driverNewOrderStatusDrop = await DriverNewOrderStatus.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const favouriteDrop = await Favourite.deleteMany({ restaurant: { $in: restaurantIds } });
  const foodCampaignRequestDrop = await FoodCampaignRequest.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const foodDrop = await Food.deleteMany({ restaurant: { $in: restaurantIds } });
  const foodTaxationDrop = await FoodTaxation.deleteMany({ restaurant: { $in: restaurantIds } });
  const hiddenRestDrop = await HideRestaurant.deleteMany({ restaurant: { $in: restaurantIds } });
  const ordersDrop = await Orders.deleteMany({ restaurant: { $in: restaurantIds } });
  const posOrderDrop = await PosOrTableOrder.deleteMany({ restaurant: { $in: restaurantIds } });
  const refundRequestDrop = await RefundRequest.deleteMany({ restaurant: { $in: restaurantIds } });
  const reportIssueRestaurantDrop = await ReportIssueRestaurant.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantCampaignDrop = await RestaurantCampaign.updateMany(
    { restaurant: { $in: restaurantIds } },
    { $pull: { restaurant: { $in: restaurantIds } } }
  );
  const restaurantCampaignRequestDrop = await RestaurantCampaignRequest.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantCashInHandDrop = await RestaurantCashInHand.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantComplaintDrop = await RestaurantComplaints.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantDisbursementDrop = await RestaurantDisbursement.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantExpenseDrop = await RestaurantExpense.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantExtraDetailDrop = await RestaurantExtraDetail.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantDrop = await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  const restaurantOrderReviewDrop = await RestaurantOrderReview.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantPayoutMethodDrop = await RestaurantPayoutMethod.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantPosTableOrderCommissionDrop = await RestaurantPosTableOrderCommission.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const restaurantTableDrop = await RestaurantTable.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const subscriberDrop = await Subscriber.deleteMany({ restaurant: { $in: restaurantIds } });
  const tiffinSubscriptionDrop = await SubscriptionTiffinPackage.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const tableOrderCartItemDrop = await TableOrderCartItem.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const tableOrderDrop = await TableOrder.deleteMany({ restaurant: { $in: restaurantIds } });
  const tiffinSubscriptionRefundDrop = await TiffinSubscriptionRefundRequest.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const userPurchasedTiffinSubscriptionDrop = await UserPurchasedTiffinSubscription.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const vendorCategoryDrop = await VendorCategory.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const vendorSubCategoryDrop = await VendorSubCategory.deleteMany({
    restaurant: { $in: restaurantIds },
  });
  const waiterDrop = await Waiter.deleteMany({ restaurant: { $in: restaurantIds } });
  const kitchenDrop = await KitchenOwner.deleteMany({ restaurant: { $in: restaurantIds } });
  const withdrawalDrop = await WithdrawalRequest.deleteMany({ restaurant: { $in: restaurantIds } });
  const allUserIds = [...deliverymanIds, ...waiterIds, ...kitchenIds, ...userIds].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const userDrop = await User.deleteMany({ _id: { $in: allUserIds } });
  const chatConversionDrop = await ChatConversion.deleteMany({ senderId: { $in: allUserIds } });
  const chatRoomDrop = await ChatRoom.deleteMany({
    $or: [{ senderId: { $in: allUserIds } }, { receiverId: { $in: allUserIds } }],
  });
  const tableOrderWaiterDrop = await TableOrder.updateMany(
    { waiters: { $in: allUserIds } },
    { $pull: { waiters: { $in: allUserIds } } }
  );
  const waiterAccountDrop = await Waiter.deleteMany({ userId: { $in: allUserIds } });
  const kitchenAccountDrop = await KitchenOwner.deleteMany({ userId: { $in: allUserIds } });
  const adminExpenseDrop = await AdminExpense.deleteMany({ user: { $in: allUserIds } });
  const deliverymanCashInHandDrop = await DeliverymanCashInHand.deleteMany({
    deliveryman: { $in: allUserIds },
  });
  const deliverymanDisbursementDrop = await DeliverymanDisbursement.deleteMany({
    userId: { $in: allUserIds },
  });
  const deliverymanPayoutDrop = await DeliverymanPayoutMethod.deleteMany({
    deliveryman: { $in: allUserIds },
  });
  const driverDrop = await Driver.deleteMany({ userId: { $in: allUserIds } });
  const allDriverNewOrderStatusDrop = await DriverNewOrderStatus.deleteMany({
    driver: { $in: allUserIds },
  });
  const driverOrderReviewDrop = await DriverOrderReview.deleteMany({
    $or: [{ user: { $in: allUserIds } }, { driver: { $in: allUserIds } }],
  });
  const allFavouriteDrop = await Favourite.deleteMany({ user: { $in: allUserIds } });
  const favouriteOrderDrop = await FavouriteOrder.deleteMany({ user: { $in: allUserIds } });
  const foodOrderReviewDrop = await FoodOrderReview.deleteMany({ user: { $in: allUserIds } });
  const guestUserInfoDrop = await GuestUserInfo.deleteMany({ user: { $in: allUserIds } });
  const allHiddenRestDrop = await HideRestaurant.deleteMany({ user: { $in: allUserIds } });
  const loyaltyPointDrop = await LoyaltyPoints.deleteMany({ user: { $in: allUserIds } });
  const notificationListDrop = await NotificationList.deleteMany({ user: { $in: allUserIds } });
  const allOrdersDrop = await Orders.updateMany(
    { driver: { $in: allUserIds } },
    { $set: { driver: null } }
  );
  const paymentInitiationDrop = await PaymentInitiation.deleteMany({ user: { $in: allUserIds } });
  const notificationTokenDrop = await PushNotificationToken.deleteMany({
    user: { $in: allUserIds },
  });
  const allRestaurantComplaintDrop = await RestaurantComplaints.deleteMany({
    $or: [{ driver: { $in: allUserIds } }, { customer: { $in: allUserIds } }],
  });
  const allRestaurantExpenseDrop = await RestaurantExpense.deleteMany({
    user: { $in: allUserIds },
  });
  const allRestaurantDrop = await Restaurant.deleteMany({ userId: { $in: allUserIds } });
  const allRestaurantOrderReviewDrop = await RestaurantOrderReview.deleteMany({
    user: { $in: allUserIds },
  });
  const supportChatConversionDrop = await SupportChatConversion.deleteMany({
    senderId: { $in: allUserIds },
  });
  const supportChatUsersDrop = await SupportChatRoom.updateMany(
    { supportTeam: { $in: allUserIds } },
    { $pull: { user: { $in: allUserIds } } }
  );
  const supportChatDrop = await SupportChatRoom.deleteMany({
    $or: [{ userId: { $in: allUserIds } }, { resolvedBy: { $in: allUserIds } }],
  });
  const tokenDrop = await Token.deleteMany({ user: { $in: allUserIds } });
  const transactionDrop = await Transactions.deleteMany({ payableId: { $in: allUserIds } });
  const userAddressDrop = await UserAddress.deleteMany({ user: { $in: allUserIds } });
  const allWaiterDrop = await Waiter.deleteMany({ userId: { $in: allUserIds } });
  const allKitchenOwnerDrop = await KitchenOwner.deleteMany({ userId: { $in: allUserIds } });
  const walletDrop = await Wallet.deleteMany({ holderId: { $in: allUserIds } });
  const allWithdrawalDrop = await WithdrawalRequest.deleteMany({
    deliveryman: { $in: allUserIds },
  });
  return Promise.all([
    restaurant,
    outletList,
    totalCashInHand,
    posAndTableOrderCommission,
    results,
    deliverymanIds,
    deliverymanList,
    waiterIds,
    waiterList,
    waiterDeletedData,
    deliverymanDeletedData,
    deletedData,
    addonDrop,
    bannerDrop,
    cartItemDrop,
    collectCashDrop,
    complaintDrop,
    couponRestaurantDrop,
    diningBookingDrop,
    diningBookingRefundDrop,
    diningCampaignRestaurantDrop,
    diningCampaignRequestDrop,
    diningCouponRestaurantDrop,
    deliverymanDrop,
    driverNewOrderStatusDrop,
    favouriteDrop,
    foodList,
    foodCampaigDrop,
    foodCampaignRequestDrop,
    foodDrop,
    foodTaxationDrop,
    hiddenRestDrop,
    ordersDrop,
    posOrderDrop,
    refundRequestDrop,
    reportIssueRestaurantDrop,
    restaurantCampaignDrop,
    restaurantCampaignRequestDrop,
    restaurantCashInHandDrop,
    restaurantComplaintDrop,
    restaurantDisbursementDrop,
    restaurantExpenseDrop,
    restaurantExtraDetailDrop,
    restaurantDrop,
    restaurantOrderReviewDrop,
    restaurantPayoutMethodDrop,
    restaurantPosTableOrderCommissionDrop,
    restaurantTableDrop,
    subscriberDrop,
    tiffinSubscriptionDrop,
    tableOrderCartItemDrop,
    tableOrderDrop,
    tiffinSubscriptionRefundDrop,
    userPurchasedTiffinSubscriptionDrop,
    vendorCategoryDrop,
    vendorSubCategoryDrop,
    waiterDrop,
    withdrawalDrop,
    userDrop,
    chatConversionDrop,
    chatRoomDrop,
    tableOrderWaiterDrop,
    waiterAccountDrop,
    adminExpenseDrop,
    deliverymanCashInHandDrop,
    deliverymanDisbursementDrop,
    deliverymanPayoutDrop,
    driverDrop,
    allDriverNewOrderStatusDrop,
    driverOrderReviewDrop,
    allFavouriteDrop,
    favouriteOrderDrop,
    foodOrderReviewDrop,
    guestUserInfoDrop,
    allHiddenRestDrop,
    loyaltyPointDrop,
    notificationListDrop,
    allOrdersDrop,
    paymentInitiationDrop,
    notificationTokenDrop,
    allRestaurantComplaintDrop,
    allRestaurantExpenseDrop,
    allRestaurantDrop,
    allRestaurantOrderReviewDrop,
    supportChatConversionDrop,
    supportChatUsersDrop,
    supportChatDrop,
    tokenDrop,
    transactionDrop,
    userAddressDrop,
    allWaiterDrop,
    walletDrop,
    allWithdrawalDrop,
    kitchenIds,
    kitchenOwnerList,
    kitchenDeletedData,
    kitchenDrop,
    kitchenAccountDrop,
    allKitchenOwnerDrop,
  ]).then(() => {
    const result = {
      success: true,
    };
    return Promise.resolve(result);
  });
};

const restaurantDeletedAccount = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
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
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$userdeleteaccountreasons',
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
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        name: 1,
        address: 1,
        slug: 1,
        rating: 1,
        type: 1,
        commission: 1,
        posOrderCommission: 1,
        tableOrderCommission: 1,
        walletBalance: {
          $round: [{ $divide: ['$walletBalance', 100] }, 2],
        },
        orderEarningAmount: {
          $round: [{ $divide: ['$orderEarningAmount', 100] }, 2],
        },
        orderDiscountGivenAmount: {
          $round: [{ $divide: ['$orderDiscountGivenAmount', 100] }, 2],
        },
        orderRestaurantCommission: {
          $round: [{ $divide: ['$orderRestaurantCommission', 100] }, 2],
        },
        orderFoodTaxAmount: {
          $round: [{ $divide: ['$orderFoodTaxAmount', 100] }, 2],
        },
        orderServiceChargeAmount: {
          $round: [{ $divide: ['$orderServiceChargeAmount', 100] }, 2],
        },
        posEarningAmount: {
          $round: [{ $divide: ['$posEarningAmount', 100] }, 2],
        },
        posDiscountGivenAmount: {
          $round: [{ $divide: ['$posDiscountGivenAmount', 100] }, 2],
        },
        posRestaurantCommission: {
          $round: [{ $divide: ['$posRestaurantCommission', 100] }, 2],
        },
        posFoodTaxAmount: {
          $round: [{ $divide: ['$posFoodTaxAmount', 100] }, 2],
        },
        posServiceChargeAmount: {
          $round: [{ $divide: ['$posServiceChargeAmount', 100] }, 2],
        },
        tableOrderEarningAmount: {
          $round: [{ $divide: ['$tableOrderEarningAmount', 100] }, 2],
        },
        tableOrderDiscountGivenAmount: {
          $round: [{ $divide: ['$tableOrderDiscountGivenAmount', 100] }, 2],
        },
        tableOrderRestaurantCommission: {
          $round: [{ $divide: ['$tableOrderRestaurantCommission', 100] }, 2],
        },
        tableOrderFoodTaxAmount: {
          $round: [{ $divide: ['$tableOrderFoodTaxAmount', 100] }, 2],
        },
        tableOrderServiceChargeAmount: {
          $round: [{ $divide: ['$tableOrderServiceChargeAmount', 100] }, 2],
        },
        diningEarningAmount: {
          $round: [{ $divide: ['$diningEarningAmount', 100] }, 2],
        },
        diningCommissionAmount: {
          $round: [{ $divide: ['$diningCommissionAmount', 100] }, 2],
        },
        totalRating: 1,
        deliverymans: 1,
        tiffinPackages: 1,
        soldTiffinPackages: 1,
        orderRefund: 1,
        diningRefund: 1,
        tiffinRefund: 1,
        userComplaints: 1,
        restaurantComplaints: 1,
        orders: 1,
        foods: 1,
        diningBookings: 1,
        posOrders: 1,
        tableOrders: 1,
        medias: 1,
        directChat: 1,
        supportChat: 1,
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
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        translations: 1,
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
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
          translations: { $ifNull: ['$userdeleteaccountreasons.translations', []] },
        },
        subscriptionInfo: {
          name: { $ifNull: ['$subscriptions.name', ''] },
          translations: { $ifNull: ['$subscriptions.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedRestaurantAccount.aggregate(query);
  const countResult = await DeletedRestaurantAccount.aggregate([
    {
      $match: {
        $or: [{ name: searchRegExp }],
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

const deliverymanDeleteAccount = async (user, reason) => {
  const cashInHandQuery = [
    {
      $match: { deliveryman: new mongoose.Types.ObjectId(user), status: true },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'orders',
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
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          grandTotal: { $round: [{ $divide: ['$orders.grandTotal', 100] }, 2] },
        },
      },
    },
  ];
  const cashInHand = await DeliverymanCashInHand.aggregate(cashInHandQuery);
  let cashInHandAmount = 0;
  if (cashInHand !== null && cashInHand.length > 0 && checkArrayNotEmpty(cashInHand)) {
    cashInHand.forEach((order) => {
      if (order !== null && order.orderInfo && order.orderInfo.id !== null) {
        cashInHandAmount += parseFloat(order.orderInfo.grandTotal);
      }
    });
  }
  cashInHandAmount = parseFloat(cashInHandAmount);
  if (cashInHandAmount > 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Please clear cash in hand amount before deleting account'
    );
  }
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(user) } },
    {
      $lookup: {
        from: 'drivers',
        localField: '_id',
        foreignField: 'userId',
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
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverneworderstatuses',
        pipeline: [{ $match: { driverOrderStatus: 'delivered' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'rejectedOrders',
        pipeline: [{ $match: { driverOrderStatus: 'rejected' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'cancelledOrders',
        pipeline: [{ $match: { driverOrderStatus: 'cancelled' } }],
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'driver',
        as: 'lateAccept',
        pipeline: [{ $match: { driverOrderStatus: 'accepted_another' } }],
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: '_id',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'chatrooms',
        let: { userId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [{ $eq: ['$senderId', '$$userId'] }, { $eq: ['$receiverId', '$$userId'] }],
              },
            },
          },
        ],
        as: 'directchat',
      },
    },
    {
      $lookup: {
        from: 'supportchatrooms',
        localField: '_id',
        foreignField: 'userId',
        as: 'supportchatrooms',
      },
    },
    {
      $lookup: {
        from: 'media',
        localField: '_id',
        foreignField: 'uid',
        as: 'media',
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        createdAt: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        countryCode: 1,
        mobile: 1,
        email: 1,
        gender: 1,
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          type: { $ifNull: ['$drivers.type', ''] },
          rating: { $ifNull: ['$drivers.rating', 0] },
          city: { $ifNull: ['$drivers.city', null] },
          locality: { $ifNull: ['$drivers.locality', null] },
          restaurant: { $ifNull: ['$drivers.restaurant', null] },
        },
        totalEarning: {
          $divide: [{ $sum: '$driverneworderstatuses.earning' }, 100],
        },
        tipAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.tipAmount' }, 100],
        },
        incentiveAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.incentiveAmount' }, 100],
        },
        extraEarningOnShiftAmount: {
          $divide: [{ $sum: '$driverneworderstatuses.extraEarningOnShiftAmount' }, 100],
        },
        deliveredOrders: {
          $size: '$driverneworderstatuses',
        },
        rejectedOrder: {
          $size: '$rejectedOrders',
        },
        cancelledOrder: {
          $size: '$cancelledOrders',
        },
        delayedOrder: {
          $size: '$lateAccept',
        },
        wallets: 1,
        medias: {
          $size: '$media',
        },
        directChat: {
          $size: '$directchat',
        },
        supportChat: {
          $size: '$supportchatrooms',
        },
      },
    },
  ];
  const userDetail = await User.aggregate(query);
  if (!checkArrayNotEmpty(userDetail)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Deliveryman not found');
  }
  const info = userDetail[0];
  let walletBalance = 0;
  if (info && info.wallets && info.wallets !== null && info.wallets.balance) {
    walletBalance = info.wallets.balance;
  }
  let cityId = null;
  let localityId = null;
  let restaurantId = null;
  if (
    info &&
    info.driverInfo &&
    info.driverInfo !== null &&
    info.driverInfo.city &&
    info.driverInfo.city !== null
  ) {
    cityId = info.driverInfo.city;
  }
  if (
    info &&
    info.driverInfo &&
    info.driverInfo !== null &&
    info.driverInfo.locality &&
    info.driverInfo.locality !== null &&
    info.driverInfo.locality !== ''
  ) {
    localityId = info.driverInfo.locality;
  }
  if (
    info &&
    info.driverInfo &&
    info.driverInfo !== null &&
    info.driverInfo.restaurant &&
    info.driverInfo.restaurant !== null
  ) {
    restaurantId = info.driverInfo.restaurant;
  }
  const deletedData = new DeletedDeliverymanAccount({
    firstName: info.firstName,
    lastName: info.lastName,
    email: info.email,
    countryCode: info.countryCode,
    mobile: info.mobile,
    gender: info.gender,
    city: cityId,
    locality: localityId,
    restaurant: restaurantId,
    reason: `${reason}`,
    cancelledOrder: info.cancelledOrder,
    delayedOrder: info.delayedOrder,
    deliveredOrders: info.deliveredOrders,
    rating: info.rating,
    type: info.type,
    extraEarningOnShiftAmount: info.extraEarningOnShiftAmount,
    incentiveAmount: info.incentiveAmount,
    rejectedOrder: info.rejectedOrder,
    role: info.role,
    tipAmount: info.tipAmount,
    totalEarning: info.totalEarning,
    totalRating: info.totalRating,
    walletBalance: `${walletBalance}`,
    medias: info.medias,
    directChat: info.directChat,
    supportChat: info.supportChat,
  });
  const deleteDetail = await DeletedDeliverymanAccount.create(deletedData);
  const adminExpenseDrop = await AdminExpense.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const cartItemDrop = await CartItem.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const chatConversionDrop = await ChatConversion.deleteMany({
    senderId: new mongoose.Types.ObjectId(user),
  });
  const chatRoomDrop = await ChatRoom.deleteMany({
    $or: [
      { senderId: new mongoose.Types.ObjectId(user) },
      { receiverId: new mongoose.Types.ObjectId(user) },
    ],
  });
  const collectCashDrop = await CollectCash.deleteMany({
    deliveryman: new mongoose.Types.ObjectId(user),
  });
  const complaintDrop = await Complaints.deleteMany({
    $or: [
      { user: new mongoose.Types.ObjectId(user) },
      { driver: new mongoose.Types.ObjectId(user) },
    ],
  });
  const deliverymanCashInHandDrop = await DeliverymanCashInHand.deleteMany({
    deliveryman: new mongoose.Types.ObjectId(user),
  });
  const deliverymanDisbursementDrop = await DeliverymanDisbursement.deleteMany({
    userId: new mongoose.Types.ObjectId(user),
  });
  const deliverymanPayoutDrop = await DeliverymanPayoutMethod.deleteMany({
    deliveryman: new mongoose.Types.ObjectId(user),
  });
  const driverDrop = await Driver.deleteMany({ userId: new mongoose.Types.ObjectId(user) });
  const driverNewOrderStatusDrop = await DriverNewOrderStatus.deleteMany({
    driver: new mongoose.Types.ObjectId(user),
  });
  const driverOrderReviewDrop = await DriverOrderReview.deleteMany({
    $or: [
      { user: new mongoose.Types.ObjectId(user) },
      { driver: new mongoose.Types.ObjectId(user) },
    ],
  });
  const favouriteDrop = await Favourite.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const favouriteOrderDrop = await FavouriteOrder.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const foodOrderReviewDrop = await FoodOrderReview.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const guestUserInfoDrop = await GuestUserInfo.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const hiddenRestDrop = await HideRestaurant.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const loyaltyPointDrop = await LoyaltyPoints.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const notificationListDrop = await NotificationList.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const ordersDrop = await Orders.updateMany(
    { driver: new mongoose.Types.ObjectId(user) },
    { $set: { driver: null } }
  );
  const paymentInitiationDrop = await PaymentInitiation.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const notificationTokenDrop = await PushNotificationToken.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const restaurantComplaintDrop = await RestaurantComplaints.deleteMany({
    $or: [
      { driver: new mongoose.Types.ObjectId(user) },
      { customer: new mongoose.Types.ObjectId(user) },
    ],
  });
  const restaurantExpenseDrop = await RestaurantExpense.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const restaurantDrop = await Restaurant.deleteMany({ userId: new mongoose.Types.ObjectId(user) });
  const restaurantOrderReviewDrop = await RestaurantOrderReview.deleteMany({
    user: new mongoose.Types.ObjectId(user),
  });
  const supportChatConversionDrop = await SupportChatConversion.deleteMany({
    senderId: new mongoose.Types.ObjectId(user),
  });
  const supportChatUsersDrop = await SupportChatRoom.updateMany(
    { supportTeam: new mongoose.Types.ObjectId(user) },
    { $pull: { user: new mongoose.Types.ObjectId(user) } }
  );
  const supportChatDrop = await SupportChatRoom.deleteMany({
    $or: [
      { userId: new mongoose.Types.ObjectId(user) },
      { resolvedBy: new mongoose.Types.ObjectId(user) },
    ],
  });
  const tokenDrop = await Token.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const transactionDrop = await Transactions.deleteMany({
    payableId: new mongoose.Types.ObjectId(user),
  });
  const userAddressDrop = await UserAddress.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const waiterDrop = await Waiter.deleteMany({ userId: new mongoose.Types.ObjectId(user) });
  const walletDrop = await Wallet.deleteMany({ holderId: new mongoose.Types.ObjectId(user) });
  const withdrawalDrop = await WithdrawalRequest.deleteMany({
    deliveryman: new mongoose.Types.ObjectId(user),
  });
  const deleteUser = await User.findById(user);
  await deleteUser.deleteOne();
  return Promise.all([
    cashInHand,
    userDetail,
    deleteDetail,
    adminExpenseDrop,
    cartItemDrop,
    chatConversionDrop,
    chatRoomDrop,
    collectCashDrop,
    complaintDrop,
    deliverymanCashInHandDrop,
    deliverymanDisbursementDrop,
    deliverymanPayoutDrop,
    driverDrop,
    driverNewOrderStatusDrop,
    driverOrderReviewDrop,
    favouriteDrop,
    favouriteOrderDrop,
    foodOrderReviewDrop,
    guestUserInfoDrop,
    hiddenRestDrop,
    loyaltyPointDrop,
    notificationListDrop,
    ordersDrop,
    paymentInitiationDrop,
    notificationTokenDrop,
    restaurantComplaintDrop,
    restaurantExpenseDrop,
    restaurantDrop,
    restaurantOrderReviewDrop,
    supportChatConversionDrop,
    supportChatUsersDrop,
    supportChatDrop,
    tokenDrop,
    transactionDrop,
    userAddressDrop,
    waiterDrop,
    walletDrop,
    withdrawalDrop,
    deleteUser,
  ]).then(() => {
    const result = {
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanDeletedAccount = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
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
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$userdeleteaccountreasons',
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
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        cancelledOrder: 1,
        delayedOrder: 1,
        deliveredOrders: 1,
        rating: 1,
        type: 1,
        extraEarningOnShiftAmount: {
          $round: [{ $divide: ['$extraEarningOnShiftAmount', 100] }, 2],
        },
        incentiveAmount: {
          $round: [{ $divide: ['$incentiveAmount', 100] }, 2],
        },
        rejectedOrder: 1,
        role: 1,
        tipAmount: {
          $round: [{ $divide: ['$tipAmount', 100] }, 2],
        },
        totalEarning: {
          $round: [{ $divide: ['$totalEarning', 100] }, 2],
        },
        totalRating: 1,
        walletBalance: {
          $round: [{ $divide: ['$walletBalance', 100] }, 2],
        },
        medias: 1,
        directChat: 1,
        supportChat: 1,
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
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
          translations: { $ifNull: ['$userdeleteaccountreasons.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedDeliverymanAccount.aggregate(query);
  const countResult = await DeletedDeliverymanAccount.aggregate([
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
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

const waiterDeleteAccount = async (user, reason) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(user) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'waiters',
        localField: '_id',
        foreignField: 'userId',
        as: 'waiters',
        pipeline: [
          {
            $project: {
              _id: 0,
              restaurant: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: '_id',
        foreignField: 'waiters',
        as: 'tableorders',
      },
    },
    {
      $unwind: {
        path: '$waiters',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        gender: 1,
        waiters: 1,
        orderCount: {
          $size: '$tableorders',
        },
      },
    },
  ];
  const userDetail = await User.aggregate(query);
  if (!checkArrayNotEmpty(userDetail)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Waiter not found');
  }
  const info = userDetail[0];
  const restaurantId =
    info && info.waiters && info.waiters.restaurant ? info.waiters.restaurant : null;
  const deletedData = new DeletedWaiterAccount({
    firstName: info.firstName,
    lastName: info.lastName,
    email: info.email,
    countryCode: info.countryCode,
    mobile: info.mobile,
    gender: info.gender,
    reason: `${reason}`,
    restaurant: restaurantId,
    orderCount: info.orderCount,
  });
  const deleteDetail = await DeletedWaiterAccount.create(deletedData);
  const tableOrderWaiterDrop = await TableOrder.updateMany(
    { waiters: new mongoose.Types.ObjectId(user) },
    { $pull: { waiters: new mongoose.Types.ObjectId(user) } }
  );
  const deleteUser = await User.findById(user);
  await deleteUser.deleteOne();
  const waiterAccountDrop = await Waiter.deleteMany({ userId: new mongoose.Types.ObjectId(user) });
  return Promise.all([
    userDetail,
    deleteDetail,
    tableOrderWaiterDrop,
    deleteUser,
    waiterAccountDrop,
  ]).then(() => {
    const result = {
      success: true,
    };
    return Promise.resolve(result);
  });
};

const waiterDeletedAccount = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
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
        path: '$userdeleteaccountreasons',
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
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        orderCount: 1,
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
          translations: { $ifNull: ['$userdeleteaccountreasons.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedWaiterAccount.aggregate(query);
  const countResult = await DeletedWaiterAccount.aggregate([
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
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

const kitchenDeleteAccount = async (user, reason) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(user) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'kitchenowners',
        localField: '_id',
        foreignField: 'userId',
        as: 'kitchenowners',
        pipeline: [
          {
            $project: {
              _id: 0,
              restaurant: 1,
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$kitchenowners',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        gender: 1,
        kitchenowners: 1,
      },
    },
  ];
  const userDetail = await User.aggregate(query);
  if (!checkArrayNotEmpty(userDetail)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Kitchen Owner not found');
  }
  const info = userDetail[0];
  const restaurantId =
    info && info.kitchenowners && info.kitchenowners.restaurant
      ? info.kitchenowners.restaurant
      : null;
  const deletedData = new DeletedKitchenAccount({
    firstName: info.firstName,
    lastName: info.lastName,
    email: info.email,
    countryCode: info.countryCode,
    mobile: info.mobile,
    gender: info.gender,
    reason: `${reason}`,
    restaurant: restaurantId,
  });
  const deleteDetail = await DeletedKitchenAccount.create(deletedData);
  const kitchenOwner = await KitchenOwner.deleteMany({ userId: new mongoose.Types.ObjectId(user) });
  const tokenDrop = await Token.deleteMany({ user: new mongoose.Types.ObjectId(user) });
  const deleteUser = await User.findById(user);
  await deleteUser.deleteOne();
  return Promise.all([userDetail, deleteDetail, kitchenOwner, tokenDrop, deleteUser]).then(() => {
    const result = {
      success: true,
    };
    return Promise.resolve(result);
  });
};

const kitchenDeletedAccount = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
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
        path: '$userdeleteaccountreasons',
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
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
          translations: { $ifNull: ['$userdeleteaccountreasons.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedKitchenAccount.aggregate(query);
  const countResult = await DeletedKitchenAccount.aggregate([
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
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

const adminUserContactDetail = async (id) => {
  const user = await User.findById(id, {
    firstName: 1,
    lastName: 1,
    email: 1,
    image: 1,
    countryCode: 1,
    mobile: 1,
    role: 1,
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  return { user, success: true };
};

const exportCollectionAuthRole = async (authRole, search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    { $sort: { createdAt: -1 } },
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
        $and: [{ role: authRole }],
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        status: 1,
      },
    },
  ];
  const results = await User.aggregate(query);
  return results;
};

const exportRawCollectionAuthRole = async (authRole, search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    { $sort: { createdAt: -1 } },
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
        $and: [{ role: authRole }],
      },
    },
  ];
  const results = await User.aggregate(query);
  return results;
};

const exportCollectionCityzenRole = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    { $sort: { createdAt: -1 } },
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
        $and: [{ role: 'cityMaster' }],
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
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        status: 1,
        city: {
          name: { $ifNull: ['$cities.name', ''] },
        },
      },
    },
  ];
  const results = await User.aggregate(query);
  return results;
};

const exportCollectionCustomerDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
      },
    },
    {
      $unwind: {
        path: '$userdeleteaccountreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        diningBookings: 1,
        diningGrandTotal: {
          $round: [{ $divide: ['$diningGrandTotal', 100] }, 2],
        },
        diningRefund: 1,
        favFood: 1,
        favOrders: 1,
        favRest: 1,
        hiddenRest: 1,
        loyaltyPoints: {
          $round: [{ $divide: ['$loyaltyPoints', 100] }, 2],
        },
        medias: 1,
        orderCount: 1,
        orderGrandTotal: {
          $round: [{ $divide: ['$orderGrandTotal', 100] }, 2],
        },
        orderRefund: 1,
        tiffinPackageGrandTotal: {
          $round: [{ $divide: ['$tiffinPackageGrandTotal', 100] }, 2],
        },
        tiffinPackages: 1,
        tiffinRefund: 1,
        walletBalance: {
          $round: [{ $divide: ['$walletBalance', 100] }, 2],
        },
        userComplaints: 1,
        restaurantComplaints: 1,
        directChat: 1,
        supportChat: 1,
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedUserAccount.aggregate(query);
  return results;
};

const exportCollectionRawCustomerDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
  ];
  const results = await DeletedUserAccount.aggregate(query);
  return results;
};

const exportCollectionRestaurantDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
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
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$userdeleteaccountreasons',
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
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        name: 1,
        address: 1,
        slug: 1,
        rating: 1,
        type: 1,
        commission: 1,
        posOrderCommission: 1,
        tableOrderCommission: 1,
        walletBalance: {
          $round: [{ $divide: ['$walletBalance', 100] }, 2],
        },
        orderEarningAmount: {
          $round: [{ $divide: ['$orderEarningAmount', 100] }, 2],
        },
        orderDiscountGivenAmount: {
          $round: [{ $divide: ['$orderDiscountGivenAmount', 100] }, 2],
        },
        orderRestaurantCommission: {
          $round: [{ $divide: ['$orderRestaurantCommission', 100] }, 2],
        },
        orderFoodTaxAmount: {
          $round: [{ $divide: ['$orderFoodTaxAmount', 100] }, 2],
        },
        orderServiceChargeAmount: {
          $round: [{ $divide: ['$orderServiceChargeAmount', 100] }, 2],
        },
        posEarningAmount: {
          $round: [{ $divide: ['$posEarningAmount', 100] }, 2],
        },
        posDiscountGivenAmount: {
          $round: [{ $divide: ['$posDiscountGivenAmount', 100] }, 2],
        },
        posRestaurantCommission: {
          $round: [{ $divide: ['$posRestaurantCommission', 100] }, 2],
        },
        posFoodTaxAmount: {
          $round: [{ $divide: ['$posFoodTaxAmount', 100] }, 2],
        },
        posServiceChargeAmount: {
          $round: [{ $divide: ['$posServiceChargeAmount', 100] }, 2],
        },
        tableOrderEarningAmount: {
          $round: [{ $divide: ['$tableOrderEarningAmount', 100] }, 2],
        },
        tableOrderDiscountGivenAmount: {
          $round: [{ $divide: ['$tableOrderDiscountGivenAmount', 100] }, 2],
        },
        tableOrderRestaurantCommission: {
          $round: [{ $divide: ['$tableOrderRestaurantCommission', 100] }, 2],
        },
        tableOrderFoodTaxAmount: {
          $round: [{ $divide: ['$tableOrderFoodTaxAmount', 100] }, 2],
        },
        tableOrderServiceChargeAmount: {
          $round: [{ $divide: ['$tableOrderServiceChargeAmount', 100] }, 2],
        },
        diningEarningAmount: {
          $round: [{ $divide: ['$diningEarningAmount', 100] }, 2],
        },
        diningCommissionAmount: {
          $round: [{ $divide: ['$diningCommissionAmount', 100] }, 2],
        },
        totalRating: 1,
        deliverymans: 1,
        tiffinPackages: 1,
        soldTiffinPackages: 1,
        orderRefund: 1,
        diningRefund: 1,
        tiffinRefund: 1,
        userComplaints: 1,
        restaurantComplaints: 1,
        orders: 1,
        foods: 1,
        diningBookings: 1,
        posOrders: 1,
        tableOrders: 1,
        medias: 1,
        directChat: 1,
        supportChat: 1,
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
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
        },
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
        },
        subscriptionInfo: {
          id: { $ifNull: ['$subscriptions._id', ''] },
          name: { $ifNull: ['$subscriptions.name', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedRestaurantAccount.aggregate(query);
  return results;
};

const exportCollectionRawRestaurantDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }],
      },
    },
  ];
  const results = await DeletedRestaurantAccount.aggregate(query);
  return results;
};

const exportCollectionDeliverymanDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
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
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$userdeleteaccountreasons',
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
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        cancelledOrder: 1,
        delayedOrder: 1,
        deliveredOrders: 1,
        rating: 1,
        type: 1,
        extraEarningOnShiftAmount: {
          $round: [{ $divide: ['$extraEarningOnShiftAmount', 100] }, 2],
        },
        incentiveAmount: {
          $round: [{ $divide: ['$incentiveAmount', 100] }, 2],
        },
        rejectedOrder: 1,
        role: 1,
        tipAmount: {
          $round: [{ $divide: ['$tipAmount', 100] }, 2],
        },
        totalEarning: {
          $round: [{ $divide: ['$totalEarning', 100] }, 2],
        },
        totalRating: 1,
        walletBalance: {
          $round: [{ $divide: ['$walletBalance', 100] }, 2],
        },
        medias: 1,
        directChat: 1,
        supportChat: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
        },
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedDeliverymanAccount.aggregate(query);
  return results;
};

const exportCollectionRawDeliverymanDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
  ];
  const results = await DeletedDeliverymanAccount.aggregate(query);
  return results;
};

const exportCollectionWaiterDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
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
        path: '$userdeleteaccountreasons',
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
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        orderCount: 1,
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedWaiterAccount.aggregate(query);
  return results;
};

const exportCollectionRawWaiterDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
  ];
  const results = await DeletedWaiterAccount.aggregate(query);
  return results;
};

const exportCollectionKitchenOwnerDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'userdeleteaccountreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'userdeleteaccountreasons',
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
        path: '$userdeleteaccountreasons',
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
        firstName: 1,
        lastName: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        gender: 1,
        reasons: {
          id: { $ifNull: ['$userdeleteaccountreasons._id', ''] },
          name: { $ifNull: ['$userdeleteaccountreasons.name', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DeletedKitchenAccount.aggregate(query);
  return results;
};

const exportCollectionRawKitchenOwnerDeletedAccounts = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
      },
    },
  ];
  const results = await DeletedKitchenAccount.aggregate(query);
  return results;
};

const exportCustomerCollection = async (filterQuery) => {
  const filter = filterQuery.filter === 'true' || filterQuery.filter === true;
  const filterStatus = filterQuery.status === 'true' || filterQuery.status === true;
  let sortBy = -1;
  const name = filterQuery.search;
  const matchQuery = {
    $match: filter
      ? { role: { $in: [filterQuery.role] }, status: filterStatus }
      : { role: { $in: ['user', 'guest'] }, status: { $in: [true, false] } },
  };
  if (name && name !== '' && name !== null) {
    matchQuery.$match = {
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }

  if (filter) {
    if (filterQuery.sortBy === 'oldest') {
      sortBy = 1;
    } else if (filterQuery.sortBy === 'newest') {
      sortBy = -1;
    }
    if (filterQuery.joiningDate !== '-') {
      const dateRangeArray = filterQuery.joiningDate.split('-');

      if (dateRangeArray && checkArrayNotEmpty(dateRangeArray)) {
        const parseDate = (dateStr) => {
          const [day, month, year] = dateStr.trim().split('/');
          return new Date(`${year}-${month}-${day}`);
        };

        const start = parseDate(dateRangeArray[0]);
        const end = parseDate(dateRangeArray[1]);

        const dateRange = {};

        if (start) dateRange.$gte = start;
        if (end) dateRange.$lte = end;

        matchQuery.$match.createdAt = dateRange;
      }
    }
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: sortBy } },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        firstName: 1,
        lastName: 1,
        image: 1,
        role: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        createdAt: 1,
        orderCount: {
          $size: '$orders',
        },
        totalGrandTotal: {
          $divide: [{ $sum: '$orders.grandTotal' }, 100],
        },
        status: 1,
      },
    },
  ];
  const result = await User.aggregate(query);
  return result;
};

const exportRawCustomerCollection = async (filterQuery) => {
  const filter = filterQuery.filter === 'true' || filterQuery.filter === true;
  const filterStatus = filterQuery.status === 'true' || filterQuery.status === true;
  let sortBy = -1;
  const name = filterQuery.search;
  const matchQuery = {
    $match: filter
      ? { role: { $in: [filterQuery.role] }, status: filterStatus }
      : { role: { $in: ['user', 'guest'] }, status: { $in: [true, false] } },
  };
  if (name && name !== '' && name !== null) {
    matchQuery.$match = {
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }

  if (filter) {
    if (filterQuery.sortBy === 'oldest') {
      sortBy = 1;
    } else if (filterQuery.sortBy === 'newest') {
      sortBy = -1;
    }
    if (filterQuery.joiningDate !== '-') {
      const dateRangeArray = filterQuery.joiningDate.split('-');

      if (dateRangeArray && checkArrayNotEmpty(dateRangeArray)) {
        const parseDate = (dateStr) => {
          const [day, month, year] = dateStr.trim().split('/');
          return new Date(`${year}-${month}-${day}`);
        };

        const start = parseDate(dateRangeArray[0]);
        const end = parseDate(dateRangeArray[1]);

        const dateRange = {};

        if (start) dateRange.$gte = start;
        if (end) dateRange.$lte = end;

        matchQuery.$match.createdAt = dateRange;
      }
    }
  }
  const results = await User.find(matchQuery.$match).sort({ createdAt: sortBy }).lean();
  return results;
};

const exportCustomerFundCollection = async (search) => {
  const matchQuery = { $match: { role: 'user' } };
  const name = search;
  if (name && name !== '' && name !== null && name !== 'none') {
    matchQuery.$match = {
      role: 'user',
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'loyaltypoints',
        localField: '_id',
        foreignField: 'user',
        as: 'loyaltypoints',
        pipeline: [{ $match: { redeemedToWallet: false } }],
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
        firstName: 1,
        lastName: 1,
        image: 1,
        email: 1,
        countryCode: 1,
        mobile: 1,
        createdAt: 1,
        orderCount: {
          $size: '$orders',
        },
        totalGrandTotal: {
          $divide: [{ $sum: '$orders.grandTotal' }, 100],
        },
        wallets: 1,
        loyaltyPoints: {
          $divide: [{ $sum: '$loyaltypoints.loyaltyPointValue' }, 100],
        },
        status: 1,
      },
    },
  ];
  const result = await User.aggregate(query);
  return result;
};

const exportRawCustomerFundCollection = async (search) => {
  const matchQuery = { $match: { role: 'user' } };
  const name = search;
  if (name && name !== '' && name !== null && name !== 'none') {
    matchQuery.$match = {
      role: 'user',
      $or: [{ firstName: RegExp(name, 'i') }, { lastName: RegExp(name, 'i') }],
    };
  }
  const results = await User.find(matchQuery.$match).lean();
  return results;
};

const exportCustomerReportCollection = async (options) => {
  const name = options.search;
  const matchQuery = {
    $match:
      options && options.kind && options.kind !== null && options.kind !== 'all'
        ? {
            role: options.kind,
          }
        : { role: { $in: ['user', 'guest'] } },
  };
  if (name && name !== '' && name !== null) {
    const searchRegExp = RegExp(name, 'i');
    matchQuery.$match = {
      role: { $in: ['user', 'guest'] },
      $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }],
    };
  }
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'user',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: '_id',
        foreignField: 'user',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'holderId',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'loyaltypoints',
        localField: '_id',
        foreignField: 'user',
        as: 'loyaltypoints',
        pipeline: [{ $match: { redeemedToWallet: false } }],
      },
    },
    {
      $lookup: {
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'user',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $lookup: {
        from: 'favouriteorders',
        localField: '_id',
        foreignField: 'user',
        as: 'favouriteorders',
      },
    },
    {
      $lookup: {
        from: 'refundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'refundrequests',
      },
    },
    {
      $lookup: {
        from: 'diningbookingrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'diningbookingrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'tiffinsubscriptionrefundrequests',
        localField: '_id',
        foreignField: 'user',
        as: 'tiffinsubscriptionrefundrequests',
      },
    },
    {
      $lookup: {
        from: 'hiderestaurants',
        localField: '_id',
        foreignField: 'user',
        as: 'hiderestaurants',
      },
    },
    {
      $lookup: {
        from: 'media',
        localField: '_id',
        foreignField: 'uid',
        as: 'media',
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'user',
        as: 'favRest',
        pipeline: [{ $match: { type: 'restaurant' } }],
      },
    },
    {
      $lookup: {
        from: 'favourites',
        localField: '_id',
        foreignField: 'user',
        as: 'favFood',
        pipeline: [{ $match: { type: 'food' } }],
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
        firstName: 1,
        lastName: 1,
        role: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        orderCount: {
          $size: '$orders',
        },
        diningBookings: {
          $size: '$diningbookings',
        },
        tiffinPackages: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        favRest: {
          $size: '$favRest',
        },
        favFood: {
          $size: '$favFood',
        },
        favOrders: {
          $size: '$favouriteorders',
        },
        medias: {
          $size: '$media',
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
        hiddenRest: {
          $size: '$hiderestaurants',
        },
        diningGrandTotal: {
          $divide: [{ $sum: '$diningbookings.grandTotal' }, 100],
        },
        orderGrandTotal: {
          $divide: [{ $sum: '$orders.grandTotal' }, 100],
        },
        tiffinPackageGrandTotal: {
          $divide: [{ $sum: '$userpurchasedtiffinsubscriptions.grandTotal' }, 100],
        },
        wallets: 1,
        loyaltyPoints: {
          $divide: [{ $sum: '$loyaltypoints.loyaltyPointValue' }, 100],
        },
        createdAt: 1,
      },
    },
  ];
  const result = await User.aggregate(query);
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

const importCollection = async (importArray) => {
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
          role:
            param && param.role && param.role !== null && param.role !== '' && param.role === 'user'
              ? 'user'
              : 'guest',
          location: { type: 'Point', coordinates: [longitude, latitude] },
          city: param && param.city && param.city !== null && param.city !== '' ? param.city : null,
          status: param && (param.status === 'active' || param.status === 'Active'),
        });
        const user = await User.create(userData);
        const walletData = new Wallet({
          holderId: user.id,
        });
        const referralCode = new ReferralCode({
          holderId: user.id,
        });
        if (!(await Wallet.isUserExist(walletData.holderId))) {
          await Wallet.create(walletData);
        }
        if (!(await ReferralCode.isUserExist(referralCode.holderId))) {
          await ReferralCode.create(referralCode);
        }
      }
    });
  }
  return { success: true };
};

const importAuthRolesCollection = async (importArray, role) => {
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
          locale: 'en',
          image:
            param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
          gender:
            param && param.gender && param.gender !== null && param.gender !== ''
              ? param.gender
              : 'male',
          role: `${role}`,
          location: { type: 'Point', coordinates: [0, 0] },
          city: param && param.city && param.city !== null && param.city !== '' ? param.city : null,
          status: param && (param.status === 'active' || param.status === 'Active'),
        });
        await User.create(userData);
      }
    });
  }
  return { success: true };
};

const updateUserLocale = async (id, appLocale) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Detail not found');
  }
  const updateBody = {
    locale: appLocale,
  };
  Object.assign(user, updateBody);
  await user.save();
  return { success: true };
};

module.exports = {
  createUser,
  getUserById,
  getUserByEmail,
  updateUserById,
  deleteUserById,
  registerAdminAccountInitial,
  createVendorAccount,
  isAdminSetupDone,
  createDriverAccount,
  createWaiterAccount,
  createVendorDriverAccount,
  createOutletAccount,
  canCreateAccount,
  createGuestUser,
  findUserWithName,
  getUserByCountryCodeAndMobileNumber,
  getMyProfile,
  updateMyProfile,
  getMyDriverProfile,
  updateDeliverymanProfile,
  getMyReferralCode,
  callCustomer,
  checkUserRegisterStatus,
  customerList,
  updateStatus,
  customerWalletFundList,
  customerReport,
  customerDetail,
  adminCreateCustomer,
  adminPosCustomerDetail,
  posAdminUserDetail,
  getRoleAccountList,
  addAdminAccount,
  addAccountantAccount,
  addSupportTeamAccount,
  cityMasterList,
  addCityMaterAccount,
  updateRoleStatus,
  roleAccountDetail,
  cityMasterAccountDetail,
  updateRoleDetail,
  updateCityMasterDetail,
  adminProfile,
  accountantProfile,
  supportTeamProfile,
  cityMasterTeamProfile,
  supportTeamCustomerDetail,
  cityzenCreateVendorAccount,
  cityzenCreateDriverAccount,
  checkMobileNumberExist,
  createSocialUserAccount,
  getAdminProfile,
  getAccountantProfile,
  getVendorProfile,
  getSupportTeamProfile,
  getCityzenProfile,
  updateAdminProfile,
  updateAccountantProfile,
  updateVendorProfile,
  updateSupportTeamProfile,
  updateAdminPassword,
  updateAccountantPassword,
  updateVendorPassword,
  updateSupportTeamPassword,
  updateCityzenPassword,
  updateCityzenProfile,
  updatePassword,
  updateEmail,
  updateEmailAfterVerification,
  updateMobileNumber,
  updateMobileNumberAfterVerification,
  userDeleteAccount,
  customerDeletedAccount,
  restaurantDeleteAccount,
  restaurantDeletedAccount,
  deliverymanDeleteAccount,
  deliverymanDeletedAccount,
  waiterDeleteAccount,
  waiterDeletedAccount,
  createKitchenAccount,
  kitchenOwnerProfile,
  updateKitchenOwnerProfile,
  kitchenDeleteAccount,
  kitchenDeletedAccount,
  adminUserContactDetail,
  exportCollectionAuthRole,
  exportCollectionCityzenRole,
  exportRawCollectionAuthRole,
  exportCollectionCustomerDeletedAccounts,
  exportCollectionRawCustomerDeletedAccounts,
  exportCollectionRestaurantDeletedAccounts,
  exportCollectionRawRestaurantDeletedAccounts,
  exportCollectionDeliverymanDeletedAccounts,
  exportCollectionRawDeliverymanDeletedAccounts,
  exportCollectionWaiterDeletedAccounts,
  exportCollectionRawWaiterDeletedAccounts,
  exportCollectionKitchenOwnerDeletedAccounts,
  exportCollectionRawKitchenOwnerDeletedAccounts,
  exportCustomerCollection,
  exportRawCustomerCollection,
  exportCustomerFundCollection,
  exportRawCustomerFundCollection,
  exportCustomerReportCollection,
  importCollection,
  importAuthRolesCollection,
  updateUserLocale,
};

