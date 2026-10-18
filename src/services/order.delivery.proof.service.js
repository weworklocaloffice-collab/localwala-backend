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

const { OrderDeliveryProof } = require('../models');

const saveProof = async (proof) => {
  const checkExist = await OrderDeliveryProof.findOne({ orderId: proof.orderId });
  if (checkExist) {
    const proofData = {
      orderId: proof.orderId,
      pickup:
        proof !== null && proof.pickup !== null && proof.pickup !== '' ? proof.pickup : 'none',
      dropup:
        proof !== null && proof.dropup !== null && proof.dropup !== '' ? proof.dropup : 'none',
    };
    if (proof.type === 'pick') {
      delete proofData.dropup;
    } else {
      delete proofData.pickup;
    }
    Object.assign(checkExist, proofData);
    await checkExist.save();
    return { success: true };
  }

  const proofData = new OrderDeliveryProof({
    orderId: proof.orderId,
    pickup: proof !== null && proof.pickup !== null && proof.pickup !== '' ? proof.pickup : 'none',
    dropup: proof !== null && proof.dropup !== null && proof.dropup !== '' ? proof.dropup : 'none',
  });
  await OrderDeliveryProof.create(proofData);
  return { success: true };
};

module.exports = {
  saveProof,
};

