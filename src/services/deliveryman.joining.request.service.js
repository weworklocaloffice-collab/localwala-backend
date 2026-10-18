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
const { DeliverymanJoiningRequest, User } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createDeliverymanJoiningRequest = async (param) => {
  const deliverymanData = new DeliverymanJoiningRequest({
    firstName: param.firstName,
    lastName: param.lastName,
    email: param.email,
    password: param.password,
    countryCode: param.countryCode,
    mobile: param.mobile,
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    vehicle: param.vehicle,
    cover: param.cover,
    identity: param.identity,
    identityNumber: param.identityNumber,
    identityProof: param.identityProof,
    drivingLicense: param.drivingLicense,
    age: param.age,
    dob: param.dob,
    type: param.type,
    formElement: param.formElement,
    locale: param && param.locale !== null && param.locale !== '' ? param.locale : 'en',
  });
  const result = await DeliverymanJoiningRequest.create(deliverymanData);
  return { id: result.id, success: true };
};

const getJoiningRequestList = async (options, statusName) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }].filter(Boolean),
    $and: [statusName !== 'all' ? { type: statusName } : { type: { $ne: 'all' } }],
  };
  const query = [
    {
      $match: matchQuery,
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
    {
      $project: {
        _id: 0,
        id: '$_id',
        cover: 1,
        firstName: 1,
        lastName: 1,
        countryCode: 1,
        contactNumber: 1,
        contactEmail: 1,
        type: 1,
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
        vehicleInfo: {
          id: { $ifNull: ['$vehicles._id', ''] },
          name: { $ifNull: ['$vehicles.name', ''] },
          translations: { $ifNull: ['$vehicles.translations', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await DeliverymanJoiningRequest.aggregate(query);
  const countResult = await DeliverymanJoiningRequest.aggregate([
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

const cityzentJoiningRequestList = async (masterId, options, statusName) => {
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
    $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }].filter(Boolean),
    $and: [
      statusName !== 'all' ? { type: statusName } : { type: { $ne: 'all' } },
      { city: new mongoose.Types.ObjectId(city) },
    ],
  };
  const query = [
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
    {
      $project: {
        _id: 0,
        id: '$_id',
        cover: 1,
        firstName: 1,
        lastName: 1,
        countryCode: 1,
        contactNumber: 1,
        contactEmail: 1,
        type: 1,
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        vehicleInfo: {
          id: { $ifNull: ['$vehicles._id', ''] },
          name: { $ifNull: ['$vehicles.name', ''] },
          translations: { $ifNull: ['$vehicles.translations', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await DeliverymanJoiningRequest.aggregate(query);
  const countResult = await DeliverymanJoiningRequest.aggregate([
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

const getDetail = async (id) => {
  const result = await DeliverymanJoiningRequest.findById(id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return result;
};

const deleteRequest = async (id) => {
  const result = await DeliverymanJoiningRequest.findById(id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await result.deleteOne();
  return { success: true };
};

const getDeepDetail = async (id) => {
  const deliveryman = await DeliverymanJoiningRequest.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        password: 1,
        email: 1,
        locale: 1,
      },
    },
  ]);
  if (!checkArrayNotEmpty(deliveryman)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return deliveryman[0];
};

const rejectRequest = async (id) => {
  const result = await DeliverymanJoiningRequest.findById(id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(result, { status: 'rejected' });
  await result.save();
  return result;
};

const exportCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }].filter(Boolean),
    $and: [statusName !== 'all' ? { type: statusName } : { type: { $ne: 'all' } }],
  };
  const query = [
    { $match: matchQuery },
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
        cover: 1,
        firstName: 1,
        lastName: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        type: 1,
        location: 1,
        identity: 1,
        identityNumber: 1,
        identityProof: 1,
        drivingLicense: 1,
        age: 1,
        dob: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
        },
        vehicleInfo: {
          id: { $ifNull: ['$vehicles._id', ''] },
          name: { $ifNull: ['$vehicles.name', ''] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DeliverymanJoiningRequest.aggregate(query);
  return result;
};

const exportRawCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [{ firstName: searchRegExp }, { lastName: searchRegExp }].filter(Boolean),
    $and: [statusName !== 'all' ? { type: statusName } : { type: { $ne: 'all' } }],
  };
  const results = await DeliverymanJoiningRequest.aggregate([
    {
      $match: matchQuery,
    },
  ]);
  return results;
};

module.exports = {
  createDeliverymanJoiningRequest,
  getJoiningRequestList,
  getDetail,
  deleteRequest,
  rejectRequest,
  getDeepDetail,
  cityzentJoiningRequestList,
  exportCollection,
  exportRawCollection,
};

