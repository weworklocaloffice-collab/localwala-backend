const catchAsync = require('../../../utils/catchAsync');
const coverageService = require('../services/dairy.coverage.service');

const partnerCoverage = catchAsync(async (req, res) => {
  res.send({ coverage: await coverageService.getPartnerCoverage(req.outletId) });
});

const createRequest = catchAsync(async (req, res) => {
  const request = await coverageService.requestCoverage(req.outletId, req.user._id, req.body);
  res.status(201).send({ request });
});

const listRequests = catchAsync(async (req, res) => {
  res.send(await coverageService.listCoverageRequests(req.query));
});

const reviewRequest = catchAsync(async (req, res) => {
  const request = await coverageService.reviewCoverageRequest(
    req.params.request,
    req.user._id,
    req.body.localityId,
    req.body.decision,
    req.body.note
  );
  res.send({ request });
});

module.exports = { partnerCoverage, createRequest, listRequests, reviewRequest };
