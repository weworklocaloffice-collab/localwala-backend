const { expect, describe, it, before, after, run } = require('./verify.harness');
const mongoose = require('mongoose');

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

describe('Test Entitlement Service', function () {
  before(async function () {
    console.log('Before hook running...');
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log('Connected to MongoDB');
  });

  after(async function () {
    await mongoose.disconnect().catch(() => {});
  });

  it('should load the entitlement service', async function () {
    console.log('Test running...');
    const service = require('../../API/src/modules/realestate/services/realestate.listing.entitlement.service');
    console.log('Service loaded:', Object.keys(service));
  });
});

run();