const Joi = require('joi');

const salesSummaryValidation = {
  query: Joi.object().keys({
    from: Joi.date().allow('', null),
    to: Joi.date().allow('', null),
  }),
};

const settlementSummaryValidation = {
  query: Joi.object().keys({
    from: Joi.date().allow('', null),
    to: Joi.date().allow('', null),
    status: Joi.string().allow('', null),
  }),
};

const complianceSummaryValidation = {
  query: Joi.object().keys({}),
};

module.exports = { salesSummaryValidation, settlementSummaryValidation, complianceSummaryValidation };
