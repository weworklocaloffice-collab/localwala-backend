const catchAsync = require('../../../utils/catchAsync');
const profileService = require('../services/dairy.profile.service');

const list = catchAsync(async (req, res) => {
  const outlets = await profileService.listActorBusinesses(req.user._id);
  res.send({ outlets: outlets.map(({ business, access, agreementStatus }) => ({
    id: business._id,
    name: business.name,
    businessModel: business.businessModel,
    verified: business.verified === true,
    address: business.address || '',
    city: business.city,
    locality: business.locality,
    access,
    agreementStatus,
  })) });
});

const select = catchAsync(async (req, res) => {
  const selected = await profileService.selectActorBusiness(req.user._id, req.body.business);
  res.send({ outlet: selected.outlet, access: selected.access, agreementStatus: selected.agreementStatus });
});

module.exports = { list, select };
