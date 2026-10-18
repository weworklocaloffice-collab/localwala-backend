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
const Category = require('../../../models/category.model');
const ApiError = require('../../../utils/ApiError');

// Autocomplete options for the CTA target pickers in the admin panel.
//
// The panel previously asked for a raw ObjectId, which is not something an operator can
// read off a screen; it has to be copied out of a database viewer. These lookups return the
// minimum the panel needs to render a label: id, display name and translations. The slug
// comes back too because the customer app's category and restaurant routes are argument
// based and resolve the target server side (see `resolveCtaTarget`).
//
// Deliberately scoped to this module rather than reusing an existing endpoint: every
// general-purpose list route is gated behind a different feature's permission
// (`getRestaurantByCity`, `createFoodCampaign`, `reels_admin_manage`), so none of them can
// be called by someone who only holds `header_banner_manage`.

const MAX_RESULTS = 500;

// A city can hold more restaurants than any operator will page through, and the panel
// filters the returned list client side, so the cap has to be generous. The reels lookup
// uses the same bound.
const MAX_CITY_RESTAURANTS = 500;

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
    .limit(MAX_CITY_RESTAURANTS);

  return restaurants.map((restaurant) => ({
    id: asId(restaurant._id),
    name: restaurant.name || '',
    slug: restaurant.slug || '',
    translations: restaurant.translations || [],
  }));
};

const mapFoods = (foods) =>
  foods.map((food) => ({
    id: asId(food._id),
    name: food.name || '',
    restaurantId: asId(food.restaurant),
    image: food.image || '',
    translations: food.translations || [],
  }));

/**
 * Live foods belonging to one restaurant.
 *
 * Scoped to the restaurant rather than the city on purpose: an operator picking a food
 * has already chosen the restaurant, and a city-wide food list in a city this size is not
 * a list anyone can search.
 */
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

/**
 * City-wide food list, used when no restaurant has been chosen yet.
 *
 * Distinct from `foodsByRestaurant` in the panel: this one renders each option with its
 * parent restaurant so two identically named dishes are still distinguishable.
 */
const foodsByCity = async (cityId) => {
  if (!cityId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'cityId is required to list foods');
  }

  const restaurants = await Restaurant.find({ city: cityId, status: true }, { _id: 1 }).limit(
    2000
  );
  const ids = restaurants.map((restaurant) => restaurant._id);
  if (!ids.length) return [];

  const foods = await Food.find(
    { restaurant: { $in: ids }, status: 'live' },
    { name: 1, translations: 1, restaurant: 1, image: 1 }
  )
    .sort({ name: 1 })
    .limit(MAX_RESULTS);

  return mapFoods(foods);
};

/**
 * Active categories, which are global rather than city scoped.
 *
 * A category listing has no city dimension, so this needs no argument. Only the fields
 * the panel labels with are read - the slug is what the customer app's
 * `/restaurants_by_category` route is given.
 */
const categories = async () => {
  const list = await Category.find({ status: true }, { name: 1, slug: 1, translations: 1 }).sort(
    { name: 1 }
  );

  return list.map((category) => ({
    id: asId(category._id),
    name: category.name || '',
    slug: category.slug || '',
    translations: category.translations || [],
  }));
};

module.exports = {
  restaurantsByCity,
  foodsByRestaurant,
  foodsByCity,
  categories,
  MAX_RESULTS,
};