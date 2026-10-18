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

const { RestaurantPosTableOrderCommission } = require('../models');

const savePOSCommission = async (param) => {
  const commissionData = new RestaurantPosTableOrderCommission({
    posOrder: param.id,
    tableOrder: null,
    restaurant: param.restaurant,
    foodServiceCharge: param.foodServiceCharge,
    serviceCharge: param.serviceCharge,
    totalEarning: param.totalEarning,
    orderCommission: param.orderCommission,
    commission: param.commission,
    status: true,
  });
  await RestaurantPosTableOrderCommission.create(commissionData);
};

const saveTableOrderCommission = async (param) => {
  const commissionData = new RestaurantPosTableOrderCommission({
    tableOrder: param.id,
    posOrder: null,
    restaurant: param.restaurant,
    foodServiceCharge: param.foodServiceCharge,
    serviceCharge: param.serviceCharge,
    totalEarning: param.totalEarning,
    orderCommission: param.orderCommission,
    commission: param.commission,
    status: true,
  });
  await RestaurantPosTableOrderCommission.create(commissionData);
};

module.exports = {
  savePOSCommission,
  saveTableOrderCommission,
};

