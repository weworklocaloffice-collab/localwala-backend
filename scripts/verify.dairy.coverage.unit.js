const assert = require('assert');
const { Business, UserAddress, City, Locality, DairyCoverageRequest, DeliveryZone } = require('../src/models');
const coverage = require('../src/modules/dairy/services/dairy.coverage.service');
const transaction = require('../src/utils/optionalTransaction');

const run = async () => {
  const originalDistinct = Business.distinct;
  const originalFindOne = Business.findOne;
  const originalBusinessFind = Business.find;
  const originalAddressFindOne = UserAddress.findOne;
  const originalCityFindById = City.findById;
  const originalLocalityFind = Locality.find;
  const originalDeliveryZoneFindOne = DeliveryZone.findOne;
  const originalRequestFindOne = DairyCoverageRequest.findOne;
  const originalRequestFind = DairyCoverageRequest.find;
  const originalRequestFindById = DairyCoverageRequest.findById;
  const originalRequestCountDocuments = DairyCoverageRequest.countDocuments;
  const originalRequestCreate = DairyCoverageRequest.create;
  let capturedBusinessQuery;
  let capturedAddressQuery;
  let business = { city: 'city-a', locality: 'locality-a', deliveryCoverage: {} };
  let address = { localityRef: 'locality-a', locality: 'Old Town', cityRef: 'city-a' };

  try {
    Business.find = (query) => {
      capturedBusinessQuery = query;
      return {
        select: (fields) => {
          assert.strictEqual(fields, '_id dairyOperations.serviceableLocalities');
          return {
            lean: async () => [
              { _id: 'business-a', dairyOperations: { serviceableLocalities: ['locality-a'] } },
              { _id: 'business-b', dairyOperations: { serviceableLocalities: ['locality-b'] } },
            ],
          };
        },
      };
    };
    const businessIds = await coverage.businessIdsForLocality('locality-a');
    assert.deepStrictEqual(businessIds, ['business-a']);
    assert.strictEqual(capturedBusinessQuery.vertical, 'dairy');
    assert.strictEqual(capturedBusinessQuery.status, true);
    assert(capturedBusinessQuery.$or.some((row) => row['deliveryCoverage.activeLocalities'] === 'locality-a'));
    assert(capturedBusinessQuery.$or.some((row) => row.locality === 'locality-a'));

    Business.findOne = () => ({
      select: () => ({ lean: async () => business }),
    });
    UserAddress.findOne = (query) => {
      capturedAddressQuery = query;
      return { lean: async () => address };
    };

    // Existing outlets retain checkout behavior until their first approval.
    business = { city: 'city-a', locality: 'locality-a', deliveryCoverage: { activeLocalities: [] } };
    assert.strictEqual(await coverage.assertAddressCovered({ businessId: 'business-a', addressId: 'address-a', userId: 'customer-a' }), true);

    business = { city: 'city-a', deliveryCoverage: { activeLocalities: ['locality-a'] } };
    assert.strictEqual(await coverage.assertAddressCovered({ businessId: 'business-a', addressId: 'address-a', userId: 'customer-a' }), true);
    assert.deepStrictEqual(capturedAddressQuery, { _id: 'address-a', user: 'customer-a', status: true });

    address = { localityRef: 'locality-b', locality: 'New Town', cityRef: 'city-a' };
    await assert.rejects(
      coverage.assertAddressCovered({ businessId: 'business-a', addressId: 'address-a', userId: 'customer-a' }),
      (error) => error.statusCode === 409
    );

    transaction.__setTransactionSupport(false);
    const reviewBusiness = {
      _id: 'outlet-requester',
      city: 'city-a',
      locality: 'locality-home',
      deliveryCoverage: { activeLocalities: ['locality-home'] },
      save: async () => {},
    };
    const request = {
      _id: 'request-a',
      business: 'outlet-requester',
      city: 'city-a',
      zone: 'zone-a',
      zoneVersion: 3,
      requestedLocalities: ['locality-kompally', 'locality-dulapally'],
      localityReviews: [],
      status: 'pending',
      save: async () => {},
    };
    DairyCoverageRequest.findById = () => ({ session: () => ({ exec: async () => request }) });
    Business.findOne = () => ({ session: () => reviewBusiness });
    DeliveryZone.findOne = () => ({
      populate() { return this; },
      lean: async () => ({
        _id: 'zone-a', name: 'North Alwal', version: 3,
        localities: [
          { _id: 'locality-kompally' },
          { _id: 'locality-dulapally' },
          { _id: 'locality-home' },
          { _id: 'locality-pending' },
        ],
      }),
    });

    await coverage.reviewCoverageRequest(
      'request-a', 'admin-a', 'locality-kompally', 'approved', ''
    );
    assert.deepStrictEqual(reviewBusiness.deliveryCoverage.activeLocalities, [
      'locality-home', 'locality-kompally',
    ]);
    assert.strictEqual(request.status, 'pending');
    assert.strictEqual(request.localityReviews[0].status, 'approved');
    assert.strictEqual(request.localityReviews[1].status, 'pending');

    await coverage.reviewCoverageRequest(
      'request-a', 'admin-a', 'locality-dulapally', 'rejected', 'Outside current capacity'
    );
    assert.strictEqual(request.status, 'partially_approved');
    assert.strictEqual(request.localityReviews[1].reviewNote, 'Outside current capacity');

    DairyCoverageRequest.find = () => {
      const query = {
        populate() { return this; },
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        lean: async () => [{
          business: { _id: 'outlet-requester', name: 'Requesting outlet' },
          city: { _id: 'city-a', name: 'Hyderabad' },
          requestedLocalities: [{ _id: 'locality-kompally', name: 'Kompally' }],
          localityReviews: [{ locality: { _id: 'locality-kompally', name: 'Kompally' }, status: 'pending' }],
        }],
      };
      return query;
    };
    DairyCoverageRequest.countDocuments = async () => 1;
    Business.find = () => ({
      select: () => ({
        lean: async () => [
          {
            _id: 'outlet-requester',
            name: 'Requesting outlet',
            locality: 'locality-kompally',
            deliveryCoverage: { activeLocalities: ['locality-kompally'] },
          },
          {
            _id: 'outlet-existing',
            name: 'Existing Dairy outlet',
            code: 'DAIRY-22',
            businessModel: 'direct',
            locality: 'locality-kompally',
            deliveryCoverage: { activeLocalities: ['locality-kompally'] },
          },
        ],
      }),
    });
    const listed = await coverage.listCoverageRequests({ status: 'pending' });
    assert.strictEqual(listed.requests[0].localityReviews[0].existingVendorCount, 1);
    assert.strictEqual(listed.requests[0].localityReviews[0].existingVendors[0].name, 'Existing Dairy outlet');

    reviewBusiness.deliveryCoverage = { activeLocalities: ['locality-home'] };
    Business.findOne = async () => reviewBusiness;
    DairyCoverageRequest.findOne = () => {
      const query = {
        populate() { return this; },
        sort() { return this; },
        lean: async () => ({
          status: 'pending',
          requestedLocalities: [{ _id: 'locality-pending', name: 'Pending locality' }],
          localityReviews: [{
            locality: { _id: 'locality-pending', name: 'Pending locality' },
            status: 'pending',
          }],
        }),
      };
      return query;
    };
    Locality.find = () => ({
      select: () => ({ lean: async () => [{ _id: 'locality-home', name: 'Home locality' }] }),
    });
    City.findById = () => ({ select: () => ({ lean: async () => ({ _id: 'city-a', name: 'Hyderabad' }) }) });
    DeliveryZone.findOne = () => ({
      populate() { return this; },
      lean: async () => ({
        _id: 'zone-a', name: 'North Alwal', version: 3,
        localities: [
          { _id: 'locality-kompally', name: 'Kompally' },
          { _id: 'locality-dulapally', name: 'Dulapally' },
          { _id: 'locality-home', name: 'Home locality' },
          { _id: 'locality-pending', name: 'Pending locality' },
        ],
      }),
    });
    const partnerCoverage = await coverage.getPartnerCoverage('outlet-requester');
    assert.strictEqual(partnerCoverage.eligibleZone.name, 'North Alwal');
    assert.strictEqual(partnerCoverage.zoneGroups.length, 1);
    assert.strictEqual(partnerCoverage.zoneGroups[0].name, 'North Alwal');
    assert.strictEqual(partnerCoverage.zoneGroups[0].version, 3);
    assert.deepStrictEqual(
      partnerCoverage.zoneGroups[0].localities.map((locality) => locality.state),
      ['requestable', 'requestable', 'active', 'pending']
    );
    assert.deepStrictEqual(partnerCoverage.nearbyLocalities.map((locality) => locality.id), [
      'locality-kompally', 'locality-dulapally',
    ]);
    assert(!partnerCoverage.nearbyLocalities.some((locality) => locality.id === 'locality-pending'));

    let createdCoverageRequest;
    DairyCoverageRequest.findOne = async () => null;
    DairyCoverageRequest.create = async (payload) => {
      createdCoverageRequest = payload;
      return payload;
    };
    const addedBalanagar = await coverage.requestCoverage(
      'outlet-requester', 'partner-a', { localityIds: ['locality-dulapally'], message: 'Add Balanagar' }
    );
    assert.strictEqual(addedBalanagar.zone, 'zone-a');
    assert.strictEqual(addedBalanagar.zoneVersion, 3);
    assert.deepStrictEqual(createdCoverageRequest.requestedLocalities, ['locality-dulapally']);
    await assert.rejects(
      coverage.requestCoverage('outlet-requester', 'partner-a', { localityIds: ['locality-outside'] }),
      (error) => error.statusCode === 400
    );

    console.log('PASS locality-aware customer visibility and Dairy address enforcement');
    console.log('PASS locality-level coverage review, partial decisions, and incumbent outlet context');
    console.log('PASS Dairy zone boundary, zone-locality requests, and locality review states');
  } finally {
    Business.distinct = originalDistinct;
    Business.findOne = originalFindOne;
    Business.find = originalBusinessFind;
    UserAddress.findOne = originalAddressFindOne;
    City.findById = originalCityFindById;
    Locality.find = originalLocalityFind;
    DeliveryZone.findOne = originalDeliveryZoneFindOne;
    DairyCoverageRequest.findOne = originalRequestFindOne;
    DairyCoverageRequest.find = originalRequestFind;
    DairyCoverageRequest.findById = originalRequestFindById;
    DairyCoverageRequest.countDocuments = originalRequestCountDocuments;
    DairyCoverageRequest.create = originalRequestCreate;
    transaction.__setTransactionSupport(null);
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
