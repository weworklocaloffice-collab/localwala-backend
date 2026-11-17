const mongoose = require('mongoose');
const LocalServiceProvider = require('../models/localservice.provider.model');
const LocalServiceOffering = require('../models/localservice.offering.model');
const LocalServiceDocument = require('../models/localservice.document.model');
const {
  LocalServiceStaff,
  LocalServiceAvailabilityRule,
  LocalServiceCoverage,
} = require('../models/localservice.staff.model');
const LocalServiceResource = require('../models/localservice.resource.model');
const { LocalServiceAssignment, LocalServiceReview } = require('../models/localservice.fulfilment.model');
const {
  LocalServiceSubscription,
  LocalServiceFeaturedPlacement,
} = require('../models/localservice.growth.model');
const {
  LocalServiceMarketingCampaign,
  LocalServiceMarketingEvent,
} = require('../models/localservice.marketing.model');
const LocalServiceLead = require('../models/localservice.lead.model');
const LocalServicePolicy = require('../models/localservice.policy.model');
const LocalServiceRecurringAgreement = require('../models/localservice.recurring.agreement.model');
const LocalServiceRecurringOccurrence = require('../models/localservice.recurring.occurrence.model');
const LocalServiceReservation = require('../models/localservice.reservation.model');
const LocalServiceQuote = require('../models/localservice.quote.model');

const purgeProviderData = async (providers) => {
  const ids = (providers || []).map((provider) => provider._id).filter(Boolean);
  if (!ids.length) return { providers: 0, deleted: {} };

  const agreements = await LocalServiceRecurringAgreement.find({ provider: { $in: ids } })
    .select('_id')
    .lean();
  const agreementIds = agreements.map((agreement) => agreement._id);

  const ops = {
    offerings: LocalServiceOffering.deleteMany({ provider: { $in: ids } }),
    documents: LocalServiceDocument.deleteMany({ provider: { $in: ids } }),
    staffs: LocalServiceStaff.deleteMany({ provider: { $in: ids } }),
    availabilityRules: LocalServiceAvailabilityRule.deleteMany({ provider: { $in: ids } }),
    coverages: LocalServiceCoverage.deleteMany({ provider: { $in: ids } }),
    resources: LocalServiceResource.deleteMany({ provider: { $in: ids } }),
    assignments: LocalServiceAssignment.deleteMany({ provider: { $in: ids } }),
    reviews: LocalServiceReview.deleteMany({ provider: { $in: ids } }),
    subscriptions: LocalServiceSubscription.deleteMany({ provider: { $in: ids } }),
    featured: LocalServiceFeaturedPlacement.deleteMany({ provider: { $in: ids } }),
    campaignEvents: LocalServiceMarketingEvent.deleteMany({ provider: { $in: ids } }),
    campaigns: LocalServiceMarketingCampaign.deleteMany({ provider: { $in: ids } }),
    leads: LocalServiceLead.deleteMany({ provider: { $in: ids } }),
    policies: LocalServicePolicy.deleteMany({ provider: { $in: ids } }),
    recurringAgreements: LocalServiceRecurringAgreement.deleteMany({ _id: { $in: agreementIds } }),
    recurringOccurrences: LocalServiceRecurringOccurrence.deleteMany({ agreement: { $in: agreementIds } }),
    reservations: LocalServiceReservation.deleteMany({ provider: { $in: ids } }),
    quotes: LocalServiceQuote.deleteMany({ provider: { $in: ids } }),
  };

  const keys = Object.keys(ops);
  const results = await Promise.all(keys.map((key) => ops[key]));
  const deleted = {};
  keys.forEach((key, index) => {
    deleted[key] = results[index].deletedCount || 0;
  });

  await LocalServiceProvider.deleteMany({ _id: { $in: ids } });
  return { providers: ids.length, deleted };
};

const purgeProvidersForUsers = async (userIds) => {
  const ids = (userIds || [])
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!ids.length) return { providers: 0, deleted: {} };
  const providers = await LocalServiceProvider.find({ owner: { $in: ids } }).select('_id').lean();
  return purgeProviderData(providers);
};

const findOrphanProviders = async () => {
  return LocalServiceProvider.aggregate([
    { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'ownerDocs' } },
    { $match: { ownerDocs: { $size: 0 } } },
    {
      $project: {
        _id: 1,
        businessName: 1,
        status: 1,
        contactPhone: 1,
        owner: 1,
        createdAt: 1,
      },
    },
  ]);
};

const purgeOrphanProviders = async ({ dryRun = true } = {}) => {
  const providers = await findOrphanProviders();
  if (dryRun) return { providers, purged: false };
  const result = await purgeProviderData(providers);
  return { providers, purged: true, ...result };
};

const safePurgeForUsers = async (userIds) => {
  try {
    return await purgeProvidersForUsers(userIds);
  } catch (error) {
    console.error('[localservices] provider cascade cleanup failed:', error.message);
    return { providers: 0, deleted: {}, error: error.message };
  }
};

module.exports = {
  purgeProviderData,
  purgeProvidersForUsers,
  findOrphanProviders,
  purgeOrphanProviders,
  safePurgeForUsers,
};
