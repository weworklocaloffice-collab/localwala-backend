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
const { WithdrawalRequest, Restaurant, Wallet, User, Transactions } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createRestaurantWithdrawalRequest = async (param) => {
  const requestData = new WithdrawalRequest({
    from: 'restaurant',
    restaurant: param.restaurant,
    restaurantPayoutMethod: param.restaurantPayoutMethod,
    withdrawalMethod: param.withdrawalMethod,
    amount: param.amount,
  });
  await WithdrawalRequest.create(requestData);
  return { success: true };
};

const createDeliverymanWithdrawalRequest = async (param) => {
  const requestData = new WithdrawalRequest({
    from: 'deliveryman',
    deliveryman: param.deliveryman,
    deliverymanPayoutMethod: param.deliverymanPayoutMethod,
    withdrawalMethod: param.withdrawalMethod,
    amount: param.amount,
  });
  await WithdrawalRequest.create(requestData);
  return { success: true };
};

const getRestaurantWithdrawalRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  let whereQuery = null;
  const status = options.status ? options.status : 'all';
  if (status === 'all') {
    whereQuery = [{ from: 'restaurant', status: { $ne: 'all' } }];
  } else if (status === 'approved') {
    whereQuery = [{ from: 'restaurant', status: 'accepted' }];
  } else if (status === 'rejected') {
    whereQuery = [{ from: 'restaurant', status: 'rejected' }];
  } else if (status === 'pending') {
    whereQuery = [{ from: 'restaurant', status: 'created' }];
  }
  const orderMatch = {
    $or: [
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: whereQuery.filter(Boolean),
  };
  const methodQuery = [
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await WithdrawalRequest.aggregate(methodQuery);
  const countResult = await WithdrawalRequest.aggregate([
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
      $match: orderMatch,
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

const cityzenRestaurantWithdrawal = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  let whereQuery = null;
  const status = options.status ? options.status : 'all';
  if (status === 'all') {
    whereQuery = [
      {
        from: 'restaurant',
        status: { $ne: 'all' },
        'restaurants.city': new mongoose.Types.ObjectId(city),
      },
    ];
  } else if (status === 'approved') {
    whereQuery = [
      {
        from: 'restaurant',
        status: 'accepted',
        'restaurants.city': new mongoose.Types.ObjectId(city),
      },
    ];
  } else if (status === 'rejected') {
    whereQuery = [
      {
        from: 'restaurant',
        status: 'rejected',
        'restaurants.city': new mongoose.Types.ObjectId(city),
      },
    ];
  } else if (status === 'pending') {
    whereQuery = [
      {
        from: 'restaurant',
        status: 'created',
        'restaurants.city': new mongoose.Types.ObjectId(city),
      },
    ];
  }
  const orderMatch = {
    $or: [
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: whereQuery.filter(Boolean),
  };
  const methodQuery = [
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
      $match: orderMatch,
    },
    { $skip: skip },
    { $limit: Number(limit) },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await WithdrawalRequest.aggregate(methodQuery);
  const countResult = await WithdrawalRequest.aggregate([
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
      $match: orderMatch,
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

const getDeliverymanWithdrawalRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  let whereQuery = null;
  const status = options.status ? options.status : 'all';
  if (status === 'all') {
    whereQuery = [{ from: 'deliveryman', status: { $ne: 'all' } }];
  } else if (status === 'approved') {
    whereQuery = [{ from: 'deliveryman', status: 'accepted' }];
  } else if (status === 'rejected') {
    whereQuery = [{ from: 'deliveryman', status: 'rejected' }];
  } else if (status === 'pending') {
    whereQuery = [{ from: 'deliveryman', status: 'created' }];
  }
  const orderMatch = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: whereQuery.filter(Boolean),
  };
  const methodQuery = [
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
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
          {
            $addFields: {
              contactEmail: {
                $concat: [
                  { $substrCP: ['$email', 0, 2] },
                  'XXXXX@',
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
        deliveryman: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const results = await WithdrawalRequest.aggregate(methodQuery);
  const countResult = await WithdrawalRequest.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
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
      $match: orderMatch,
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

const cityzenDeliverymanWithdrawalRequest = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  let whereQuery = null;
  const status = options.status ? options.status : 'all';
  if (status === 'all') {
    whereQuery = [
      {
        from: 'deliveryman',
        status: { $ne: 'all' },
        'users.city': new mongoose.Types.ObjectId(city),
      },
    ];
  } else if (status === 'approved') {
    whereQuery = [
      { from: 'deliveryman', status: 'accepted', 'users.city': new mongoose.Types.ObjectId(city) },
    ];
  } else if (status === 'rejected') {
    whereQuery = [
      { from: 'deliveryman', status: 'rejected', 'users.city': new mongoose.Types.ObjectId(city) },
    ];
  } else if (status === 'pending') {
    whereQuery = [
      { from: 'deliveryman', status: 'created', 'users.city': new mongoose.Types.ObjectId(city) },
    ];
  }
  const orderMatch = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: whereQuery.filter(Boolean),
  };
  const methodQuery = [
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
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
          {
            $addFields: {
              contactEmail: {
                $concat: [
                  { $substrCP: ['$email', 0, 2] },
                  'XXXXX@',
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: orderMatch,
    },
    { $skip: skip },
    { $limit: Number(limit) },
    { $sort: { createdAt: -1 } },

    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
        deliveryman: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const results = await WithdrawalRequest.aggregate(methodQuery);
  const countResult = await WithdrawalRequest.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
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
      $match: orderMatch,
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

const withdrawalRequestDetail = async (id) => {
  const detailQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
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
        from: 'restaurantpayoutmethods',
        localField: 'restaurantPayoutMethod',
        foreignField: '_id',
        as: 'restaurantpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'deliverymanPayoutMethod',
        foreignField: '_id',
        as: 'deliverymanpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'withdrawalMethod',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
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
          {
            $addFields: {
              contactEmail: {
                $concat: [
                  { $substrCP: ['$email', 0, 2] },
                  'XXXXX@',
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
        path: '$users',
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
      $unwind: {
        path: '$restaurantpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$deliverymanpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        from: 1,
        restaurant: 1,
        deliveryman: 1,
        rejectedBy: 1,
        rejectedReason: 1,
        approvedNotes: 1,
        proof: 1,
        formElement: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
        restaurantInfo: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          isOutlet: { $ifNull: ['$restaurants.isOutlet', false] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
        deliverymanPayoutMethodDetail: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          image: { $ifNull: ['$withdrawalmethods.image', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        deliverymanInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const detailInfo = await WithdrawalRequest.aggregate(detailQuery);
  if (!detailInfo[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not Found');
  }
  const detail = detailInfo[0];
  let walletDetail = null;
  let restaurantOwner = null;
  if (detail !== null && detail.from === 'restaurant') {
    const restaurantInfo = await Restaurant.findById(detail.restaurant, { userId: 1 });
    if (restaurantInfo !== null && restaurantInfo.userId !== null) {
      walletDetail = await Wallet.findOne(
        { holderId: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
      );
      restaurantOwner = await User.findById(restaurantInfo.userId, {
        firstName: 1,
        lastName: 1,
        mobile: 1,
        countryCode: 1,
        role: 1,
        image: 1,
        email: 1,
      });
      if (
        restaurantOwner !== null &&
        restaurantOwner.firstName !== null &&
        restaurantOwner.mobile !== null &&
        restaurantOwner.mobile !== ''
      ) {
        const maskedNumber = `${restaurantOwner.mobile.substring(0, 3)}XXXXXX${restaurantOwner.mobile.substring(
          restaurantOwner.mobile.length - 3
        )}`;
        restaurantOwner.mobile = maskedNumber;
      }

      if (
        restaurantOwner !== null &&
        restaurantOwner.firstName !== null &&
        restaurantOwner.email !== null &&
        restaurantOwner.email !== ''
      ) {
        const [localPart, domainPart] = restaurantOwner.email.split('@');
        const firstTwoChars = localPart.slice(0, 2);

        const maskedEmail = `${firstTwoChars}XXXXX@${domainPart}`;
        restaurantOwner.email = maskedEmail;
      }
    }
  } else if (detail !== null && detail.from === 'deliveryman') {
    if (detail !== null && detail.deliveryman !== null) {
      walletDetail = await Wallet.findOne(
        { holderId: new mongoose.Types.ObjectId(detail.deliveryman) },
        { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
      );
    }
  }
  return Promise.all([detail, walletDetail, restaurantOwner]).then(() => {
    const result = {
      detail,
      walletDetail,
      restaurantOwner,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const declineWithdrawalRequest = async (id, reason) => {
  const detailQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id), status: 'created' } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurantPayoutMethod',
        foreignField: '_id',
        as: 'restaurantpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'deliverymanPayoutMethod',
        foreignField: '_id',
        as: 'deliverymanpayoutmethods',
      },
    },
    {
      $unwind: {
        path: '$restaurantpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$deliverymanpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        from: 1,
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
        deliverymanPayoutMethod: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
      },
    },
  ];
  const detailInfo = await WithdrawalRequest.aggregate(detailQuery);
  if (!detailInfo[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not Found');
  }
  const requestDetail = detailInfo[0];
  let credential = [];
  if (
    requestDetail !== null &&
    requestDetail.from === 'restaurant' &&
    requestDetail.restaurantPayoutMethodDetail &&
    requestDetail.restaurantPayoutMethodDetail.credential
  ) {
    credential = requestDetail.restaurantPayoutMethodDetail.credential;
  }

  if (
    requestDetail !== null &&
    requestDetail.from === 'deliveryman' &&
    requestDetail.deliverymanPayoutMethod &&
    requestDetail.deliverymanPayoutMethod.credential
  ) {
    credential = requestDetail.deliverymanPayoutMethod.credential;
  }
  const detail = await WithdrawalRequest.findById(id);
  if (!detail) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not Found');
  }
  const declineBody = {
    status: 'rejected',
    rejectedBy: 'admin',
    formElement: credential,
    rejectedReason: reason,
  };
  Object.assign(detail, declineBody);
  await detail.save();
  return { success: true };
};

const approveWithdrawalRequest = async (id, notes, proof) => {
  const detailQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id), status: 'created' } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurantPayoutMethod',
        foreignField: '_id',
        as: 'restaurantpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'deliverymanPayoutMethod',
        foreignField: '_id',
        as: 'deliverymanpayoutmethods',
      },
    },
    {
      $unwind: {
        path: '$restaurantpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$deliverymanpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        from: 1,
        restaurant: 1,
        deliveryman: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
        deliverymanPayoutMethodDetail: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
      },
    },
  ];
  const detailInfo = await WithdrawalRequest.aggregate(detailQuery);
  if (!detailInfo[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not Found');
  }
  const requestDetail = detailInfo[0];
  let credential = [];
  let walletDetail = null;
  let payableId = null;
  if (
    requestDetail !== null &&
    requestDetail.restaurantPayoutMethodDetail &&
    requestDetail.restaurantPayoutMethodDetail.credential
  ) {
    credential = requestDetail.restaurantPayoutMethodDetail.credential;
  }

  if (
    requestDetail !== null &&
    requestDetail.from !== null &&
    requestDetail.from === 'deliveryman' &&
    requestDetail.deliverymanPayoutMethodDetail &&
    requestDetail.deliverymanPayoutMethodDetail.credential
  ) {
    credential = requestDetail.deliverymanPayoutMethodDetail.credential;
  }
  if (requestDetail !== null && requestDetail.from === 'restaurant') {
    const restaurantInfo = await Restaurant.findById(requestDetail.restaurant, { userId: 1 });
    if (restaurantInfo !== null && restaurantInfo.userId !== null) {
      payableId = restaurantInfo.userId;
      walletDetail = await Wallet.findOne(
        { holderId: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
      );
    }
  } else if (
    requestDetail !== null &&
    requestDetail.from === 'deliveryman' &&
    requestDetail.deliveryman !== null
  ) {
    payableId = requestDetail.deliveryman;
    walletDetail = await Wallet.findOne(
      { holderId: new mongoose.Types.ObjectId(requestDetail.deliveryman) },
      { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
    );
  }
  const detail = await WithdrawalRequest.findById(id);
  if (!detail) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not Found');
  }
  if (!walletDetail) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unable to find wallet');
  }
  const walletBalance = parseFloat(walletDetail.balance);
  const withdrawalAmount = parseFloat(requestDetail.amount);
  const updateBalance = walletBalance - withdrawalAmount;
  let isValidAmount = false;
  if (updateBalance >= 0) {
    isValidAmount = true;
  }
  if (isValidAmount === false) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Insufficient funds: Withdrawal amount exceeds your available balance'
    );
  }
  const userWalletId = walletDetail.id;
  Object.assign(walletDetail, { balance: updateBalance });
  await walletDetail.save();
  const transactionBody = {
    payableId: `${payableId}`,
    walletId: userWalletId,
    type: 'withdrawal',
    amount: withdrawalAmount,
    confirmed: true,
    meta: [
      { reason: `Withdrawal request approved ${id}` },
      { reason: proof },
      { reason: new Date() },
    ],
    status: true,
  };
  await Transactions.create(transactionBody);
  const approveBody = {
    status: 'accepted',
    rejectedBy: 'admin',
    formElement: credential,
    approvedNotes: notes,
    proof: `${proof}`,
  };
  Object.assign(detail, approveBody);
  await detail.save();
  return { success: true };
};

const restaurantWithdrawalHistory = async (vendor, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const methodQuery = [
    {
      $match: {
        from: 'restaurant',
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'withdrawalMethod',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurantPayoutMethod',
        foreignField: '_id',
        as: 'restaurantpayoutmethods',
      },
    },
    {
      $unwind: {
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurantpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        rejectedBy: 1,
        rejectedReason: 1,
        proof: 1,
        approvedNotes: 1,
        formElement: 1,
        createdAt: 1,
        status: 1,
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
      },
    },
  ];
  const results = await WithdrawalRequest.aggregate(methodQuery);
  const totalResults = await WithdrawalRequest.countDocuments({
    from: 'restaurant',
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  const createdRequest = await WithdrawalRequest.countDocuments({
    from: 'restaurant',
    restaurant: new mongoose.Types.ObjectId(vendor),
    status: 'created',
  });
  const acceptedRequest = await WithdrawalRequest.countDocuments({
    from: 'restaurant',
    restaurant: new mongoose.Types.ObjectId(vendor),
    status: 'accepted',
  });
  const rejectedRequest = await WithdrawalRequest.countDocuments({
    from: 'restaurant',
    restaurant: new mongoose.Types.ObjectId(vendor),
    status: 'rejected',
  });
  return Promise.all([
    results,
    totalResults,
    createdRequest,
    acceptedRequest,
    rejectedRequest,
  ]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      createdRequest,
      acceptedRequest,
      rejectedRequest,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanWithdrawalHistory = async (deliveryman, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const methodQuery = [
    {
      $match: {
        from: 'deliveryman',
        deliveryman: new mongoose.Types.ObjectId(deliveryman),
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'withdrawalMethod',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'deliverymanPayoutMethod',
        foreignField: '_id',
        as: 'deliverymanpayoutmethods',
      },
    },
    {
      $unwind: {
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$deliverymanpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        rejectedBy: 1,
        rejectedReason: 1,
        proof: 1,
        approvedNotes: 1,
        formElement: 1,
        createdAt: 1,
        status: 1,
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        deliverymanPayoutMethod: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
      },
    },
  ];
  const results = await WithdrawalRequest.aggregate(methodQuery);
  const totalResults = await WithdrawalRequest.countDocuments({
    from: 'deliveryman',
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
  });
  const createdRequest = await WithdrawalRequest.countDocuments({
    from: 'deliveryman',
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
    status: 'created',
  });
  const acceptedRequest = await WithdrawalRequest.countDocuments({
    from: 'deliveryman',
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
    status: 'accepted',
  });
  const rejectedRequest = await WithdrawalRequest.countDocuments({
    from: 'deliveryman',
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
    status: 'rejected',
  });
  return Promise.all([
    results,
    totalResults,
    createdRequest,
    acceptedRequest,
    rejectedRequest,
  ]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      createdRequest,
      acceptedRequest,
      rejectedRequest,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorWithdrawalRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const methodQuery = [
    { $match: queryCondition },
    { $skip: skip },
    { $limit: Number(limit) },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const results = await WithdrawalRequest.aggregate(methodQuery);
  const totalResults = await WithdrawalRequest.countDocuments(queryCondition);
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

const deliverymanWithdrawalRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { deliveryman: new mongoose.Types.ObjectId(options.deliveryman) };
  const methodQuery = [
    { $match: queryCondition },
    { $skip: skip },
    { $limit: Number(limit) },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const results = await WithdrawalRequest.aggregate(methodQuery);
  const totalResults = await WithdrawalRequest.countDocuments(queryCondition);
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

const exportRestaurantRequestCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  let whereQuery = null;
  if (statusName === 'all') {
    whereQuery = [{ from: 'restaurant', status: { $ne: 'all' } }];
  } else if (statusName === 'approved') {
    whereQuery = [{ from: 'restaurant', status: 'accepted' }];
  } else if (statusName === 'rejected') {
    whereQuery = [{ from: 'restaurant', status: 'rejected' }];
  } else if (statusName === 'pending') {
    whereQuery = [{ from: 'restaurant', status: 'created' }];
  }
  const orderMatch = {
    $or: [
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: whereQuery.filter(Boolean),
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
        from: 'withdrawalmethods',
        localField: 'withdrawalMethod',
        foreignField: '_id',
        as: 'withdrawalmethods',
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
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        withdrawalMethod: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
        },
        restaurantPayoutMethod: 1,
        rejectedReason: 1,
        approvedNotes: 1,
        proof: 1,
      },
    },
  ];
  const result = await WithdrawalRequest.aggregate(query);
  return result;
};

const exportRawRestaurantRequestCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  let whereQuery = null;
  if (statusName === 'all') {
    whereQuery = [{ from: 'restaurant', status: { $ne: 'all' } }];
  } else if (statusName === 'approved') {
    whereQuery = [{ from: 'restaurant', status: 'accepted' }];
  } else if (statusName === 'rejected') {
    whereQuery = [{ from: 'restaurant', status: 'rejected' }];
  } else if (statusName === 'pending') {
    whereQuery = [{ from: 'restaurant', status: 'created' }];
  }
  const orderMatch = {
    $or: [
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: whereQuery.filter(Boolean),
  };
  const results = await WithdrawalRequest.aggregate([
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
      $match: orderMatch,
    },
    {
      $project: {
        restaurants: 0,
      },
    },
  ]);
  return results;
};

const exportDeliverymanRequestCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  let whereQuery = null;
  if (statusName === 'all') {
    whereQuery = [{ from: 'deliveryman', status: { $ne: 'all' } }];
  } else if (statusName === 'approved') {
    whereQuery = [{ from: 'deliveryman', status: 'accepted' }];
  } else if (statusName === 'rejected') {
    whereQuery = [{ from: 'deliveryman', status: 'rejected' }];
  } else if (statusName === 'pending') {
    whereQuery = [{ from: 'deliveryman', status: 'created' }];
  }
  const orderMatch = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: whereQuery.filter(Boolean),
  };
  const query = [
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'withdrawalMethod',
        foreignField: '_id',
        as: 'withdrawalmethods',
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
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
        status: 1,
        deliveryman: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        withdrawalMethod: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
        },
        deliverymanPayoutMethod: 1,
        rejectedReason: 1,
        approvedNotes: 1,
        proof: 1,
      },
    },
  ];
  const result = await WithdrawalRequest.aggregate(query);
  return result;
};

const exportRawDeliverymanRequestCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  let whereQuery = null;
  if (statusName === 'all') {
    whereQuery = [{ from: 'deliveryman', status: { $ne: 'all' } }];
  } else if (statusName === 'approved') {
    whereQuery = [{ from: 'deliveryman', status: 'accepted' }];
  } else if (statusName === 'rejected') {
    whereQuery = [{ from: 'deliveryman', status: 'rejected' }];
  } else if (statusName === 'pending') {
    whereQuery = [{ from: 'deliveryman', status: 'created' }];
  }
  const orderMatch = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: whereQuery.filter(Boolean),
  };
  const query = [
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
      },
    },
  ];
  const result = await WithdrawalRequest.aggregate(query);
  return result;
};

module.exports = {
  createRestaurantWithdrawalRequest,
  createDeliverymanWithdrawalRequest,
  getRestaurantWithdrawalRequest,
  getDeliverymanWithdrawalRequest,
  withdrawalRequestDetail,
  declineWithdrawalRequest,
  approveWithdrawalRequest,
  restaurantWithdrawalHistory,
  deliverymanWithdrawalHistory,
  vendorWithdrawalRequest,
  deliverymanWithdrawalRequest,
  cityzenRestaurantWithdrawal,
  cityzenDeliverymanWithdrawalRequest,
  exportRestaurantRequestCollection,
  exportRawRestaurantRequestCollection,
  exportDeliverymanRequestCollection,
  exportRawDeliverymanRequestCollection,
};

