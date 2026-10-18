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

const catchAsync = require('../utils/catchAsync');
const { restaurantExtraDetailsService } = require('../services');

const saveGuestAvailability = catchAsync(async (req, res) => {
  function convertStringToNumberList(numberString) {
    return numberString.split(',').map((num) => parseInt(num.trim(), 10));
  }
  const availabilityList = convertStringToNumberList(req.body.availability);
  const facility = await restaurantExtraDetailsService.saveGuestAvailability(
    req.params.restaurant,
    availabilityList
  );
  res.send(facility);
});

const getGuestAvailability = catchAsync(async (req, res) => {
  const { restaurant } = req.params;
  const result = await restaurantExtraDetailsService.getGuestAvailability(restaurant);
  res.send(result);
});

const getMyDiningSchedule = catchAsync(async (req, res) => {
  const { restaurant } = req.params;
  const result = await restaurantExtraDetailsService.getMyDiningSchedule(restaurant);
  res.send(result);
});

const saveDiningSchedule = catchAsync(async (req, res) => {
  const restaurant = await restaurantExtraDetailsService.saveDiningSchedule(
    req.params.restaurant,
    req.body
  );
  res.send(restaurant);
});

const saveDiningScheduleWeb = catchAsync(async (req, res) => {
  const restaurant = await restaurantExtraDetailsService.saveDiningScheduleWeb(
    req.params.restaurant,
    req.body
  );
  res.send(restaurant);
});

module.exports = {
  saveGuestAvailability,
  getGuestAvailability,
  getMyDiningSchedule,
  saveDiningSchedule,
  saveDiningScheduleWeb,
};

