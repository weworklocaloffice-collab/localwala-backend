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
const { FavouriteOrder } = require('../models');
const ApiError = require('../utils/ApiError');

const saveFavourite = async (params) => {
  const favourite = await FavouriteOrder.findOne({ user: params.user, order: params.order });
  if (favourite) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already saved');
  }
  const saveData = new FavouriteOrder({
    user: params && params.user && params.user !== '' && params.user !== null ? params.user : null,
    order:
      params && params.order && params.order !== '' && params.order !== null ? params.order : null,
  });
  await FavouriteOrder.create(saveData);
  return { success: true };
};

const removeFavourite = async (params) => {
  const favourite = await FavouriteOrder.findOne({ user: params.user, order: params.order });
  if (!favourite) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not found');
  }
  await favourite.deleteOne();
  return { success: true };
};

module.exports = {
  saveFavourite,
  removeFavourite,
};

