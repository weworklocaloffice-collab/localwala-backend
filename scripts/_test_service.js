const { expect, describe, it, before, after, run } = require('./verify.harness');
const mongoose = require('mongoose');

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

describe('Test Entitlement Service', function () {
  before(async function () {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
  });

  after(async function () {
    await mongoose.disconnect().catch(() => {});
  });

  it('should load the entitlement service', async function () {
    const service = require('../../API/src/modules/realestate/services/realestate.listing.entitlement.service');
    console.log('Service loaded:', Object.keys(service));
  });
});

run();