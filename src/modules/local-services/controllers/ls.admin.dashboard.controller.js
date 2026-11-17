const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const { adminDashboard } = require('../services/localservice.dashboard.service');

const getAdminDashboard = catchAsync(async (req, res) => {
  const summary = await adminDashboard({ from: req.query.from, to: req.query.to });
  res.status(httpStatus.OK).send(summary);
});

module.exports = { getAdminDashboard };
