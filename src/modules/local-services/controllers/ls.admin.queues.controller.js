const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');

const getQueuesSummary = catchAsync(async (req, res) => {
  const LocalServiceProvider = require('../models/localservice.provider.model');
  const LocalServiceOffering = require('../models/localservice.offering.model');
  const { LocalServiceRefundRequest } = require('../models/localservice.catalog.ext.model');
  const Document = require('../models/localservice.document.model');
  const [applications, documents, offerings, refunds] = await Promise.all([
    LocalServiceProvider.countDocuments({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } }),
    Document.countDocuments({ status: 'pending' }),
    LocalServiceOffering.countDocuments({ status: 'pending' }),
    LocalServiceRefundRequest.countDocuments({ status: 'requested' }),
  ]);
  res.status(httpStatus.OK).send({ applications, documents, offerings, refunds, total: applications + documents + offerings + refunds });
});

module.exports = { getQueuesSummary };
