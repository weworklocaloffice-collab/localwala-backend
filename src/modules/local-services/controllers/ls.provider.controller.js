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
const Variant = require('../models/localservice.variant.model');
const { recordAudit } = require('../services/localservice.audit.service');

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

const updateMyProvider = catchAsync(async (req, res) => {
  const doc = await Provider.findOne({ _id: req.params.id, owner: req.user._id });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  const fields = ['businessName', 'businessAddress', 'contactName', 'contactPhone', 'providerType', 'serviceKeys'];
  for (const field of fields) {
    if (req.body[field] !== undefined) doc[field] = req.body[field];
  }
  await doc.save();
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
  const from = doc.status;
  doc.status = req.params.status;
  if (req.params.status === 'ACTIVE') doc.bookable = true;
  if (req.params.status === 'SUSPENDED' || req.params.status === 'INACTIVE') doc.bookable = false;
  if (req.params.status === 'REJECTED') doc.rejectReason = req.body.reason || 'rejected';
  await doc.save();
  await recordAudit(req, {
    event: `provider.${req.params.status.toLowerCase()}`,
    targetType: 'provider',
    targetId: doc._id,
    details: `Provider ${doc.businessName} moved ${from} -> ${req.params.status}`,
    metadata: { from, to: req.params.status, reason: req.body.reason },
  });
  res.status(httpStatus.OK).send({ provider: doc });
});

const createOffering = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id, status: { $in: ['APPROVED', 'ACTIVE'] } }).sort({ createdAt: -1 });
  if (!provider) throw new ApiError(httpStatus.FORBIDDEN, 'Provider not approved');
  const service = await Service.findById(req.body.service);
  if (!service || service.status !== 'active') throw new ApiError(httpStatus.BAD_REQUEST, 'Service not active');
  if (Number(req.body.price) < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Price must be >= 0');
  try {
    require('../services/localservice.pricing.service').assertPriceBand(req.body.price, service.minPrice, service.maxPrice);
  } catch (e) {
    throw new ApiError(httpStatus.BAD_REQUEST, e.message);
  }
  const variantId = req.body.variant || null;
  let variant = null;
  if (variantId) {
    variant = await Variant.findOne({ _id: variantId, service: service._id, status: 'active' });
    if (!variant) throw new ApiError(httpStatus.BAD_REQUEST, 'Variant does not belong to this service');
  } else if (service.pricingMode === 'VARIANT') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Variant required for this service');
  }
  const duplicate = await Offering.exists({ provider: provider._id, service: service._id, variant: variantId });
  if (duplicate) throw new ApiError(httpStatus.CONFLICT, 'Offering already exists for this service/variant');
  const durationMinutes = req.body.durationMinutes != null
    ? req.body.durationMinutes
    : (variant && variant.durationMinutes) || service.baseDurationMinutes || 60;
  let doc;
  try {
    doc = await Offering.create({
      provider: provider._id,
      service: service._id,
      variant: variantId,
      price: req.body.price,
      durationMinutes,
      status: 'draft',
    });
  } catch (e) {
    if (e.code === 11000) {
      throw new ApiError(httpStatus.CONFLICT, 'Offering already exists for this service/variant');
    }
    throw e;
  }
  res.status(httpStatus.CREATED).send({ offering: doc });
});

const updateOffering = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id }).sort({ createdAt: -1 });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const doc = await Offering.findOne({ _id: req.params.id, provider: provider._id });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Offering not found');
  const service = await Service.findById(doc.service);
  if (!service || service.status !== 'active') throw new ApiError(httpStatus.BAD_REQUEST, 'Service not active');
  if (req.body.price !== undefined) {
    try {
      require('../services/localservice.pricing.service').assertPriceBand(req.body.price, service.minPrice, service.maxPrice);
    } catch (e) {
      throw new ApiError(httpStatus.BAD_REQUEST, e.message);
    }
    doc.price = req.body.price;
  }
  if (req.body.durationMinutes !== undefined) doc.durationMinutes = req.body.durationMinutes;
  doc.status = 'draft';
  doc.configVersion += 1;
  await doc.save();
  res.status(httpStatus.OK).send({ offering: doc });
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

const listMyOfferings = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id }).sort({ createdAt: -1 });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  const filter = { provider: provider._id, ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  options.populate = [
    { path: 'service', select: 'key name pricingMode bookingMode baseDurationMinutes' },
    { path: 'variant', select: 'name durationMinutes' },
  ];
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
  const from = doc.status;
  doc.status = req.params.status;
  doc.configVersion += 1;
  await doc.save();
  await recordAudit(req, {
    event: `offering.${req.params.status}`,
    targetType: 'offering',
    targetId: doc._id,
    details: `Offering moved ${from} -> ${req.params.status}`,
    metadata: { from, to: req.params.status, provider: doc.provider, service: doc.service },
  });
  res.status(httpStatus.OK).send({ offering: doc });
});

const activeOfferingServiceKeys = async (providerId) => {
  const offerings = await Offering.find({ provider: providerId, status: 'active' })
    .populate('service', 'key status')
    .lean();
  return offerings
    .filter((o) => o.service && o.service.status === 'active')
    .map((o) => o.service.key);
};

const listOpenBookings = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id, status: 'ACTIVE', bookable: true });
  if (!provider) throw new ApiError(httpStatus.FORBIDDEN, 'Provider not active');
  const serviceKeys = await activeOfferingServiceKeys(provider._id);
  const status = ['REQUESTED', 'PENDING_PROVIDER'].includes(req.query.status)
    ? req.query.status
    : { $in: ['REQUESTED', 'PENDING_PROVIDER'] };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const Booking = require('../models/localservice.booking.model');
  const filter = { provider: null, status, serviceKey: { $in: serviceKeys } };
  res.status(httpStatus.OK).send(await Booking.paginate(filter, options));
});

const claimBooking = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id, status: 'ACTIVE', bookable: true });
  if (!provider) throw new ApiError(httpStatus.FORBIDDEN, 'Provider not active');
  const Booking = require('../models/localservice.booking.model');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (booking.provider) throw new ApiError(httpStatus.CONFLICT, 'Booking already claimed');
  if (!['REQUESTED', 'PENDING_PROVIDER'].includes(booking.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Booking is not open for acceptance');
  }
  if (!booking.serviceKey) throw new ApiError(httpStatus.BAD_REQUEST, 'Booking has no service');
  const service = await Service.findOne({ key: booking.serviceKey, status: 'active' }).lean();
  if (!service) throw new ApiError(httpStatus.BAD_REQUEST, 'Service is not active');
  const offering = await Offering.findOne({ provider: provider._id, service: service._id, status: 'active' }).lean();
  if (!offering) throw new ApiError(httpStatus.FORBIDDEN, 'You do not offer this service');

  // Atomic claim: only one provider can move provider from null to itself.
  const claimed = await Booking.findOneAndUpdate(
    { _id: booking._id, provider: null, status: booking.status },
    { $set: { provider: provider._id, offering: offering._id } },
    { new: true }
  );
  if (!claimed) throw new ApiError(httpStatus.CONFLICT, 'Booking already claimed');

  const { LocalServiceAssignment } = require('../models/localservice.fulfilment.model');
  const bookingService = require('../services/localservice.booking.service');
  try {
    await LocalServiceAssignment.findOneAndUpdate(
      { booking: booking._id },
      { booking: booking._id, provider: provider._id, status: 'assigned' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (claimed.status === 'REQUESTED') {
      await bookingService.transitionBooking(booking._id, 'PENDING_PROVIDER', {
        reason: 'provider claim',
        actorType: 'system',
      });
    }
    const { booking: accepted } = await bookingService.transitionBooking(booking._id, 'ACCEPTED', {
      reason: 'provider accepted',
      actorType: 'provider',
      actorId: req.user._id,
    });
    const assignment = await LocalServiceAssignment.findOne({ booking: booking._id });
    res.status(httpStatus.OK).send({ booking: accepted, assignment });
  } catch (e) {
    await Booking.updateOne(
      { _id: booking._id, provider: provider._id, status: { $in: ['REQUESTED', 'PENDING_PROVIDER'] } },
      { $unset: { provider: 1, offering: 1 } }
    );
    await LocalServiceAssignment.deleteOne({ booking: booking._id, provider: provider._id, status: 'assigned' });
    throw e;
  }
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
    LocalServiceAssignment.findOne({ booking: booking._id })
      .populate('staff', 'name status')
      .populate('resource', 'name kind capacity status'),
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
  doc.releasedAt = new Date();
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
  await recordAudit(req, {
    event: `document.${doc.status}`,
    targetType: 'document',
    targetId: doc._id,
    details: `Document ${doc.type || ''} ${doc.status}`,
    metadata: { status: doc.status, reason: doc.rejectReason, provider: doc.provider },
  });
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
  if (!['PENDING_PROVIDER', 'ACCEPTED', 'CONFIRMED', 'IN_PROGRESS'].includes(booking.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'Booking is not open for allocation');
  }

  const { LocalServiceAssignment } = require('../models/localservice.fulfilment.model');
  const { LocalServiceStaff } = require('../models/localservice.staff.model');
  const Resource = require('../models/localservice.resource.model');
  const Service = require('../models/localservice.service.model');
  const Offering = require('../models/localservice.offering.model');
  const Variant = require('../models/localservice.variant.model');
  const allocation = require('../services/localservice.assignment.service');
  const staffService = require('../services/localservice.staff.service');

  const existing = await LocalServiceAssignment.findOne({ booking: booking._id });
  const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
  const nextStaff = has('staff') ? req.body.staff : existing && existing.staff;
  const nextResource = has('resource') ? req.body.resource : existing && existing.resource;

  const [service, offering, variant] = await Promise.all([
    booking.serviceKey ? Service.findOne({ key: booking.serviceKey }).lean() : null,
    booking.offering ? Offering.findById(booking.offering).lean() : null,
    booking.variant ? Variant.findById(booking.variant).lean() : null,
  ]);
  const window = allocation.bookingWindow(booking, { service, offering: offering || variant });

  if (nextStaff) {
    const staff = await LocalServiceStaff.findOne({ _id: nextStaff, provider: provider._id });
    if (!staff) throw new ApiError(httpStatus.NOT_FOUND, 'Staff not found for this provider');
    if (staff.status !== 'active') throw new ApiError(httpStatus.CONFLICT, 'Staff is inactive');
    if (!staffService.isQualified(staff, { serviceId: service && service._id, serviceKey: booking.serviceKey })) {
      throw new ApiError(httpStatus.CONFLICT, 'Staff is not qualified for this service');
    }
    if (!window) throw new ApiError(httpStatus.BAD_REQUEST, 'Booking has no scheduled time for staff allocation');
    if (!staffService.isStaffAvailableForRange(staff, window.startAt, window.endAt)) {
      throw new ApiError(httpStatus.CONFLICT, 'Staff is not available for this time');
    }
    const overlaps = await LocalServiceAssignment.find({
      staff: staff._id,
      status: 'assigned',
      booking: { $ne: booking._id },
      startAt: { $lt: window.endAt },
      endAt: { $gt: window.startAt },
    });
    allocation.assertStaffFree(overlaps, window.startAt, window.endAt, { excludeBooking: booking._id });
  }

  if (nextResource) {
    const resource = await Resource.findOne({ _id: nextResource, provider: provider._id });
    if (!resource) throw new ApiError(httpStatus.NOT_FOUND, 'Resource not found for this provider');
    if (resource.status !== 'active') throw new ApiError(httpStatus.CONFLICT, 'Resource is inactive');
    if (!window) throw new ApiError(httpStatus.BAD_REQUEST, 'Booking has no scheduled time for resource allocation');
    const bufferMs = (Number(resource.turnaroundMinutes) || 0) * 60000;
    const overlaps = await LocalServiceAssignment.find({
      resource: resource._id,
      status: 'assigned',
      booking: { $ne: booking._id },
      startAt: { $lt: new Date(window.endAt.getTime() + bufferMs) },
      endAt: { $gt: new Date(window.startAt.getTime() - bufferMs) },
    });
    allocation.assertResourceCapacity(overlaps, window.startAt, window.endAt, {
      capacity: resource.capacity,
      bufferMinutes: resource.turnaroundMinutes,
      excludeBooking: booking._id,
    });
  }

  const doc = await LocalServiceAssignment.findOneAndUpdate(
    { booking: booking._id },
    {
      $set: {
        booking: booking._id,
        provider: provider._id,
        staff: nextStaff || null,
        resource: nextResource || null,
        startAt: window ? window.startAt : null,
        endAt: window ? window.endAt : null,
        status: 'assigned',
        releasedAt: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
  await doc.populate([
    { path: 'staff', select: 'name status' },
    { path: 'resource', select: 'name kind capacity status' },
  ]);
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
  let fees = 0, commission = 0, payable = 0, reversals = 0, reversalPayable = 0, customer = 0;
  for (const e of entries) {
    if (e.entryType === 'reversal') {
      reversals += Math.abs(fromPaise(e.platformRevenue));
      reversalPayable += Math.abs(fromPaise(e.providerPayable));
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
    providerReversals: r2(reversalPayable),
    netPayable: r2(payable - reversalPayable),
    count: entries.length,
  });
});

const adminListAssignments = catchAsync(async (req, res) => {
  const { LocalServiceAssignment } = require('../models/localservice.fulfilment.model');
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.booking) filter.booking = req.query.booking;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await LocalServiceAssignment.paginate(filter, options);
  res.status(httpStatus.OK).send(result);
});

module.exports = { registerProvider, myProvider, updateMyProvider, adminListProviders, adminGetProvider, adminListOfferings, adminListDocuments, adminListAssignments, submitProvider, transitionProvider, createOffering, updateOffering, listMyOfferings, submitOffering, transitionOffering, listOpenBookings, claimBooking, partnerTransitionBooking, listMyBookings, getBookingDetail, assignBooking, releaseAssignment, uploadDocument, listMyDocuments, verifyDocument, myEarnings, PROVIDER_TRANSITIONS, OFFERING_TRANSITIONS };
