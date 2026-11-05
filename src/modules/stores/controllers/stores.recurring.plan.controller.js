const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const planService = require('../services/stores.recurring.plan.service');

const listPlans = catchAsync(async (req, res) => {
  const result = await planService.listPlans({
    outlet: req.outletId,
    status: req.query.status,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
  });
  res.status(httpStatus.OK).send(result);
});

const getPlan = catchAsync(async (req, res) => {
  const plan = await planService.getPlan(req.params.plan, req.outletId);
  res.status(httpStatus.OK).send({ plan });
});

const createPlan = catchAsync(async (req, res) => {
  const plan = await planService.createPlan({
    outlet: req.outletId,
    chain: req.chainId,
    body: req.body,
  });
  res.status(httpStatus.CREATED).send({ plan });
});

const updatePlan = catchAsync(async (req, res) => {
  const plan = await planService.updatePlan(req.params.plan, req.outletId, req.body);
  res.status(httpStatus.OK).send({ plan });
});

const transitionPlan = catchAsync(async (req, res) => {
  const plan = await planService.transitionPlan(req.params.plan, req.outletId, req.params.status);
  res.status(httpStatus.OK).send({ plan });
});

module.exports = {
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  transitionPlan,
};
