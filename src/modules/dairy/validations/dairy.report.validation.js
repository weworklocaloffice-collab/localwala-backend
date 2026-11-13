const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

const period = {
  from: Joi.date().iso().allow('', null),
  to: Joi.date().iso().allow('', null),
};

const salesSummaryValidation = {
  query: Joi.object().keys({
    ...period,
    business: Joi.string().custom(objectId),
  }),
};

const partnerSalesValidation = { query: Joi.object().keys(period) };
const salesExportValidation = { query: Joi.object().keys({ from: Joi.date().iso().required(), to: Joi.date().iso().greater(Joi.ref('from')).required(), business: Joi.string().custom(objectId) }) };
const partnerSalesExportValidation = { query: Joi.object().keys({ from: Joi.date().iso().required(), to: Joi.date().iso().greater(Joi.ref('from')).required() }) };

const settlementSummaryValidation = {
  query: Joi.object().keys({
    ...period,
    status: Joi.string().allow('', null),
  }),
};

const complianceSummaryValidation = {
  query: Joi.object().keys({}),
};

module.exports = {
  salesSummaryValidation,
  partnerSalesValidation,
  salesExportValidation,
  partnerSalesExportValidation,
  settlementSummaryValidation,
  complianceSummaryValidation,
};
