/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const ApiError = require('../../../utils/ApiError');
const Lead = require('../models/localservice.lead.model');
const leadService = require('../services/localservice.lead.service');

let leadSeq = 0;
const buildLeadCode = () => {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  leadSeq += 1;
  return `LD${ymd}${String(leadSeq).padStart(4, '0')}`;
};

const createLead = catchAsync(async (req, res) => {
  // Duplicate guard: same customer+service within 24h returns existing (no double lead fee).
  const since = new Date(Date.now() - 24 * 3600000);
  const dup = await Lead.findOne({ customer: req.user._id, serviceKey: req.body.serviceKey || null, createdAt: { $gte: since } });
  if (dup) return res.status(httpStatus.OK).send({ lead: dup, deduped: true });
  const doc = await Lead.create({ leadCode: buildLeadCode(), customer: req.user._id, ...pick(req.body, ['categoryKey', 'serviceKey', 'description']), status: 'NEW' });
  res.status(httpStatus.CREATED).send({ lead: doc, deduped: false });
});

const listLeads = catchAsync(async (req, res) => {
  const filter = { ...pick(req.query, ['status']) };
  // Customers see own; partners/admins see scoped via query (ownership enforced by caller).
  if (req.user && req.query.mine !== 'false' && !req.query.provider) filter.customer = req.user._id;
  if (req.query.provider) filter.provider = req.query.provider;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Lead.paginate(filter, options));
});

const listAllLeads = catchAsync(async (req, res) => {
  // Admin oversight: no customer scoping, explicit filters only.
  const filter = { ...pick(req.query, ['status', 'provider', 'categoryKey', 'serviceKey']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Lead.paginate(filter, options));
});

const qualifyLead = catchAsync(async (req, res) => {
  // Qualify claims + charges: caller must hold a provider profile, otherwise
  // any authenticated user could mint lead-fee entries against providers.
  const Provider = require('../models/localservice.provider.model');
  const mine = await Provider.findOne({ owner: req.user._id });
  if (!mine) throw new ApiError(httpStatus.FORBIDDEN, 'Provider profile required to qualify leads');
  const { lead, entry, deduped } = await leadService.qualifyLead(req.params.id, { actorId: req.user._id });
  res.status(httpStatus.OK).send({ lead, entryId: entry ? entry._id || entry.idempotencyKey : null, deduped });
});

const invalidateLead = catchAsync(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found');
  lead.status = 'INVALID';
  await lead.save();
  // Credit path: if a fee was charged, reverse it (invalid-lead credit).
  const { reverseRevenueForBooking } = require('../services/localservice.revenue.booking.service');
  let reversal = null;
  try {
    const out = await reverseRevenueForBooking({ bookingId: String(lead._id), reason: 'invalid-lead', actorId: req.user._id });
    reversal = out.length;
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }
  res.status(httpStatus.OK).send({ lead, reversals: reversal });
});

module.exports = { createLead, listLeads, listAllLeads, qualifyLead, invalidateLead, buildLeadCode };
