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
const ApiError = require('../../../utils/ApiError');

const SERVICE_CARD_FIELDS =
  'name key description image pricingMode bookingMode baseDurationMinutes minPrice maxPrice status';

const assertServiceExists = async (service) => {
  const Service = mongoose.model('LocalServiceService');
  const exists = await Service.exists({ _id: service });
  if (!exists) throw new ApiError(httpStatus.NOT_FOUND, 'Service not found');
};

const addFavorite = async ({ customer, service }) => {
  const Favorite = mongoose.model('LocalServiceFavorite');
  await assertServiceExists(service);

  try {
    const favorite = await Favorite.findOneAndUpdate(
      { customer, service },
      { $setOnInsert: { customer, service } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { favorite, created: false };
  } catch (error) {
    if (error && error.code === 11000) {
      const favorite = await Favorite.findOne({ customer, service });
      return { favorite, created: false };
    }
    throw error;
  }
};

const removeFavorite = async ({ customer, service }) => {
  const Favorite = mongoose.model('LocalServiceFavorite');
  const result = await Favorite.findOneAndDelete({ customer, service });
  return { removed: Boolean(result) };
};

const isFavorite = async ({ customer, service }) => {
  const Favorite = mongoose.model('LocalServiceFavorite');
  const favorite = await Favorite.findOne({ customer, service }).select('_id').lean();
  return { favorite: Boolean(favorite) };
};

const listFavorites = async ({ customer, page = 1, limit = 20 }) => {
  const Favorite = mongoose.model('LocalServiceFavorite');
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    Favorite.find({ customer })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('service', SERVICE_CARD_FIELDS)
      .lean(),
    Favorite.countDocuments({ customer }),
  ]);

  const items = rows
    .filter((row) => row.service)
    .map((row) => ({
      _id: row._id,
      service: row.service,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

module.exports = {
  addFavorite,
  removeFavorite,
  isFavorite,
  listFavorites,
};
