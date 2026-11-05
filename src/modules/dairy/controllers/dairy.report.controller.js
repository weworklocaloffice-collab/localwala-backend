const catchAsync = require('../../../utils/catchAsync');
const reportService = require('../services/dairy.report.service');

const salesSummary = catchAsync(async (req, res) => {
  const result = await reportService.salesSummary({ from: req.query.from, to: req.query.to });
  res.send({ report: result });
});

const complianceSummary = catchAsync(async (req, res) => {
  const result = await reportService.complianceSummary();
  res.send({ report: result });
});

const settlementSummary = catchAsync(async (req, res) => {
  const result = await reportService.settlementSummary({
    from: req.query.from,
    to: req.query.to,
    status: req.query.status,
  });
  res.send({ report: result });
});

module.exports = { salesSummary, complianceSummary, settlementSummary };
