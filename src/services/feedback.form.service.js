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

const { FeedbackForm } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveFeedbackForm = async (param) => {
  const feedbackData = new FeedbackForm({
    userName:
      param && param.userName && param.userName !== null && param.userName !== ''
        ? param.userName
        : '',
    userCountryCode:
      param &&
      param.userCountryCode &&
      param.userCountryCode !== null &&
      param.userCountryCode !== ''
        ? param.userCountryCode
        : 1,
    userContact:
      param && param.userContact && param.userContact !== null && param.userContact !== ''
        ? param.userContact
        : '',
    userEmail:
      param && param.userEmail && param.userEmail !== null && param.userEmail !== ''
        ? param.userEmail
        : '',
    shortDescription:
      param &&
      param.shortDescription &&
      param.shortDescription !== null &&
      param.shortDescription !== ''
        ? param.shortDescription
        : '',
  });
  await FeedbackForm.create(feedbackData);
  return { success: true };
};

const feedbackListAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const statusName = !!(options.status === 'true' || options.status === true);
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ userName: searchRegExp }, { userEmail: searchRegExp }],
        $and: [{ status: statusName }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        userName: 1,
        userCountryCode: 1,
        userContact: 1,
        userEmail: 1,
        shortDescription: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const results = await FeedbackForm.aggregate(query);
  const countResult = await FeedbackForm.aggregate([
    {
      $match: {
        $or: [{ userName: searchRegExp }, { userEmail: searchRegExp }],
        $and: [{ status: statusName }],
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

const deleteFeedbackFormById = async (id) => {
  const feedback = await FeedbackForm.findById(id);
  if (!feedback) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await feedback.deleteOne();
  return { success: true };
};

const updateFeedbackFormByID = async (id) => {
  const feedback = await FeedbackForm.findById(id);
  if (!feedback) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: false,
  };
  Object.assign(feedback, updateBody);
  await feedback.save();
  return { success: true };
};

const exportCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ userName: searchRegExp }, { userEmail: searchRegExp }],
        $and: [{ status: statusName }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        userName: 1,
        userCountryCode: 1,
        userContact: 1,
        userEmail: 1,
        shortDescription: 1,
        status: 1,
      },
    },
  ];
  const results = await FeedbackForm.aggregate(query);
  return results;
};

const exportRawCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ userName: searchRegExp }, { userEmail: searchRegExp }],
        $and: [{ status: statusName }],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await FeedbackForm.aggregate(query);
  return results;
};

module.exports = {
  saveFeedbackForm,
  feedbackListAdmin,
  deleteFeedbackFormById,
  updateFeedbackFormByID,
  exportCollection,
  exportRawCollection,
};

