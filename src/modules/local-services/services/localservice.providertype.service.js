const LocalServiceProviderType = require('../models/localservice.providertype.model');

const DEFAULT_TYPES = [
  { key: 'independent', label: 'Independent', sortOrder: 10 },
  { key: 'business', label: 'Business', sortOrder: 20 },
  { key: 'salon', label: 'Salon', sortOrder: 30 },
  { key: 'hotel', label: 'Hotel', sortOrder: 40 },
  { key: 'rental', label: 'Rental', sortOrder: 50 },
  { key: 'trainer', label: 'Trainer', sortOrder: 60 },
  { key: 'multi_location', label: 'Multi location', sortOrder: 70 },
];

const ensureDefaults = async () => {
  const count = await LocalServiceProviderType.estimatedDocumentCount();
  if (count > 0) return;
  await LocalServiceProviderType.bulkWrite(
    DEFAULT_TYPES.map((type) => ({
      updateOne: {
        filter: { key: type.key },
        update: { $setOnInsert: { ...type, active: true } },
        upsert: true,
      },
    }))
  );
};

const listActive = async () => {
  await ensureDefaults();
  return LocalServiceProviderType.find({ active: true }).sort({ sortOrder: 1, label: 1 }).lean();
};

const listAll = async () => {
  await ensureDefaults();
  return LocalServiceProviderType.find({}).sort({ sortOrder: 1, label: 1 }).lean();
};

const isActiveType = async (key) => {
  await ensureDefaults();
  const exists = await LocalServiceProviderType.exists({
    key: String(key).trim().toLowerCase(),
    active: true,
  });
  return Boolean(exists);
};

module.exports = { DEFAULT_TYPES, ensureDefaults, listActive, listAll, isActiveType };
