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
  Disbursement,
  DisbursementData,
  RestaurantDisbursement,
  DeliverymanDisbursement,
  Wallet,
  WithdrawalRequest,
  Transactions,
  User,
} = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createDisbursement = async (param) => {
  if ((await Disbursement.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const disbursementData = new Disbursement({
    type: param.type,
    restaurant: param.restaurant,
    driver: param.driver,
  });
  const details = await Disbursement.create(disbursementData);
  return { id: details.id, success: true };
};

const getDisbursement = async () => {
  const disbursement = await Disbursement.findOne();
  return disbursement;
};

const getDisbursementId = async (id) => {
  return Disbursement.findById(id);
};

const updateDisbursement = async (disbursementId, param) => {
  const disbursement = await getDisbursementId(disbursementId);
  if (!disbursement) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const disbursementData = {
    type: param.type,
    restaurant: param.restaurant,
    driver: param.driver,
  };

  Object.assign(disbursement, disbursementData);
  await disbursement.save();
  return { success: true };
};

const restaurantDisbursement = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const matchQuery = {
    $match: {
      disbursementType: 'restaurant',
      status:
        options && options.status && options.status !== null && options.status !== 'all'
          ? options.status
          : { $ne: null },
    },
  };

  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementNo: 1,
        totalAmount: {
          $round: [{ $divide: ['$totalAmount', 100] }, 2],
        },
        generatedTime: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await DisbursementData.aggregate(query);
  const resultCount = await DisbursementData.aggregate(countQuery);
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

const deliverymanDisbursement = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const matchQuery = {
    $match: {
      disbursementType: 'deliveryman',
      status:
        options && options.status && options.status !== null && options.status !== 'all'
          ? options.status
          : { $ne: null },
    },
  };

  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementNo: 1,
        totalAmount: {
          $round: [{ $divide: ['$totalAmount', 100] }, 2],
        },
        generatedTime: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await DisbursementData.aggregate(query);
  const resultCount = await DisbursementData.aggregate(countQuery);
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

const restaurantDisbursementReport = async (disbursementId) => {
  const disbursementInfo = await DisbursementData.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(disbursementId),
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementNo: 1,
        totalAmount: {
          $round: [{ $divide: ['$totalAmount', 100] }, 2],
        },
        generatedTime: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ]);
  if (!checkArrayNotEmpty(disbursementInfo)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const query = [
    {
      $match: {
        disbursementId: new mongoose.Types.ObjectId(disbursementId),
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
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await RestaurantDisbursement.aggregate(query);
  const disbursement = disbursementInfo[0];
  return Promise.all([results, disbursementInfo]).then(() => {
    const result = {
      disbursement,
      results,
    };
    return Promise.resolve(result);
  });
};

const deliverymanDisbursementReport = async (disbursementId) => {
  const disbursementInfo = await DisbursementData.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(disbursementId),
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementNo: 1,
        totalAmount: {
          $round: [{ $divide: ['$totalAmount', 100] }, 2],
        },
        generatedTime: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ]);
  if (!checkArrayNotEmpty(disbursementInfo)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const query = [
    {
      $match: {
        disbursementId: new mongoose.Types.ObjectId(disbursementId),
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
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
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
      $unwind: {
        path: '$deliverymanpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        deliverymanPayoutMethodDetail: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await DeliverymanDisbursement.aggregate(query);
  const disbursement = disbursementInfo[0];
  return Promise.all([results, disbursementInfo]).then(() => {
    const result = {
      results,
      disbursement,
    };
    return Promise.resolve(result);
  });
};

const restaurantDisbursementDetail = async (disbursementId) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(disbursementId) } },
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
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'restaurants.userId',
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
        from: 'withdrawalmethods',
        localField: 'defaultPayoutMethod.method',
        foreignField: '_id',
        as: 'defaultPayoutMethodDetail',
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethod',
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
        path: '$defaultPayoutMethodDetail',
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
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        defaultPayoutMethodDetailInfo: {
          id: { $ifNull: ['$defaultPayoutMethodDetail._id', ''] },
          name: { $ifNull: ['$defaultPayoutMethodDetail.name', ''] },
          translations: { $ifNull: ['$defaultPayoutMethodDetail.translations', []] },
        },
        ownerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await RestaurantDisbursement.aggregate(query);
  if (!result[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = result[0];
  return { detail, success: true };
};

const deliverymanDisbursementDetail = async (disbursementId) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(disbursementId) } },
    { $limit: 1 },
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
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'defaultPayoutMethod.method',
        foreignField: '_id',
        as: 'defaultPayoutMethodDetail',
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
      $unwind: {
        path: '$deliverymanpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethodDetail',
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
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        deliverymanPayoutMethodDetail: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        defaultPayoutMethodDetailInfo: {
          id: { $ifNull: ['$defaultPayoutMethodDetail._id', ''] },
          name: { $ifNull: ['$defaultPayoutMethodDetail.name', ''] },
          translations: { $ifNull: ['$defaultPayoutMethodDetail.translations', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DeliverymanDisbursement.aggregate(query);
  if (!result[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = result[0];
  return { detail, success: true };
};

const updateDisbursementStatus = async (disbursementId, statusName) => {
  const mainDisbursement = await DisbursementData.findById(disbursementId);
  if (mainDisbursement) {
    const mainDisbursementParam = {
      status: statusName,
    };
    Object.assign(mainDisbursement, mainDisbursementParam);
    await mainDisbursement.save();
  }
};

const rejectRestaurantDisburment = async (disbursementId) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(disbursementId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'defaultPayoutMethod.method',
        foreignField: '_id',
        as: 'defaultPayoutMethodDetail',
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethodDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementId: 1,
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
        },
        defaultPayoutMethodDetailInfo: {
          id: { $ifNull: ['$defaultPayoutMethodDetail._id', ''] },
          name: { $ifNull: ['$defaultPayoutMethodDetail.name', ''] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await RestaurantDisbursement.aggregate(query);
  if (!result[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = result[0];
  const mainDisbursementId = detail.disbursementId;
  const withdrawalMethod = detail.defaultPayoutMethodDetailInfo.id;
  const restaurantPayoutMethod = detail.defaultPayoutMethodDetail.id;
  const disbursementData = await RestaurantDisbursement.findById(disbursementId);
  if (!disbursementData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const disbursemenParam = {
    restaurantPayoutMethod: `${restaurantPayoutMethod}`,
    withdrawalMethod: `${withdrawalMethod}`,
    status: 'rejected',
  };

  Object.assign(disbursementData, disbursemenParam);
  await disbursementData.save();
  const statuses = await RestaurantDisbursement.find({
    disbursementId: new mongoose.Types.ObjectId(mainDisbursementId),
  }).select('status');
  const allStatuses = statuses.map((item) => item.status);
  let newStatus = '';
  if (allStatuses.every((status) => status === 'accepted')) {
    newStatus = 'completed';
  } else if (allStatuses.every((status) => status === 'rejected')) {
    newStatus = 'cancelled';
  } else if (allStatuses.includes('accepted')) {
    newStatus = 'partially_completed';
  } else {
    newStatus = 'pending';
  }
  updateDisbursementStatus(mainDisbursementId, newStatus);
  return { success: true };
};

const acceptRestaurantDisburment = async (disbursementId) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(disbursementId) } },
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
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'defaultPayoutMethod.method',
        foreignField: '_id',
        as: 'defaultPayoutMethodDetail',
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
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethodDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementId: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          userId: { $ifNull: ['$restaurants.userId', ''] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        defaultPayoutMethodDetailInfo: {
          id: { $ifNull: ['$defaultPayoutMethodDetail._id', ''] },
          name: { $ifNull: ['$defaultPayoutMethodDetail.name', ''] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await RestaurantDisbursement.aggregate(query);
  if (!result[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = result[0];
  const { userId } = detail.restaurant;
  const restaurantId = detail.restaurant.id;
  const walletDetail = await Wallet.findOne(
    { holderId: new mongoose.Types.ObjectId(userId) },
    { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
  );
  if (!walletDetail) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unable to find wallet');
  }
  const walletBalance = parseFloat(walletDetail.balance);
  const withdrawalAmount = parseFloat(detail.amount);
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
  const mainDisbursementId = detail.disbursementId;
  const withdrawalMethod = detail.defaultPayoutMethodDetailInfo.id;
  const restaurantPayoutMethod = detail.defaultPayoutMethodDetail.id;
  const disbursementData = await RestaurantDisbursement.findById(disbursementId);
  if (!disbursementData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const disbursemenParam = {
    restaurantPayoutMethod: `${restaurantPayoutMethod}`,
    withdrawalMethod: `${withdrawalMethod}`,
    status: 'accepted',
  };

  Object.assign(disbursementData, disbursemenParam);
  await disbursementData.save();
  const statuses = await RestaurantDisbursement.find({
    disbursementId: new mongoose.Types.ObjectId(mainDisbursementId),
  }).select('status');
  const allStatuses = statuses.map((item) => item.status);
  let newStatus = '';
  if (allStatuses.every((status) => status === 'accepted')) {
    newStatus = 'completed';
  } else if (allStatuses.every((status) => status === 'rejected')) {
    newStatus = 'cancelled';
  } else if (allStatuses.includes('accepted')) {
    newStatus = 'partially_completed';
  } else {
    newStatus = 'pending';
  }
  updateDisbursementStatus(mainDisbursementId, newStatus);
  const payableId = userId;
  let credential = [];

  if (
    detail !== null &&
    detail.defaultPayoutMethodDetail &&
    detail.defaultPayoutMethodDetail.credential
  ) {
    credential = detail.defaultPayoutMethodDetail.credential;
  }
  const addWithdrawalData = new WithdrawalRequest({
    from: 'restaurant',
    restaurant: restaurantId,
    restaurantPayoutMethod: `${restaurantPayoutMethod}`,
    withdrawalMethod: `${withdrawalMethod}`,
    amount: detail.amount,
    approvedNotes: `Disburments ${mainDisbursementId}`,
    status: 'accepted',
    formElement: credential,
  });
  await WithdrawalRequest.create(addWithdrawalData);
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
      { reason: `Withdrawal request approved Disburments ${mainDisbursementId}` },
      { reason: `Disburments ${mainDisbursementId}` },
      { reason: new Date() },
    ],
    status: true,
  };
  await Transactions.create(transactionBody);
  return {
    success: true,
  };
};

const rejectDeliverymanDisbursment = async (disbursementId) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(disbursementId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'defaultPayoutMethod.method',
        foreignField: '_id',
        as: 'defaultPayoutMethodDetail',
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethodDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementId: 1,
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
        },
        defaultPayoutMethodDetailInfo: {
          id: { $ifNull: ['$defaultPayoutMethodDetail._id', ''] },
          name: { $ifNull: ['$defaultPayoutMethodDetail.name', ''] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DeliverymanDisbursement.aggregate(query);
  if (!result[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = result[0];
  const mainDisbursementId = detail.disbursementId;
  const withdrawalMethod = detail.defaultPayoutMethodDetailInfo.id;
  const deliverymanPayoutMethod = detail.defaultPayoutMethodDetail.id;
  const disbursementData = await DeliverymanDisbursement.findById(disbursementId);
  if (!disbursementData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const disbursemenParam = {
    deliverymanPayoutMethod: `${deliverymanPayoutMethod}`,
    withdrawalMethod: `${withdrawalMethod}`,
    status: 'rejected',
  };
  Object.assign(disbursementData, disbursemenParam);
  await disbursementData.save();
  const statuses = await DeliverymanDisbursement.find({
    disbursementId: new mongoose.Types.ObjectId(mainDisbursementId),
  }).select('status');
  const allStatuses = statuses.map((item) => item.status);
  let newStatus = '';
  if (allStatuses.every((status) => status === 'accepted')) {
    newStatus = 'completed';
  } else if (allStatuses.every((status) => status === 'rejected')) {
    newStatus = 'cancelled';
  } else if (allStatuses.includes('accepted')) {
    newStatus = 'partially_completed';
  } else {
    newStatus = 'pending';
  }
  updateDisbursementStatus(mainDisbursementId, newStatus);
  return { success: true };
};

const acceptDeliverymanDisbursment = async (disbursementId) => {
  const query = [
    { $match: { _id: new mongoose.Types.ObjectId(disbursementId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'defaultPayoutMethod.method',
        foreignField: '_id',
        as: 'defaultPayoutMethodDetail',
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethodDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementId: 1,
        userId: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        defaultPayoutMethodDetailInfo: {
          id: { $ifNull: ['$defaultPayoutMethodDetail._id', ''] },
          name: { $ifNull: ['$defaultPayoutMethodDetail.name', ''] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DeliverymanDisbursement.aggregate(query);
  if (!result[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const detail = result[0];
  const { userId } = detail;
  const walletDetail = await Wallet.findOne(
    { holderId: new mongoose.Types.ObjectId(userId) },
    { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
  );
  if (!walletDetail) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unable to find wallet');
  }
  const walletBalance = parseFloat(walletDetail.balance);
  const withdrawalAmount = parseFloat(detail.amount);
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
  const mainDisbursementId = detail.disbursementId;
  const withdrawalMethod = detail.defaultPayoutMethodDetailInfo.id;
  const deliverymanPayoutMethod = detail.defaultPayoutMethodDetail.id;
  const disbursementData = await DeliverymanDisbursement.findById(disbursementId);
  if (!disbursementData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const disbursemenParam = {
    deliverymanPayoutMethod: `${deliverymanPayoutMethod}`,
    withdrawalMethod: `${withdrawalMethod}`,
    status: 'accepted',
  };

  Object.assign(disbursementData, disbursemenParam);
  await disbursementData.save();

  const statuses = await DeliverymanDisbursement.find({
    disbursementId: new mongoose.Types.ObjectId(mainDisbursementId),
  }).select('status');
  const allStatuses = statuses.map((item) => item.status);
  let newStatus = '';
  if (allStatuses.every((status) => status === 'accepted')) {
    newStatus = 'completed';
  } else if (allStatuses.every((status) => status === 'rejected')) {
    newStatus = 'cancelled';
  } else if (allStatuses.includes('accepted')) {
    newStatus = 'partially_completed';
  } else {
    newStatus = 'pending';
  }
  updateDisbursementStatus(mainDisbursementId, newStatus);

  const payableId = userId;

  let credential = [];

  if (
    detail !== null &&
    detail.defaultPayoutMethodDetail &&
    detail.defaultPayoutMethodDetail.credential
  ) {
    credential = detail.defaultPayoutMethodDetail.credential;
  }

  const addWithdrawalData = new WithdrawalRequest({
    from: 'deliveryman',
    deliveryman: userId,
    deliverymanPayoutMethod: `${deliverymanPayoutMethod}`,
    withdrawalMethod: `${withdrawalMethod}`,
    amount: detail.amount,
    approvedNotes: `Disburments ${mainDisbursementId}`,
    status: 'accepted',
    formElement: credential,
  });
  await WithdrawalRequest.create(addWithdrawalData);
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
      { reason: `Withdrawal request approved Disburments ${mainDisbursementId}` },
      { reason: `Disburments ${mainDisbursementId}` },
      { reason: new Date() },
    ],
    status: true,
  };
  await Transactions.create(transactionBody);
  return { success: true };
};

const restaurantDisbursementAmounts = async () => {
  const pendingCount = await RestaurantDisbursement.aggregate([
    {
      $match: {
        status: 'created',
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);
  const approvedCount = await RestaurantDisbursement.aggregate([
    {
      $match: {
        status: 'accepted',
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);
  const cancelledCount = await RestaurantDisbursement.aggregate([
    {
      $match: {
        status: 'rejected',
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);
  return Promise.all([pendingCount, approvedCount, cancelledCount]).then(() => {
    const pending = {
      amount: 0,
      count: 0,
    };
    const approved = {
      amount: 0,
      count: 0,
    };

    const cancelled = {
      amount: 0,
      count: 0,
    };
    if (checkArrayNotEmpty(pendingCount)) {
      pending.count = pendingCount[0].count;
      pending.amount = pendingCount[0].amount;
    }
    if (checkArrayNotEmpty(approvedCount)) {
      approved.count = approvedCount[0].count;
      approved.amount = approvedCount[0].amount;
    }
    if (checkArrayNotEmpty(cancelledCount)) {
      cancelled.count = cancelledCount[0].count;
      cancelled.amount = cancelledCount[0].amount;
    }
    const result = {
      pending,
      approved,
      cancelled,
    };
    return Promise.resolve(result);
  });
};

const restaurantDisbursementTransactionReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: {
      restaurant:
        filter &&
        options &&
        options.restaurant &&
        options.restaurant !== null &&
        options.restaurant !== ''
          ? new mongoose.Types.ObjectId(options.restaurant)
          : { $ne: null },
      status:
        filter && options && options.status && options.status !== null && options.status !== 'all'
          ? options.status
          : { $ne: null },
      withdrawalMethod:
        filter &&
        options &&
        options.payment &&
        options.payment !== null &&
        options.payment !== 'all'
          ? new mongoose.Types.ObjectId(options.payment)
          : { $ne: null },
    },
  };

  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

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

  const name = options.search;

  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'disbursementdatas',
        localField: 'disbursementId',
        foreignField: '_id',
        as: 'disbursementdatas',
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
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
      },
    },
    {
      $unwind: {
        path: '$disbursementdatas',
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
      $unwind: {
        path: '$restaurantpayoutmethods',
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
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'restaurants.name': RegExp(name, 'i') },
          { 'restaurants.slug': RegExp(name, 'i') },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: RegExp(name, 'i') },
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
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        disbursement: {
          id: { $ifNull: ['$disbursementdatas._id', ''] },
          disbursementNo: { $ifNull: ['$disbursementdatas.disbursementNo', 0] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const countQuery = [
    matchQuery,
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
      $match: {
        $or: [
          { 'restaurants.name': RegExp(name, 'i') },
          { 'restaurants.slug': RegExp(name, 'i') },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: RegExp(name, 'i') },
              },
            },
          },
        ],
      },
    },
    { $count: 'totalCount' },
  ];
  const results = await RestaurantDisbursement.aggregate(query);
  const resultCount = await RestaurantDisbursement.aggregate(countQuery);
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

const deliverymanDisbursementAmounts = async () => {
  const pendingCount = await DeliverymanDisbursement.aggregate([
    {
      $match: {
        status: 'created',
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);
  const approvedCount = await DeliverymanDisbursement.aggregate([
    {
      $match: {
        status: 'accepted',
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);
  const cancelledCount = await DeliverymanDisbursement.aggregate([
    {
      $match: {
        status: 'rejected',
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);
  return Promise.all([pendingCount, approvedCount, cancelledCount]).then(() => {
    const pending = {
      amount: 0,
      count: 0,
    };
    const approved = {
      amount: 0,
      count: 0,
    };

    const cancelled = {
      amount: 0,
      count: 0,
    };
    if (checkArrayNotEmpty(pendingCount)) {
      pending.count = pendingCount[0].count;
      pending.amount = pendingCount[0].amount;
    }
    if (checkArrayNotEmpty(approvedCount)) {
      approved.count = approvedCount[0].count;
      approved.amount = approvedCount[0].amount;
    }
    if (checkArrayNotEmpty(cancelledCount)) {
      cancelled.count = cancelledCount[0].count;
      cancelled.amount = cancelledCount[0].amount;
    }
    const result = {
      pending,
      approved,
      cancelled,
    };
    return Promise.resolve(result);
  });
};

const deliverymanDisbursementTransactionReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: {
      status:
        filter && options && options.status && options.status !== null && options.status !== 'all'
          ? options.status
          : { $ne: null },
      withdrawalMethod:
        filter &&
        options &&
        options.payment &&
        options.payment !== null &&
        options.payment !== 'all'
          ? new mongoose.Types.ObjectId(options.payment)
          : { $ne: null },
    },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

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
  const name = options.search;
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'disbursementdatas',
        localField: 'disbursementId',
        foreignField: '_id',
        as: 'disbursementdatas',
      },
    },
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
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'defaultPayoutMethod.method',
        foreignField: '_id',
        as: 'defaultPayoutMethodDetail',
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
      $unwind: {
        path: '$deliverymanpayoutmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$defaultPayoutMethodDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$disbursementdatas',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
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
        disbursement: {
          id: { $ifNull: ['$disbursementdatas._id', ''] },
          disbursementNo: { $ifNull: ['$disbursementdatas.disbursementNo', 0] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        deliverymanPayoutMethodDetail: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        defaultPayoutMethodDetailInfo: {
          id: { $ifNull: ['$defaultPayoutMethodDetail._id', ''] },
          name: { $ifNull: ['$defaultPayoutMethodDetail.name', ''] },
          translations: { $ifNull: ['$defaultPayoutMethodDetail.translations', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const countQuery = [
    matchQuery,
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
      $match: {
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $count: 'totalCount' },
  ];
  const results = await DeliverymanDisbursement.aggregate(query);
  const resultCount = await DeliverymanDisbursement.aggregate(countQuery);
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

const vendorDisbursementList = async (options) => {
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
        from: 'disbursementdatas',
        localField: 'disbursementId',
        foreignField: '_id',
        as: 'disbursementdatas',
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
        from: 'restaurantpayoutmethods',
        localField: 'restaurantPayoutMethod',
        foreignField: '_id',
        as: 'restaurantpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
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
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$disbursementdatas',
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
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        disbursement: {
          id: { $ifNull: ['$disbursementdatas._id', ''] },
          disbursementNo: { $ifNull: ['$disbursementdatas.disbursementNo', 0] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await RestaurantDisbursement.aggregate(query);
  const totalResults = await RestaurantDisbursement.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanDisbursementList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { userId: new mongoose.Types.ObjectId(options.deliveryman) };
  const query = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'disbursementdatas',
        localField: 'disbursementId',
        foreignField: '_id',
        as: 'disbursementdatas',
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
        from: 'deliverymanpayoutmethods',
        localField: 'deliverymanPayoutMethod',
        foreignField: '_id',
        as: 'deliverymanpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
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
      $unwind: {
        path: '$defaultPayoutMethod',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$disbursementdatas',
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
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        deliverymanPayoutMethodDetail: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        disbursement: {
          id: { $ifNull: ['$disbursementdatas._id', ''] },
          disbursementNo: { $ifNull: ['$disbursementdatas.disbursementNo', 0] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await DeliverymanDisbursement.aggregate(query);
  const totalResults = await DeliverymanDisbursement.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenRestaurantDisbursement = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const reportStatus = options.status;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
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
    $and: [
      reportStatus !== 'all' ? { status: reportStatus } : { status: { $ne: 'all' } },
      { 'restaurants.city': new mongoose.Types.ObjectId(city) },
    ],
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
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
        from: 'restaurantpayoutmethods',
        localField: 'restaurantPayoutMethod',
        foreignField: '_id',
        as: 'restaurantpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'restaurantpayoutmethods',
        localField: 'restaurant',
        foreignField: 'restaurant',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
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
      $unwind: {
        path: '$defaultPayoutMethod',
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
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        restaurantPayoutMethodDetail: {
          id: { $ifNull: ['$restaurantpayoutmethods._id', ''] },
          credential: { $ifNull: ['$restaurantpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await RestaurantDisbursement.aggregate(query);
  const countResult = await RestaurantDisbursement.aggregate([
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
  return Promise.all([cityzen, results, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenDeliverymanDisbursement = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const reportStatus = options.status;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [
      reportStatus !== 'all' ? { status: reportStatus } : { status: { $ne: 'all' } },
      { 'users.city': new mongoose.Types.ObjectId(city) },
    ],
  };
  const query = [
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
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
        from: 'deliverymanpayoutmethods',
        localField: 'deliverymanPayoutMethod',
        foreignField: '_id',
        as: 'deliverymanpayoutmethods',
      },
    },
    {
      $lookup: {
        from: 'deliverymanpayoutmethods',
        localField: 'userId',
        foreignField: 'deliveryman',
        as: 'defaultPayoutMethod',
        pipeline: [{ $match: { isDefault: true } }],
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
      $unwind: {
        path: '$defaultPayoutMethod',
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
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
        deliverymanPayoutMethodDetail: {
          id: { $ifNull: ['$deliverymanpayoutmethods._id', ''] },
          credential: { $ifNull: ['$deliverymanpayoutmethods.formElement', []] },
        },
        defaultPayoutMethodDetail: {
          id: { $ifNull: ['$defaultPayoutMethod._id', ''] },
          credential: { $ifNull: ['$defaultPayoutMethod.formElement', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await DeliverymanDisbursement.aggregate(query);
  const countResult = await DeliverymanDisbursement.aggregate([
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
    { $match: matchQuery },
    { $count: 'totalCount' },
  ]);
  return Promise.all([cityzen, results, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportRestaurantCollection = async (statusName) => {
  const matchQuery = {
    $match: {
      disbursementType: 'restaurant',
      status: statusName !== null && statusName !== 'all' ? statusName : { $ne: null },
    },
  };
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementNo: 1,
        totalAmount: {
          $round: [{ $divide: ['$totalAmount', 100] }, 2],
        },
        generatedTime: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DisbursementData.aggregate(query);
  return result;
};

const exportRestaurantRawCollection = async (statusName) => {
  const results = await DisbursementData.find({
    disbursementType: 'restaurant',
    status: statusName !== null && statusName !== 'all' ? statusName : { $ne: null },
  }).lean();
  return results;
};

const exportDeliverymanCollection = async (statusName) => {
  const matchQuery = {
    $match: {
      disbursementType: 'deliveryman',
      status: statusName !== null && statusName !== 'all' ? statusName : { $ne: null },
    },
  };
  const query = [
    matchQuery,
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementNo: 1,
        totalAmount: {
          $round: [{ $divide: ['$totalAmount', 100] }, 2],
        },
        generatedTime: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DisbursementData.aggregate(query);
  return result;
};

const exportDeliverymanRawCollection = async (statusName) => {
  const results = await DisbursementData.find({
    disbursementType: 'deliveryman',
    status: statusName !== null && statusName !== 'all' ? statusName : { $ne: null },
  }).lean();
  return results;
};

const exportRestaurantDisbursementCollection = async (disbursementId) => {
  const query = [
    {
      $match: {
        disbursementId: new mongoose.Types.ObjectId(disbursementId),
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
        from: 'withdrawalmethods',
        localField: 'withdrawalMethod',
        foreignField: '_id',
        as: 'withdrawalmethods',
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
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        disbursementId: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
        },
        restaurantPayoutMethod: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await RestaurantDisbursement.aggregate(query);
  return result;
};

const exportRestaurantDisbursementRawCollection = async (disbursementId) => {
  const results = await RestaurantDisbursement.find({
    disbursementId: new mongoose.Types.ObjectId(disbursementId),
  }).lean();
  return results;
};

const exportDeliverymanDisbursementCollection = async (disbursementId) => {
  const query = [
    {
      $match: {
        disbursementId: new mongoose.Types.ObjectId(disbursementId),
      },
    },
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
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        disbursementId: 1,
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
        },
        deliverymanPayoutMethod: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DeliverymanDisbursement.aggregate(query);
  return result;
};

const exportDeliverymanDisbursementRawCollection = async (disbursementId) => {
  const results = await DeliverymanDisbursement.find({
    disbursementId: new mongoose.Types.ObjectId(disbursementId),
  }).lean();
  return results;
};

const exportRestaurantDisbursementReportCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: {
      restaurant:
        filter &&
        options &&
        options.restaurant &&
        options.restaurant !== null &&
        options.restaurant !== ''
          ? new mongoose.Types.ObjectId(options.restaurant)
          : { $ne: null },
      status:
        filter && options && options.status && options.status !== null && options.status !== 'all'
          ? options.status
          : { $ne: null },
      withdrawalMethod:
        filter &&
        options &&
        options.payment &&
        options.payment !== null &&
        options.payment !== 'all'
          ? new mongoose.Types.ObjectId(options.payment)
          : { $ne: null },
    },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

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
  const name = options.search;
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'disbursementdatas',
        localField: 'disbursementId',
        foreignField: '_id',
        as: 'disbursementdatas',
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
        from: 'withdrawalmethods',
        localField: 'withdrawalMethod',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $unwind: {
        path: '$disbursementdatas',
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'restaurants.name': RegExp(name, 'i') },
          { 'restaurants.slug': RegExp(name, 'i') },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: RegExp(name, 'i') },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        disbursement: {
          id: { $ifNull: ['$disbursementdatas._id', ''] },
          disbursementNo: { $ifNull: ['$disbursementdatas.disbursementNo', 0] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
        },
        restaurantPayoutMethod: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await RestaurantDisbursement.aggregate(query);
  return result;
};

const exportRestaurantDisbursementReportRawCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: {
      restaurant:
        filter &&
        options &&
        options.restaurant &&
        options.restaurant !== null &&
        options.restaurant !== ''
          ? new mongoose.Types.ObjectId(options.restaurant)
          : { $ne: null },
      status:
        filter && options && options.status && options.status !== null && options.status !== 'all'
          ? options.status
          : { $ne: null },
      withdrawalMethod:
        filter &&
        options &&
        options.payment &&
        options.payment !== null &&
        options.payment !== 'all'
          ? new mongoose.Types.ObjectId(options.payment)
          : { $ne: null },
    },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

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
  const name = options.search;
  const query = [
    matchQuery,
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
      $match: {
        $or: [
          { 'restaurants.name': RegExp(name, 'i') },
          { 'restaurants.slug': RegExp(name, 'i') },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: RegExp(name, 'i') },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        restaurants: 0,
      },
    },
  ];
  const result = await RestaurantDisbursement.aggregate(query);
  return result;
};

const exportDeliverymanDisbursementReportCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: {
      status:
        filter && options && options.status && options.status !== null && options.status !== 'all'
          ? options.status
          : { $ne: null },
      withdrawalMethod:
        filter &&
        options &&
        options.payment &&
        options.payment !== null &&
        options.payment !== 'all'
          ? new mongoose.Types.ObjectId(options.payment)
          : { $ne: null },
    },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

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
  const name = options.search;
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'disbursementdatas',
        localField: 'disbursementId',
        foreignField: '_id',
        as: 'disbursementdatas',
      },
    },
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
      $unwind: {
        path: '$disbursementdatas',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        disbursement: {
          id: { $ifNull: ['$disbursementdatas._id', ''] },
          disbursementNo: { $ifNull: ['$disbursementdatas.disbursementNo', 0] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        withdrawalMethodDetail: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
        },
        deliverymanPayoutMethod: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DeliverymanDisbursement.aggregate(query);
  return result;
};

const exportDeliverymanDisbursementReportRawCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: {
      status:
        filter && options && options.status && options.status !== null && options.status !== 'all'
          ? options.status
          : { $ne: null },
      withdrawalMethod:
        filter &&
        options &&
        options.payment &&
        options.payment !== null &&
        options.payment !== 'all'
          ? new mongoose.Types.ObjectId(options.payment)
          : { $ne: null },
    },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

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
  const name = options.search;
  const query = [
    matchQuery,
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
      $match: {
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
      },
    },
  ];
  const result = await DeliverymanDisbursement.aggregate(query);
  return result;
};

module.exports = {
  createDisbursement,
  getDisbursement,
  updateDisbursement,
  restaurantDisbursement,
  deliverymanDisbursement,
  restaurantDisbursementReport,
  deliverymanDisbursementReport,
  restaurantDisbursementDetail,
  deliverymanDisbursementDetail,
  rejectRestaurantDisburment,
  acceptRestaurantDisburment,
  rejectDeliverymanDisbursment,
  acceptDeliverymanDisbursment,
  restaurantDisbursementAmounts,
  restaurantDisbursementTransactionReport,
  deliverymanDisbursementAmounts,
  deliverymanDisbursementTransactionReport,
  vendorDisbursementList,
  deliverymanDisbursementList,
  cityzenRestaurantDisbursement,
  cityzenDeliverymanDisbursement,
  exportRestaurantCollection,
  exportRestaurantRawCollection,
  exportDeliverymanCollection,
  exportDeliverymanRawCollection,
  exportRestaurantDisbursementCollection,
  exportRestaurantDisbursementRawCollection,
  exportDeliverymanDisbursementCollection,
  exportDeliverymanDisbursementRawCollection,
  exportRestaurantDisbursementReportCollection,
  exportRestaurantDisbursementReportRawCollection,
  exportDeliverymanDisbursementReportCollection,
  exportDeliverymanDisbursementReportRawCollection,
};

