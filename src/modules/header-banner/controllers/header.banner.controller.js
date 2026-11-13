const catchAsync = require('../../../utils/catchAsync');
const headerBannerResolver = require('../services/header.banner.resolver.service');

const resolve = catchAsync(async (req, res) => {
  const cityId = req.query.city || req.query.cityId;
  const vertical = req.query.vertical || null;
  const banner = await headerBannerResolver.resolveActiveHeaderBanner(cityId, vertical);
  res.send({ banner });
});

module.exports = { resolve };