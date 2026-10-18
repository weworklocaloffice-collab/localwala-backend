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
const Restaurant = require('../../../models/restaurant.model');
const Food = require('../../../models/food.model');
const ApiError = require('../../../utils/ApiError');

// Autocomplete payload for the create-reel screen. Deliberately small: the
// admin panel needs id + display name (+ slug for restaurants, which the
// customer app needs to open the restaurant page). Translations are returned
// raw so the panel can localise the label the same way it does everywhere
// else.
const MAX_RESULTS = 500;

const asId = (value) => String(value || '');

const restaurantsByCity = async (cityId) => {
  if (!cityId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'cityId is required to list restaurants');
  }
  const restaurants = await Restaurant.find(
    { city: cityId, status: true },
    { name: 1, slug: 1, translations: 1, locality: 1 }
  )
    .sort({ name: 1 })
    .limit(MAX_RESULTS);

  return restaurants.map((r) => ({
    id: asId(r._id),
    name: r.name || '',
    slug: r.slug || '',
    translations: r.translations || [],
  }));
};

const mapFoods = (foods) =>
  foods.map((f) => ({
    id: asId(f._id),
    name: f.name || '',
    restaurantId: asId(f.restaurant),
    image: f.image || '',
    translations: f.translations || [],
  }));

const foodsByRestaurant = async (restaurantId) => {
  if (!restaurantId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'restaurantId is required to list its foods');
  }
  const foods = await Food.find(
    { restaurant: restaurantId, status: 'live' },
    { name: 1, translations: 1, restaurant: 1, image: 1 }
  )
    .sort({ name: 1 })
    .limit(MAX_RESULTS);
  return mapFoods(foods);
};

const foodsByCity = async (cityId) => {
  if (!cityId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'cityId is required to list foods');
  }
  const restaurants = await Restaurant.find({ city: cityId, status: true }, { _id: 1 }).limit(
    2000
  );
  const ids = restaurants.map((r) => r._id);
  if (!ids.length) return [];
  const foods = await Food.find(
    { restaurant: { $in: ids }, status: 'live' },
    { name: 1, translations: 1, restaurant: 1, image: 1 }
  )
    .sort({ name: 1 })
    .limit(MAX_RESULTS);
  return mapFoods(foods);
};

module.exports = {
  restaurantsByCity,
  foodsByRestaurant,
  foodsByCity,
};
