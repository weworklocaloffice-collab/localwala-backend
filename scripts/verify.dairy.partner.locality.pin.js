const assert = require('assert');
const { Locality } = require('../src/models');
const {
  distanceKm,
  ensurePinNearRegisteredLocality,
} = require('../src/modules/dairy/services/dairy.partner.profile.service');

const localities = [
  { _id: 'alwal', name: 'Alwal', location: { coordinates: [78.512, 17.515] } },
  { _id: 'balanagar', name: 'Balanagar', location: { coordinates: [78.55, 17.54] } },
];

const originalFind = Locality.find;
Locality.find = () => ({
  select() { return this; },
  lean: async () => localities,
});

(async () => {
  assert(distanceKm(localities[0].location.coordinates, localities[1].location.coordinates) > 0);
  await assert.doesNotReject(() => ensurePinNearRegisteredLocality({
    locality: { _id: 'alwal' },
    city: 'hyderabad',
    coordinates: [78.512, 17.515],
  }));
  await assert.rejects(() => ensurePinNearRegisteredLocality({
    locality: { _id: 'alwal' },
    city: 'hyderabad',
    coordinates: [78.55, 17.54],
  }), /closer to Balanagar/);
  console.log('Dairy outlet locality pin checks passed.');
})().finally(() => {
  Locality.find = originalFind;
});
