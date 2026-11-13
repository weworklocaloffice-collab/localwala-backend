const { status: httpStatus } = require('http-status');
const {
  Business,
  Locality,
  DairyJoiningRequest,
  DairyPartner,
  DairyFranchise,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { locationRequirements, validCoordinates } = require('./dairy.outlet.location');

const getBusiness = async (businessId) => {
  const business = await Business.findOne({ _id: businessId, vertical: 'dairy', status: true })
    .populate('city', 'name')
    .populate('locality', 'name location');
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Dairy outlet not found');
  return business;
};

const distanceKm = (pointA, pointB) => {
  if (!validCoordinates(pointA) || !validCoordinates(pointB)) return Number.POSITIVE_INFINITY;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const [longitudeA, latitudeA] = pointA.map(Number);
  const [longitudeB, latitudeB] = pointB.map(Number);
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB))
      * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const ensurePinNearRegisteredLocality = async ({ locality, city, coordinates }) => {
  // Locality records currently store a reference point, not a polygon. Use the
  // nearest active locality point as a best-effort guard and describe it as an
  // estimate in the API error/UI; do not present this as a surveyed boundary.
  const localityId = locality?._id || locality;
  const localities = await Locality.find({ city, status: true })
    .select('_id name location')
    .lean();
  const registered = localities.find((item) => String(item._id) === String(localityId));
  if (!registered || !validCoordinates(registered.location?.coordinates)) return;

  const nearest = localities
    .map((item) => ({ item, distance: distanceKm(item.location?.coordinates, coordinates) }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest && String(nearest.item._id) !== String(localityId)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `This pin appears closer to ${nearest.item.name} than your registered locality, ${registered.name}. Move the outlet pin into ${registered.name}.`,
    );
  }
};

const serializeProfile = (business) => {
  const coordinates = business.location?.coordinates;
  const profile = {
    id: String(business._id),
    name: business.name,
    description: business.description || '',
    logo: business.logo || '',
    cover: business.cover || '',
    address: business.address || '',
    city: business.city || null,
    locality: business.locality || null,
    coordinates: validCoordinates(coordinates) ? coordinates.map(Number) : null,
    verified: business.verified === true,
    businessModel: business.businessModel || null,
  };
  const requirements = locationRequirements({ ...business.toObject(), address: profile.address });
  return {
    ...profile,
    locationComplete: requirements.complete,
    missingLocationFields: requirements.missing,
  };
};

const getPartnerBusinessProfile = async (businessId) => {
  const business = await getBusiness(businessId);
  const [request, partnerAgreement, franchiseAgreement] = await Promise.all([
    DairyJoiningRequest.findOne({ business: business._id })
      .sort({ createdAt: -1 })
      .select('address status requestedBusinessModel businessModel assignedBusinessModel'),
    DairyPartner.findOne({ business: business._id }).select('status'),
    DairyFranchise.findOne({ business: business._id }).select(
      'status joiningFee joiningFeePaymentStatus joiningFeePaidAt joiningFeePaymentReference joiningFeePaymentInitiation'
    ),
  ]);
  let profile = {
    ...serializeProfile(business),
    applicationStatus: request?.status || null,
    requestedBusinessModel: request?.requestedBusinessModel || request?.businessModel || null,
    assignedBusinessModel: request?.assignedBusinessModel || business.businessModel || null,
    agreementStatus: partnerAgreement?.status || franchiseAgreement?.status || null,
    joiningFee: franchiseAgreement ? Number(franchiseAgreement.joiningFee || 0) : 0,
    joiningFeePaymentStatus: franchiseAgreement?.joiningFeePaymentStatus || 'not_required',
    joiningFeePaidAt: franchiseAgreement?.joiningFeePaidAt || null,
    joiningFeePaymentReference: franchiseAgreement?.joiningFeePaymentReference || null,
  };
  // Older applications stored address only on the admin review request. Use it
  // to prefill setup, but saving writes it to Business as the canonical value.
  if (!profile.address) {
    if (request?.address) {
      const requirements = locationRequirements(business);
      profile = {
        ...profile,
        address: request.address,
        locationComplete: requirements.complete,
        missingLocationFields: requirements.missing,
      };
    }
  }
  return { profile };
};

const updatePartnerBusinessLocation = async (businessId, payload) => {
  const business = await getBusiness(businessId);
  if (business.verified !== true) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Outlet address and map pin setup becomes available after admin verification');
  }
  if (!business.city || !business.locality) {
    throw new ApiError(httpStatus.CONFLICT, 'Your registered city and primary locality are missing. Contact platform support to correct the outlet registration.');
  }
  const locality = await Locality.findOne({ _id: business.locality._id || business.locality, city: business.city._id || business.city, status: true }).select('_id name location');
  if (!locality) {
    throw new ApiError(httpStatus.CONFLICT, 'Your primary locality is inactive or no longer belongs to this city. Contact platform support.');
  }
  const address = String(payload.address || '').trim();
  const coordinates = payload.coordinates.map(Number);
  if (!validCoordinates(coordinates)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a valid map pin within latitude and longitude limits.');
  }
  await ensurePinNearRegisteredLocality({
    locality,
    city: business.city._id || business.city,
    coordinates,
  });
  business.address = address;
  business.location = { type: 'Point', coordinates };
  await business.save();
  return getPartnerBusinessProfile(businessId);
};

module.exports = {
  serializeProfile,
  distanceKm,
  ensurePinNearRegisteredLocality,
  getPartnerBusinessProfile,
  updatePartnerBusinessLocation,
};
