/**
 * LocalWala �?" Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const CHAIN_CARD_FIELDS = 'name slug logo description status';

const assertChainExists = async (chain) => {
  const StoreChain = mongoose.model('StoreChain');
  const exists = await StoreChain.exists({ _id: chain });
  if (!exists) throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
};

/**
 * Idempotent by design: a customer who taps the heart twice wants the store saved, not a
 * 409 and a hollow-feeling error. The unique index is what makes it safe under a
 * double-tap; the catch handles the losing insert of a race.
 */
const addFavourite = async ({ customer, chain }) => {
  const StoreFavourite = mongoose.model('StoreFavourite');
  await assertChainExists(chain);

  try {
    const favourite = await StoreFavourite.findOneAndUpdate(
      { customer, chain },
      { $setOnInsert: { customer, chain } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { favourite, created: false };
  } catch (error) {
    if (error && error.code === 11000) {
      const favourite = await StoreFavourite.findOne({ customer, chain });
      return { favourite, created: false };
    }
    throw error;
  }
};

const removeFavourite = async ({ customer, chain }) => {
  const StoreFavourite = mongoose.model('StoreFavourite');
  const result = await StoreFavourite.findOneAndDelete({ customer, chain });
  return { removed: Boolean(result) };
};

const isFavourite = async ({ customer, chain }) => {
  const StoreFavourite = mongoose.model('StoreFavourite');
  const favourite = await StoreFavourite.findOne({ customer, chain }).select('_id').lean();
  return { favourite: Boolean(favourite) };
};

/**
 * Chains are populated with only the card fields the customer app renders. A deleted or
 * archived chain is filtered out rather than surfaced as a broken card; its favourite row
 * is left alone so the customer can still see it if the brand returns.
 */
const listFavourites = async ({ customer, page = 1, limit = 20 }) => {
  const StoreFavourite = mongoose.model('StoreFavourite');
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    StoreFavourite.find({ customer })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('chain', CHAIN_CARD_FIELDS)
      .lean(),
    StoreFavourite.countDocuments({ customer }),
  ]);

  const items = rows
    .filter((row) => row.chain)
    .map((row) => ({
      _id: row._id,
      chain: row.chain,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

module.exports = {
  addFavourite,
  removeFavourite,
  isFavourite,
  listFavourites,
};
