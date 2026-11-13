const LOCATION_REQUIRED_MESSAGE = 'Add the outlet address and map pin to continue setting up your Dairy outlet.';

const validCoordinates = (coordinates) => Array.isArray(coordinates)
  && coordinates.length === 2
  && Number.isFinite(Number(coordinates[0]))
  && Number.isFinite(Number(coordinates[1]))
  && Number(coordinates[0]) >= -180
  && Number(coordinates[0]) <= 180
  && Number(coordinates[1]) >= -90
  && Number(coordinates[1]) <= 90;

const locationRequirements = (business = {}) => {
  const missing = [];
  if (!business.city) missing.push('city');
  if (!business.locality) missing.push('locality');
  if (String(business.address || '').trim().length < 8) missing.push('address');
  if (business.location?.type !== 'Point' || !validCoordinates(business.location?.coordinates)) {
    missing.push('mapPin');
  }
  return { complete: missing.length === 0, missing };
};

module.exports = {
  LOCATION_REQUIRED_MESSAGE,
  validCoordinates,
  locationRequirements,
};
