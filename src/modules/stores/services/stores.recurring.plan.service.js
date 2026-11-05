const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');

const StoreRecurringPlan = () => mongoose.model('StoreRecurringPlan');

const listPlans = async ({ outlet, status, page = 1, limit = 20 }) => {
  const filter = { outlet };
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    StoreRecurringPlan().find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreRecurringPlan().countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getPlan = async (planId, outlet) => {
  const plan = await StoreRecurringPlan().findOne({ _id: planId, outlet }).lean();
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
  return plan;
};

const createPlan = async ({ outlet, chain, body }) => {
  const plan = await StoreRecurringPlan().create({
    outlet,
    chain,
    name: body.name,
    description: body.description,
    image: body.image,
    items: body.items,
    price: body.price,
    compareAt: body.compareAt,
    discountPercentage: body.discountPercentage,
    cadence: body.cadence,
    deliveryDayOfWeek: body.deliveryDayOfWeek,
    deliverySlot: body.deliverySlot,
    serviceLocalities: body.serviceLocalities,
    maxSubscribers: body.maxSubscribers,
    substitutionPolicy: body.substitutionPolicy || 'none',
    status: 'draft',
  });
  return plan.toObject();
};

const updatePlan = async (planId, outlet, body) => {
  const plan = await StoreRecurringPlan().findOne({ _id: planId, outlet });
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
  if (plan.status === 'archived') throw new ApiError(httpStatus.CONFLICT, 'Cannot edit an archived plan');
  const allowed = ['name', 'description', 'image', 'items', 'price', 'compareAt', 'discountPercentage', 'cadence', 'deliveryDayOfWeek', 'deliverySlot', 'serviceLocalities', 'maxSubscribers', 'substitutionPolicy'];
  for (const key of allowed) {
    if (body[key] !== undefined) plan[key] = body[key];
  }
  await plan.save();
  return plan.toObject();
};

const transitionPlan = async (planId, outlet, status) => {
  const plan = await StoreRecurringPlan().findOne({ _id: planId, outlet });
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
  if (!['draft', 'active', 'paused', 'archived'].includes(status)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status');
  plan.status = status;
  await plan.save();
  return plan.toObject();
};

module.exports = {
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  transitionPlan,
};
