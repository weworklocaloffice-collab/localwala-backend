const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const getActiveSubscription = async (ownerId, { ProviderModel, SubscriptionModel } = {}) => {
  const LocalServiceProvider = ProviderModel || require('../models/localservice.provider.model');
  const LocalServiceSubscription = SubscriptionModel || require('../models/localservice.growth.model').LocalServiceSubscription;
  const providerQuery = LocalServiceProvider.findOne({ owner: ownerId });
  const provider = typeof providerQuery.lean === 'function' ? await providerQuery.lean() : await providerQuery;
  if (!provider) return null;
  const subscriptionQuery = LocalServiceSubscription.findOne({ provider: provider._id, status: 'active' });
  return typeof subscriptionQuery.lean === 'function' ? await subscriptionQuery.lean() : await subscriptionQuery;
};

const entitlementsOf = (subscription) => {
  const snapshot = subscription && subscription.planSnapshot;
  const values = snapshot && Array.isArray(snapshot.entitlements) ? snapshot.entitlements : [];
  return values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
};

const providerHasEntitlement = async (ownerId, entitlement, deps = {}) => {
  const subscription = await getActiveSubscription(ownerId, deps);
  if (!subscription) return true;
  const requested = String(entitlement || '').trim().toLowerCase();
  if (!requested) return true;
  return entitlementsOf(subscription).includes(requested);
};

const requireEntitlement = async (ownerId, entitlement, deps = {}) => {
  const allowed = await providerHasEntitlement(ownerId, entitlement, deps);
  if (!allowed) {
    throw new ApiError(httpStatus.FORBIDDEN, `Active subscription does not include ${entitlement}`);
  }
  return true;
};

module.exports = {
  getActiveSubscription,
  entitlementsOf,
  providerHasEntitlement,
  requireEntitlement,
};
