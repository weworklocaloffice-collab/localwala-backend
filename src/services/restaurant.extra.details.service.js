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
const { RestaurantExtraDetail } = require('../models');

const saveGuestAvailability = async (id, availability) => {
  const query = { restaurant: new mongoose.Types.ObjectId(id) };
  const options = {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  };
  const updateData = {
    guestAvailability: availability,
  };
  await RestaurantExtraDetail.findOneAndUpdate(query, updateData, options);
  return { success: true };
};

const getGuestAvailability = async (id) => {
  const result = await RestaurantExtraDetail.findOne(
    { restaurant: new mongoose.Types.ObjectId(id) },
    { _id: 1, guestAvailability: 1 }
  );
  if (!result) {
    return { success: false };
  }
  return { result, success: true };
};

const getMyDiningSchedule = async (id) => {
  const result = await RestaurantExtraDetail.findOne(
    { restaurant: new mongoose.Types.ObjectId(id) },
    { _id: 1, slots: 1 }
  );
  if (!result) {
    const slots = [
      {
        day: 0, // Monday
        times: [],
      },
      {
        day: 1, // Tuesday
        times: [],
      },
      {
        day: 2, // Wednesday
        times: [],
      },
      {
        day: 3, // Thursday
        times: [],
      },
      {
        day: 4, // Friday
        times: [],
      },
      {
        day: 5, // Saturday
        times: [],
      },
      {
        day: 6, // Sunday
        times: [],
      },
    ];
    return { slots, success: true };
  }
  let { slots } = result;
  if (slots && slots.length <= 0) {
    slots = [
      {
        day: 0, // Monday
        times: [],
      },
      {
        day: 1, // Tuesday
        times: [],
      },
      {
        day: 2, // Wednesday
        times: [],
      },
      {
        day: 3, // Thursday
        times: [],
      },
      {
        day: 4, // Friday
        times: [],
      },
      {
        day: 5, // Saturday
        times: [],
      },
      {
        day: 6, // Sunday
        times: [],
      },
    ];
  }
  return { slots, success: true };
};

const saveDiningSchedule = async (id, param) => {
  const query = { restaurant: new mongoose.Types.ObjectId(id) };
  const options = {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  };
  const updateData = {
    slots: param.slots,
  };
  await RestaurantExtraDetail.findOneAndUpdate(query, updateData, options);
  return { success: true };
};

const saveDiningScheduleWeb = async (id, param) => {
  const query = { restaurant: new mongoose.Types.ObjectId(id) };
  const options = {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  };
  const updateData = {
    slots: JSON.parse(param.slots),
  };
  await RestaurantExtraDetail.findOneAndUpdate(query, updateData, options);
  return { success: true };
};

module.exports = {
  saveGuestAvailability,
  getGuestAvailability,
  getMyDiningSchedule,
  saveDiningScheduleWeb,
  saveDiningSchedule,
};

