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
const Booking = require('../models/localservice.booking.model');
const Quote = require('../models/localservice.quote.model');
const Reservation = require('../models/localservice.reservation.model');
const bookingService = require('../services/localservice.booking.service');
const availability = require('../services/localservice.availability.service');
const policy = require('../services/localservice.policy.service');
const pricing = require('../services/localservice.pricing.service');

const createBooking = catchAsync(async (req, res) => {
  // Optional pricing block: backend builds items[] + totals from rates.
  let priced = null;
  if (req.body.pricing) {
    priced = pricing.priceBooking(req.body.pricing);
  }
  const booking = await Booking.create({
    bookingCode: bookingService.buildBookingCode(),
    customer: req.user._id,
    ...pick(req.body, ['categoryKey', 'subcategoryKey', 'serviceKey', 'bookingMode', 'scheduledAt', 'startAt', 'endAt', 'address', 'labourAmount', 'partsAmount', 'paymentMode']),
    ...(priced
      ? { labourAmount: priced.subtotal, discountAmount: priced.discount, serviceValue: priced.total, items: priced.items }
      : {}),
    status: 'DRAFT',
  });
  // COD/direct only where the service allows off-gateway collection (looked up
  // by serviceKey; unknown key => gateway only). Direct additionally implies
  // pay_after timing — either flag permits it.
  if ((booking.paymentMode === 'cod' || booking.paymentMode === 'direct') && booking.serviceKey) {
    const Service = require('../models/localservice.service.model');
    const svc = await Service.findOne({ key: booking.serviceKey }).lean();
    const allowed = (svc && svc.allowedPaymentModes) || [];
    const okMode = booking.paymentMode === 'cod' ? allowed.includes('cod') : allowed.includes('cod') || allowed.includes('pay_after');
    if (!okMode) {
      await Booking.deleteOne({ _id: booking._id });
      throw new ApiError(httpStatus.BAD_REQUEST, 'Off-gateway collection is not enabled for this service');
    }
  }
  // Slot lock: hold capacity for 15 min before payment (realestate hold pattern).
  if (req.body.bookingMode === 'SLOT' || req.body.bookingMode === 'DATE_RANGE') {
    const startAt = req.body.startAt || req.body.scheduledAt;
    const endAt = req.body.endAt || new Date(new Date(startAt).getTime() + 60 * 60000);
    const existing = await Reservation.find({ resource: req.body.resource || null, status: { $in: ['held', 'confirmed'] } });
    availability.assertSlotFree(existing, startAt, endAt, 10);
    await Reservation.create({
      booking: booking._id,
      resource: req.body.resource || undefined,
      startAt,
      endAt,
      status: 'held',
      expiresAt: new Date(Date.now() + 15 * 60000),
    });
  }
  res.status(httpStatus.CREATED).send({ booking });
});

const transitionBooking = catchAsync(async (req, res) => {
  const { booking, revenue } = await bookingService.transitionBooking(
    req.params.id,
    req.params.status,
    { reason: req.body.reason, actorType: 'customer', actorId: req.user._id }
  );
  res.status(httpStatus.OK).send({ booking, revenue: revenue ? { deduped: revenue.deduped } : null });
});

const submitQuote = catchAsync(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  // Quotes are a provider act: caller must own the booking (both mounts require partner auth).
  const Provider = require('../models/localservice.provider.model');
  const provider = await Provider.findOne({ owner: req.user._id });
  const owns =
    provider &&
    (String(booking.provider || '') === String(provider._id) ||
      (provider.business && String(booking.provider || '') === String(provider.business)));
  if (!owns) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  const quote = await Quote.create({ booking: booking._id, ...req.body, status: 'SUBMITTED' });
  res.status(httpStatus.CREATED).send({ quote });
});

const acceptQuote = catchAsync(async (req, res) => {
  const quote = await Quote.findById(req.params.id);
  if (!quote) throw new ApiError(httpStatus.NOT_FOUND, 'Quote not found');
  if (quote.status !== 'SUBMITTED') throw new ApiError(httpStatus.BAD_REQUEST, 'Quote not actionable');
  if (new Date() > new Date(quote.expiresAt)) {
    quote.status = 'EXPIRED';
    await quote.save();
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quote expired');
  }
  quote.status = 'ACCEPTED';
  await quote.save();
  await Booking.findByIdAndUpdate(quote.booking, { labourAmount: quote.labourAmount, partsAmount: quote.partsAmount });
  res.status(httpStatus.OK).send({ quote });
});

const reviseQuote = catchAsync(async (req, res) => {
  // Provider revises: previous terms preserved in revisions[], version bumps,
  // status returns to SUBMITTED for customer re-acceptance.
  const quote = await Quote.findById(req.params.id);
  if (!quote) throw new ApiError(httpStatus.NOT_FOUND, 'Quote not found');
  if (quote.status !== 'SUBMITTED' && quote.status !== 'REVISED') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only pending quotes can be revised');
  }
  quote.revisions.push({ version: quote.version, labourAmount: quote.labourAmount, partsAmount: quote.partsAmount, note: req.body.note || undefined, createdAt: new Date() });
  quote.version += 1;
  quote.labourAmount = req.body.labourAmount;
  quote.partsAmount = req.body.partsAmount;
  if (req.body.scopeOfWork !== undefined) quote.scopeOfWork = req.body.scopeOfWork;
  quote.expiresAt = req.body.expiresAt;
  quote.status = 'SUBMITTED';
  await quote.save();
  res.status(httpStatus.OK).send({ quote });
});

const rescheduleBooking = catchAsync(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (String(booking.customer) !== String(req.user._id)) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  const startAt = booking.startAt || booking.scheduledAt;
  if (!policy.canReschedule({ startAt, cutoffHours: 24 })) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Reschedule window closed (24h cutoff)');
  }
  const newStart = req.body.startAt || req.body.scheduledAt;
  const newEnd = req.body.endAt || new Date(new Date(newStart).getTime() + 60 * 60000);
  const existing = await Reservation.find({ status: { $in: ['held', 'confirmed'] }, booking: { $ne: booking._id } });
  availability.assertSlotFree(existing, newStart, newEnd, 10);
  booking.scheduledAt = req.body.scheduledAt || booking.scheduledAt;
  booking.startAt = req.body.startAt || booking.startAt;
  booking.endAt = req.body.endAt || booking.endAt;
  await booking.save();
  res.status(httpStatus.OK).send({ booking });
});

const disputeBooking = catchAsync(async (req, res) => {
  // Moves IN_PROGRESS/COMPLETED -> DISPUTED; settlement must hold payout while disputed.
  const existing = await Booking.findById(req.params.id);
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (String(existing.customer) !== String(req.user._id)) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  const { booking } = await bookingService.transitionBooking(
    req.params.id,
    'DISPUTED',
    { reason: req.body.reason || 'disputed', actorType: 'customer', actorId: req.user._id },
    { revenueHook: false }
  );
  res.status(httpStatus.OK).send({ booking });
});

const submitReview = catchAsync(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (String(booking.customer) !== String(req.user._id)) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  if (booking.status !== 'COMPLETED') throw new ApiError(httpStatus.BAD_REQUEST, 'Only completed bookings can be reviewed');
  const { LocalServiceReview } = require('../models/localservice.fulfilment.model');
  const rating = Number(req.body.rating);
  if (!(rating >= 1 && rating <= 5)) throw new ApiError(httpStatus.BAD_REQUEST, 'Rating must be 1-5');
  const review = await LocalServiceReview.findOneAndUpdate(
    { booking: booking._id },
    { booking: booking._id, provider: booking.provider, customer: req.user._id, rating, comment: req.body.comment || undefined },
    { upsert: true, new: true }
  );
  res.status(httpStatus.OK).send({ review });
});

const getInvoice = catchAsync(async (req, res) => {
  const { LocalServiceInvoice } = require('../models/localservice.fulfilment.model');
  const invoice = await LocalServiceInvoice.findOne({ booking: req.params.id });
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
  res.status(httpStatus.OK).send({ invoice });
});

const voidInvoice = catchAsync(async (req, res) => {
  const { LocalServiceInvoice } = require('../models/localservice.fulfilment.model');
  const invoice = await LocalServiceInvoice.findOne({ booking: req.params.id });
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
  if (invoice.status === 'void') return res.status(httpStatus.OK).send({ invoice });
  invoice.status = 'void';
  await invoice.save();
  res.status(httpStatus.OK).send({ invoice });
});

const listReviews = catchAsync(async (req, res) => {
  const { LocalServiceReview } = require('../models/localservice.fulfilment.model');
  const filter = { ...pick(req.query, ['provider']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceReview.paginate(filter, options));
});

const createComplaint = catchAsync(async (req, res) => {
  const { LocalServiceComplaint } = require('../models/localservice.fulfilment.model');
  const doc = await LocalServiceComplaint.create({ raisedBy: req.user._id, ...pick(req.body, ['booking', 'reason']) });
  res.status(httpStatus.CREATED).send({ complaint: doc });
});

const listMyComplaints = catchAsync(async (req, res) => {
  const { LocalServiceComplaint } = require('../models/localservice.fulfilment.model');
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceComplaint.paginate({ raisedBy: req.user._id }, options));
});

const listAllComplaints = catchAsync(async (req, res) => {
  const { LocalServiceComplaint } = require('../models/localservice.fulfilment.model');
  const filter = { ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceComplaint.paginate(filter, options));
});

const resolveComplaint = catchAsync(async (req, res) => {
  const { LocalServiceComplaint } = require('../models/localservice.fulfilment.model');
  const doc = await LocalServiceComplaint.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Complaint not found');
  doc.status = 'resolved';
  await doc.save();
  res.status(httpStatus.OK).send({ complaint: doc });
});

const listMyBookings = catchAsync(async (req, res) => {
  const filter = { customer: req.user._id, ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Booking.paginate(filter, options));
});

const getMyBooking = catchAsync(async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.id, customer: req.user._id });
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  res.status(httpStatus.OK).send({ booking });
});

const adminListBookings = catchAsync(async (req, res) => {
  const filter = { ...pick(req.query, ['status', 'provider', 'categoryKey', 'serviceKey']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Booking.paginate(filter, options));
});

const adminGetBooking = catchAsync(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  const History = require('../models/localservice.status.history.model');
  const history = await History.find({ booking: booking._id }).sort({ createdAt: 1 });
  res.status(httpStatus.OK).send({ booking, history });
});

const adminListRefunds = catchAsync(async (req, res) => {
  const { LocalServiceRefundRequest } = require('../models/localservice.catalog.ext.model');
  const filter = { ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceRefundRequest.paginate(filter, options));
});

const decideRefund = catchAsync(async (req, res) => {
  const { LocalServiceRefundRequest } = require('../models/localservice.catalog.ext.model');
  const doc = await LocalServiceRefundRequest.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Refund request not found');
  if (doc.status !== 'requested') throw new ApiError(httpStatus.BAD_REQUEST, `Already ${doc.status}`);
  if (req.body.decision === 'rejected') {
    doc.status = 'rejected';
    await doc.save();
    return res.status(httpStatus.OK).send({ refund: doc });
  }
  if (req.body.decision !== 'approved') throw new ApiError(httpStatus.BAD_REQUEST, 'Use approved|rejected');
  doc.status = 'approved';
  doc.approvedAmount = doc.requestedAmount;
  await doc.save();
  // Ledger reversal follows approval (original payment untouched). Gateway
  // refund itself is manual today — gatewayRef recorded when supplied.
  const { reverseRevenueForBooking } = require('../services/localservice.revenue.booking.service');
  try {
    await reverseRevenueForBooking({ bookingId: String(doc.booking), reason: doc.reason || 'refund-approved', actorId: req.user._id });
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }
  if (req.body.gatewayRefundReference) {
    doc.gatewayRefundReference = req.body.gatewayRefundReference;
    doc.status = 'completed';
    await doc.save();
  }
  res.status(httpStatus.OK).send({ refund: doc });
});

module.exports = { createBooking, transitionBooking, submitQuote, acceptQuote, reviseQuote, rescheduleBooking, disputeBooking, submitReview, listReviews, getInvoice, voidInvoice, createComplaint, listMyComplaints, listAllComplaints, resolveComplaint, listMyBookings, getMyBooking, adminListBookings, adminGetBooking, adminListRefunds, decideRefund };
