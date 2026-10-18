require('dotenv').config();
const mongoose = require('mongoose');
const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const result = await mongoose.connection.collection('verticals').updateOne(
    { key: 'stores' },
    { $set: { 'settings.enabledFeatures.codEnabled': false } },
    { upsert: false }
  );
  console.log(result.modifiedCount);
  await mongoose.disconnect();
};
run().catch((e) => { console.error(e.message); process.exit(1); });