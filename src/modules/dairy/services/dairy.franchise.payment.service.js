const { status: httpStatus } = require('http-status');
const { DairyFranchise, PaymentInitiation, PaymentConfig } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const paymentInitiationService = require('../../../services/payment.initiation.service');

const DAIRY_FRANCHISE_PAYMENT_SUBJECTS = Object.freeze(['dairy_franchise_joining_fee']);

const initiateJoiningFeePayment = async ({ businessId, userId, paymentConfigId }) => {
  const franchise = await DairyFranchise.findOne({ business: businessId });
  if (!franchise) throw new ApiError(httpStatus.NOT_FOUND, 'Franchise agreement not found');
  if (franchise.status === 'active' && ['paid', 'not_required', 'waived'].includes(franchise.joiningFeePaymentStatus)) {
    throw new ApiError(httpStatus.CONFLICT, 'The franchise joining fee is already complete');
  }
  if (franchise.status !== 'pending' || !(Number(franchise.joiningFee) > 0)) {
    throw new ApiError(httpStatus.CONFLICT, 'There is no payable joining fee for this franchise agreement');
  }
  if (!['pending', 'failed', 'initiated'].includes(franchise.joiningFeePaymentStatus)) {
    throw new ApiError(httpStatus.CONFLICT, 'The joining fee is not available for payment');
  }

  const existing = await PaymentInitiation.findOne({
    dairyFranchise: franchise._id,
    paymentFrom: 'dairy_franchise_joining_fee',
    status: 'initiated',
  }).sort({ createdAt: -1 });
  if (existing) {
    franchise.joiningFeePaymentStatus = 'initiated';
    franchise.joiningFeePaymentInitiation = existing._id;
    await franchise.save();
    return { franchise, initiation: existing };
  }

  let config = paymentConfigId ? await PaymentConfig.findById(paymentConfigId) : null;
  if (paymentConfigId && !config) throw new ApiError(httpStatus.BAD_REQUEST, 'Payment method not found');
  if (!config) {
    config = (await PaymentConfig.findOne({ isDefault: true, status: true, paymentWay: 'online' })) ||
      (await PaymentConfig.findOne({ status: true, paymentWay: 'online' }));
  }
  if (!config || config.status === false || config.paymentWay !== 'online') {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Online payments are not available right now');
  }

  const initiation = await paymentInitiationService.initiatePayment({
    user: String(userId),
    payment: String(config._id),
    dairyFranchise: String(franchise._id),
    amount: Number(franchise.joiningFee),
    from: 'dairy_franchise_joining_fee',
    ref: `DAIRY-FRANCHISE-FEE-${String(franchise._id).slice(-8).toUpperCase()}`,
  });

  franchise.joiningFeePaymentStatus = 'initiated';
  franchise.joiningFeePaymentInitiation = initiation._id;
  await franchise.save();
  return { franchise, initiation };
};

const applyJoiningFeePayment = async (payment) => {
  if (!payment?.dairyFranchise) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Dairy franchise payment has no agreement reference');
  }
  const franchise = await DairyFranchise.findById(payment.dairyFranchise);
  if (!franchise) throw new ApiError(httpStatus.NOT_FOUND, 'Franchise agreement not found for payment');
  if (franchise.joiningFeePaymentStatus === 'paid') return franchise;
  if (franchise.status !== 'pending') {
    throw new ApiError(httpStatus.CONFLICT, `Cannot apply a joining fee to a ${franchise.status} franchise`);
  }
  if (Number(payment.amount) !== Number(franchise.joiningFee)) {
    throw new ApiError(httpStatus.CONFLICT, 'Franchise joining-fee payment does not match the agreed amount');
  }

  franchise.joiningFeePaymentStatus = 'paid';
  franchise.joiningFeePaidAt = new Date();
  franchise.joiningFeePaymentInitiation = payment._id || franchise.joiningFeePaymentInitiation;
  franchise.joiningFeePaymentReference =
    payment.payResponse?.razorpay_payment_id || payment.paymentRef || franchise.joiningFeePaymentReference;
  franchise.status = 'active';
  await franchise.save();
  return franchise;
};

const routePaidCallback = async (payment) => {
  if (!payment || !DAIRY_FRANCHISE_PAYMENT_SUBJECTS.includes(payment.paymentFrom)) return false;
  await applyJoiningFeePayment(payment);
  return true;
};

const routeFailedCallback = async (payment) => {
  if (!payment || !DAIRY_FRANCHISE_PAYMENT_SUBJECTS.includes(payment.paymentFrom)) return false;
  if (!payment.dairyFranchise) return true;

  const franchise = await DairyFranchise.findById(payment.dairyFranchise);
  if (!franchise || franchise.joiningFeePaymentStatus === 'paid') return true;

  const paymentId = payment._id || payment.id;
  if (String(franchise.joiningFeePaymentInitiation || '') === String(paymentId || '')) {
    franchise.joiningFeePaymentStatus = 'failed';
    franchise.joiningFeePaymentInitiation = undefined;
    await franchise.save();
  }
  return true;
};

module.exports = {
  DAIRY_FRANCHISE_PAYMENT_SUBJECTS,
  initiateJoiningFeePayment,
  applyJoiningFeePayment,
  routePaidCallback,
  routeFailedCallback,
};
