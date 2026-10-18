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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const checkEligibility = async ({ outlet, address, addressLocation }) => {
  const reasons = [];

  if (!outlet) {
    return { eligible: false, reasons: ['OUTLET_NOT_FOUND'] };
  }

  if (!outlet.operational) {
    reasons.push('STORE_NOT_OPERATIONAL');
  }

  if (outlet.status !== 'active') {
    reasons.push('STORE_NOT_ACTIVE');
  }

  if (!outlet.location || !outlet.location.coordinates) {
    reasons.push('STORE_LOCATION_MISSING');
  }

  if (addressLocation && outlet.location && outlet.location.coordinates) {
    const distance = calculateDistance(
      outlet.location.coordinates[1],
      outlet.location.coordinates[0],
      addressLocation.coordinates[1],
      addressLocation.coordinates[0]
    );
    if (distance > outlet.deliveryConfig?.radiusKm) {
      reasons.push('OUTSIDE_DELIVERY_RADIUS');
    }
  }

  if (outlet.serviceLocalities && outlet.serviceLocalities.length > 0 && address) {
    const localityId = address.localityRef || address.locality;
    if (!outlet.serviceLocalities.some((l) => l.toString() === localityId?.toString())) {
      reasons.push('LOCALITY_NOT_SERVICED');
    }
  }

  const now = new Date();
  const day = now.getDay();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  const todayHours = outlet.operatingHours?.find((h) => h.day === day);
  if (todayHours && !todayHours.isOpen) {
    reasons.push('STORE_CLOSED');
  } else if (todayHours && todayHours.opensAt && todayHours.closesAt) {
    if (currentTime < todayHours.opensAt || currentTime > todayHours.closesAt) {
      reasons.push('STORE_CLOSED');
    }
  }

  const todayStr = now.toISOString().split('T')[0];
  if (outlet.holidays?.some((h) => h.date === todayStr)) {
    reasons.push('STORE_HOLIDAY');
  }

  if (outlet.deliveryConfig?.dailyOrderCapacity > 0) {
    const StoreOrder = mongoose.model('StoreOrder');
    const todayOrders = await StoreOrder.countDocuments({
      outlet: outlet._id,
      createdAt: { $gte: new Date(now.setHours(0, 0, 0, 0)) },
      lifecycle: { $nin: ['cancelled', 'rejected', 'payment_failed'] },
    });
    if (todayOrders >= outlet.deliveryConfig.dailyOrderCapacity) {
      reasons.push('STORE_AT_CAPACITY');
    }
  }

  return { eligible: reasons.length === 0, reasons };
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (deg) => deg * (Math.PI / 180);

const getNearbyOutlets = async ({ lat, lng, radiusKm = 10, limit = 20 }) => {
  const StoreOutlet = mongoose.model('StoreOutlet');
  return StoreOutlet.find({
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radiusKm * 1000,
      },
    },
    status: 'active',
    operational: true,
  }).limit(limit).lean();
};

module.exports = {
  checkEligibility,
  getNearbyOutlets,
  calculateDistance,
};