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

const { PaymentConfig, WalletBonus } = require('../models');

const createConfig = async (paymentBody) => {
  if (paymentBody.isDefault === true || paymentBody.isDefault === 'true') {
    await PaymentConfig.updateMany({}, { $set: { isDefault: false } });
  }
  return PaymentConfig.create(paymentBody);
};

const getPaymentBySlug = async (slugURL) => {
  return PaymentConfig.findOne(
    { slug: slugURL },
    {
      _id: 1,
      environment: 1,
      image: 1,
      name: 1,
      slug: 1,
      status: 1,
      translations: 1,
      credentials: 1,
      isDefault: 1,
      paymentWay: 1,
    }
  );
};

const getPaymentById = async (id) => {
  const info = await PaymentConfig.findById(id);
  return info;
};

const updatePaymentConfig = async (slug, updateBody) => {
  if (updateBody.isDefault === true || updateBody.isDefault === 'true') {
    await PaymentConfig.updateMany({}, { $set: { isDefault: false } });
  }
  const paymentConfig = await getPaymentBySlug(slug);
  Object.assign(paymentConfig, updateBody);
  await paymentConfig.save();
  return paymentConfig;
};

const getWalletPaymentList = async () => {
  const paymentSettings = await PaymentConfig.find(
    { status: true, paymentWay: 'online' },
    { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
  );
  const defaultPayment = await PaymentConfig.findOne(
    { isDefault: true, status: true, paymentWay: 'online' },
    { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
  );
  const currentDate = new Date();
  const activeBonus = await WalletBonus.find({
    start: { $lte: currentDate },
    expires: { $gte: currentDate },
    status: true,
  });
  if (paymentSettings !== null && paymentSettings.length > 0) {
    return {
      success: true,
      payments: paymentSettings,
      primary: defaultPayment,
      bonus: activeBonus,
    };
  }
  return { success: false };
};

const getOnlinePaymentList = async () => {
  const paymentSettings = await PaymentConfig.find(
    { status: true, paymentWay: 'online' },
    { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
  );
  const defaultPayment = await PaymentConfig.findOne(
    { isDefault: true, status: true, paymentWay: 'online' },
    { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
  );
  if (paymentSettings !== null && paymentSettings.length > 0) {
    return { success: true, payments: paymentSettings, primary: defaultPayment };
  }
  return { success: false };
};

const codPaymentId = async () => {
  const payments = await PaymentConfig.findOne({ slug: 'cod' }, { id: 1 });
  if (!payments) {
    return null;
  }
  return payments.id;
};

module.exports = {
  createConfig,
  getPaymentBySlug,
  updatePaymentConfig,
  getWalletPaymentList,
  getPaymentById,
  getOnlinePaymentList,
  codPaymentId,
};

