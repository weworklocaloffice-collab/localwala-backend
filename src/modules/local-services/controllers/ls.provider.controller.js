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
const Provider = require('../models/localservice.provider.model');
const Offering = require('../models/localservice.offering.model');
const Service = require('../models/localservice.service.model');

const PROVIDER_TRANSITIONS = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'SUBMITTED'],
  APPROVED: ['ACTIVE', 'SUSPENDED'],
  ACTIVE: ['SUSPENDED', 'INACTIVE'],
  SUSPENDED: ['ACTIVE', 'INACTIVE'],
  INACTIVE: ['ACTIVE'],
  REJECTED: ['DRAFT'],
  CLOSED: [],
};

const registerProvider = catchAsync(async (req, res) => {
  const doc = await Provider.create({ owner: req.user._id, ...req.body, status: 'DRAFT', bookable: false });
  res.status(httpStatus.CREATED).send({ provider: doc });
});

const myProvider = catchAsync(async (req, res) => {
  const doc = await Provider.findOne({ owner: req.user._id }).sort({ createdAt: -1 });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  res.status(httpStatus.OK).send({ provider: doc });
});

const adminListProviders = catchAsync(async (req, res) => {
  const filter = { ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Provider.paginate(filter, options));
});

const adminGetProvider = catchAsync(async (req, res) => {
  const doc = await Provider.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  res.status(httpStatus.OK).send({ provider: doc });
});

const adminListOfferings = catchAsync(async (req, res) => {
  const filter = { ...pick(req.query, ['status', 'provider', 'service']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Offering.paginate(filter, options));
});

const adminListDocuments = catchAsync(async (req, res) => {
  const Document = require('../models/localservice.document.model');
  const filter = { ...pick(req.query, ['status', 'provider']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Document.paginate(filter, options));
});

const submitProvider = catchAsync(async (req, res) => {
  const doc = await Provider.findOne({ _id: req.params.id, owner: req.user._id });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  if (doc.status !== 'DRAFT' && doc.status !== 'REJECTED') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only drafts can be submitted');
  }
  doc.status = 'SUBMITTED';
  await doc.save();
  res.status(httpStatus.OK).send({ provider: doc });
});

const transitionProvider = catchAsync(async (req, res) => {
  const doc = await Provider.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  const allowed = PROVIDER_TRANSITIONS[doc.status] || [];
  if (!allowed.includes(req.params.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Illegal provider transition ${doc.status} -> ${req.params.status}`);
  }
  doc.status = req.params.status;
  if (req.params.status === 'ACTIVE') doc.bookable = true;
  if (req.params.status === 'SUSPENDED' || req.params.status === 'INACTIVE') doc.bookable = false;
  if (req.params.status === 'REJECTED') doc.rejectReason = req.body.reason || 'rejected';
  await doc.save();
  res.status(httpStatus.OK).send({ provider: doc });
});

const createOffering = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id, status: { $in: ['APPROVED', 'ACTIVE'] } });
  if (!provider) throw new ApiError(httpStatus.FORBIDDEN, 'Provider not approved');
  const service = await Service.findById(req.body.service);
  if (!service || service.status !== 'active') throw new ApiError(httpStatus.BAD_REQUEST, 'Service not active');
  if (Number(req.body.price) < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Price must be >= 0');
  try {
    require('../services/localservice.pricing.service').assertPriceBand(req.body.price, service.minPrice, service.maxPrice);
  } catch (e) {
    throw new ApiError(httpStatus.BAD_REQUEST, e.message);
  }
  const doc = await Offering.create({ provider: provider._id, ...req.body, status: 'draft' });
  res.status(httpStatus.CREATED).send({ offering: doc });
});

const submitOffering = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const doc = await Offering.findOne({ _id: req.params.id, provider: provider._id });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Offering not found');
  if (doc.status !== 'draft') throw new ApiError(httpStatus.BAD_REQUEST, 'Only drafts can be submitted');
  doc.status = 'pending';
  await doc.save();
  res.status(httpStatus.OK).send({ offering: doc });
});

const listMyOfferings = catchAsync(async (req, res) => {  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const filter = { provider: provider._id, ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Offering.paginate(filter, options));
});

const OFFERING_TRANSITIONS = {
  draft: ['pending', 'inactive'],
  pending: ['active', 'inactive'],
  active: ['inactive'],
  inactive: ['active'],
};

const transitionOffering = catchAsync(async (req, res) => {
  const doc = await Offering.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Offering not found');
  const allowed = OFFERING_TRANSITIONS[doc.status] || [];
  if (!allowed.includes(req.params.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Illegal offering transition ${doc.status} -> ${req.params.status}`);
  }
  doc.status = req.params.status;
  doc.configVersion += 1;
  await doc.save();
  res.status(httpStatus.OK).send({ offering: doc });
});

const PARTNER_ALLOWED = ['PENDING_PROVIDER', 'ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];const partnerTransitionBooking = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id, status: 'ACTIVE' });
  if (!provider) throw new ApiError(httpStatus.FORBIDDEN, 'Provider not active');
  const Booking = require('../models/localservice.booking.model');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  // Ownership guard: booking must belong to this provider (by provider id or linked business).
  const owns =
    String(booking.provider || '') === String(provider._id) ||
    (provider.business && String(booking.provider || '') === String(provider.business));
  if (!owns) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  if (!PARTNER_ALLOWED.includes(req.params.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Partner cannot move to ' + req.params.status);
  }
  const bookingService = require('../services/localservice.booking.service');
  const { booking: updated, revenue } = await bookingService.transitionBooking(
    booking._id,
    req.params.status,
    { reason: req.body.reason, actorType: 'provider', actorId: req.user._id }
  );
  res.status(httpStatus.OK).send({ booking: updated, revenue: revenue ? { deduped: revenue.deduped } : null });
});

const getBookingDetail = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const Booking = require('../models/localservice.booking.model');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  const owns =
    String(booking.provider || '') === String(provider._id) ||
    (provider.business && String(booking.provider || '') === String(provider.business));
  if (!owns) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  const Quote = require('../models/localservice.quote.model');
  const { LocalServiceAssignment } = require('../models/localservice.fulfilment.model');
  const History = require('../models/localservice.status.history.model');
  const [quotes, assignment, history] = await Promise.all([
    Quote.find({ booking: booking._id }).sort({ createdAt: -1 }),
    LocalServiceAssignment.findOne({ booking: booking._id }),
    History.find({ booking: booking._id }).sort({ createdAt: 1 }),
  ]);
  res.status(httpStatus.OK).send({ booking, quotes, assignment, history });
});

const listMyBookings = catchAsync(async (req, res) => {  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const Booking = require('../models/localservice.booking.model');
  const or = [{ provider: provider._id }];
  if (provider.business) or.push({ provider: provider.business });
  const filter = { $or: or, ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Booking.paginate(filter, options));
});

const releaseAssignment = catchAsync(async (req, res) => {  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const { LocalServiceAssignment } = require('../models/localservice.fulfilment.model');
  const doc = await LocalServiceAssignment.findOne({ booking: req.params.id, provider: provider._id });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Assignment not found');
  doc.status = 'released';
  await doc.save();
  res.status(httpStatus.OK).send({ assignment: doc });
});

const uploadDocument = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const Document = require('../models/localservice.document.model');
  const doc = await Document.create({ provider: provider._id, kind: req.body.kind, fileUrl: req.body.fileUrl, status: 'pending' });
  res.status(httpStatus.CREATED).send({ document: doc });
});

const listMyDocuments = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const Document = require('../models/localservice.document.model');
  const docs = await Document.find({ provider: provider._id }).sort({ createdAt: -1 });
  res.status(httpStatus.OK).send({ results: docs });
});

const verifyDocument = catchAsync(async (req, res) => {  const Document = require('../models/localservice.document.model');
  const doc = await Document.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  if (doc.status === 'verified') throw new ApiError(httpStatus.BAD_REQUEST, 'Already verified (immutable)');
  if (req.params.status === 'verified') {
    doc.status = 'verified';
    doc.verifiedBy = req.user._id;
  } else if (req.params.status === 'rejected') {
    doc.status = 'rejected';
    doc.rejectReason = req.body.reason || 'rejected';
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Use verified|rejected');
  }
  await doc.save();
  res.status(httpStatus.OK).send({ document: doc });
});

const assignBooking = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id, status: 'ACTIVE' });
  if (!provider) throw new ApiError(httpStatus.FORBIDDEN, 'Provider not active');
  const Booking = require('../models/localservice.booking.model');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  const owns =
    String(booking.provider || '') === String(provider._id) ||
    (provider.business && String(booking.provider || '') === String(provider.business));
  if (!owns) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  const { LocalServiceAssignment } = require('../models/localservice.fulfilment.model');
  const doc = await LocalServiceAssignment.findOneAndUpdate(
    { booking: booking._id },
    { booking: booking._id, provider: provider._id, staff: req.body.staff || undefined, resource: req.body.resource || undefined, status: 'assigned' },
    { upsert: true, new: true }
  );
  res.status(httpStatus.OK).send({ assignment: doc });
});

const myEarnings = catchAsync(async (req, res) => {
  // Provider-scoped earnings: entries for this provider's bookings only.
  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const Booking = require('../models/localservice.booking.model');
  const Entry = require('../models/localservice.revenue.entry.model');
  const { fromPaise } = require('../../../utils/money');
  const or = [{ provider: provider._id }];
  if (provider.business) or.push({ provider: provider.business });
  const bookings = await Booking.find({ $or: or }).select('_id').lean();
  const ids = bookings.map((b) => String(b._id));
  const entries = ids.length ? await Entry.find({ bookingId: { $in: ids } }).lean() : [];
  let fees = 0, commission = 0, payable = 0, reversals = 0, customer = 0;
  for (const e of entries) {
    if (e.entryType === 'reversal') {
      reversals += Math.abs(fromPaise(e.platformRevenue));
      continue;
    }
    fees += Math.abs(fromPaise(e.bookingFee));
    commission += Math.abs(fromPaise(e.commissionAmount));
    payable += Math.abs(fromPaise(e.providerPayable));
    customer += Math.abs(fromPaise(e.customerTotal));
  }
  const r2 = (n) => Number(n.toFixed(2));
  res.status(httpStatus.OK).send({
    grossBookingValue: r2(customer),
    bookingFees: r2(fees),
    commission: r2(commission),
    providerPayable: r2(payable),
    reversals: r2(reversals),
    netPayable: r2(payable - 0),
    count: entries.length,
  });
});

module.exports = { registerProvider, myProvider, adminListProviders, adminGetProvider, adminListOfferings, adminListDocuments, submitProvider, transitionProvider, createOffering, listMyOfferings, submitOffering, transitionOffering, partnerTransitionBooking, listMyBookings, getBookingDetail, assignBooking, releaseAssignment, uploadDocument, listMyDocuments, verifyDocument, myEarnings, PROVIDER_TRANSITIONS, OFFERING_TRANSITIONS };
