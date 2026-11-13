require('dotenv').config();
const mongoose = require('mongoose');

const verticals = [
  { key: 'food', name: 'Food', description: 'Food delivery', sortOrder: 0 },
  { key: 'dairy', name: 'Dairy', description: 'Milk, curd, ghee, paneer and daily dairy subscriptions', sortOrder: 1 },
  { key: 'stores', name: 'Local Stores', description: 'Nearby stores and chains', sortOrder: 2 },
  { key: 'jhatka', name: 'Jhatka Fresh Meat', description: 'Fresh meat outlets', sortOrder: 3 },
  { key: 'local_services', name: 'Local Services', description: 'Service bookings', sortOrder: 4 },
  { key: 'realestate', name: 'Real Estate', description: 'Property listings, holds, loans and settlements', sortOrder: 5 },
];

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const col = mongoose.connection.collection('verticals');
  for (const v of verticals) {
    const r = await col.updateOne(
      { key: v.key },
      { $setOnInsert: { key: v.key, name: v.name, description: v.description, sortOrder: v.sortOrder, status: true, createdAt: new Date() }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );
    console.log(v.key, r.upsertedCount ? 'created' : 'exists');
  }
  await mongoose.disconnect();
};
run().catch((e) => { console.error(e.message); process.exit(1); });