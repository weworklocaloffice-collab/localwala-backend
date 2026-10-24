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
const Resource = require('../models/localservice.resource.model');
const Service = require('../models/localservice.service.model');
const Provider = require('../models/localservice.provider.model');
const Offering = require('../models/localservice.offering.model');
const Category = require('../models/localservice.category.model');
const Variant = require('../models/localservice.variant.model');
const { LocalServiceAddon } = require('../models/localservice.catalog.ext.model');
const { LocalServiceAvailabilityRule } = require('../models/localservice.staff.model');
const { fromPaise } = require('../../../utils/money');
const bookingService = require('../services/localservice.booking.service');
const availability = require('../services/localservice.availability.service');
const slotlock = require('../services/localservice.slotlock.service');
const policy = require('../services/localservice.policy.service');
const pricing = require('../services/localservice.pricing.service');
const paymentService = require('../services/localservice.payment.service');
const { recordAudit } = require('../services/localservice.audit.service');

const QUOTE_PRICING_MODES = new Set(['QUOTE', 'INSPECTION_QUOTE']);

const createBooking = catchAsync(async (req, res) => {
  // Resolve the catalogue row so category/revenue scope comes from the server,
  // never from whatever the client put in categoryKey.
  const service = await Service.findOne({ key: req.body.serviceKey, status: 'active' }).lean();
  if (!service) throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown or inactive service');

  // REQUEST and quote-priced services may be broadcast without a provider.
  // Everything that has a deterministic price must name the provider whose
  // offering supplies that price.
  const quoteFlow = QUOTE_PRICING_MODES.has(service.pricingMode) || req.body.bookingMode === 'REQUEST';
  let provider = null;
  if (req.body.provider) {
    provider = await Provider.findOne({ _id: req.body.provider, status: 'ACTIVE', bookable: true }).lean();
    if (!provider) throw new ApiError(httpStatus.BAD_REQUEST, 'Provider is not active/bookable');
  } else if (!quoteFlow) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A provider is required for priced services');
  }

  let variant = null;
  if (req.body.variant) {
    variant = await Variant.findOne({ _id: req.body.variant, service: service._id, status: 'active' }).lean();
    if (!variant) throw new ApiError(httpStatus.BAD_REQUEST, 'Variant is not available for this service');
  }
  if (service.pricingMode === 'VARIANT' && !variant) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A variant is required for this service');
  }

  // Provider price lookup. Priced services require an active offering; quote
  // flows can be claimed first and quoted later.
  let offering = null;
  if (provider) {
    const offeringQuery = { provider: provider._id, service: service._id, status: 'active' };
    if (variant) offeringQuery.variant = variant._id;
    else if (service.pricingMode !== 'VARIANT') offeringQuery.variant = null;
    offering = await Offering.findOne(offeringQuery).lean();
    if (!offering && !quoteFlow) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Provider does not offer this service/variant');
    }
  }

  // Add-ons are priced from the catalogue, never from client labels/prices.
  const addonSelections = [];
  if (Array.isArray(req.body.addons) && req.body.addons.length) {
    const ids = req.body.addons.map((a) => a.id);
    const docs = await LocalServiceAddon.find({ _id: { $in: ids }, service: service._id, status: 'active' }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    for (const selection of req.body.addons) {
      const doc = byId.get(String(selection.id));
      if (!doc) throw new ApiError(httpStatus.BAD_REQUEST, 'Add-on is not available for this service');
      addonSelections.push({
        label: doc.name,
        price: fromPaise(doc.price),
        quantity: Number(selection.quantity || 1),
      });
    }
  }

  // Category scope is needed BEFORE pricing: the effective policy (tax,
  // deposit, permitted payment modes) is scoped by it.
  let categoryKey = service.categoryKey || null;
  if (!categoryKey && service.category) {
    const category = await Category.findById(service.category).lean();
    if (category) categoryKey = category.key;
  }
  const policyConfig = require('../services/localservice.policy.config.service');
  const effectivePolicy = await policyConfig.loadEffectivePolicy(
    {
      categoryKey,
      subcategoryKey: req.body.subcategoryKey || null,
      serviceKey: service.key,
      provider: provider ? provider._id : null,
    },
    {
      depositPercent: service.depositPercent,
      allowedPaymentModes: service.allowedPaymentModes,
    }
  );

  let priced = null;
  if (offering || QUOTE_PRICING_MODES.has(service.pricingMode)) {
    const unit = offering && !QUOTE_PRICING_MODES.has(service.pricingMode) ? fromPaise(offering.price) : 0;
    const scheduledStart = req.body.startAt || req.body.scheduledAt;
    const nights =
      req.body.bookingMode === 'DATE_RANGE'
        ? Math.max(
            1,
            Math.ceil(
              (new Date(req.body.endAt).getTime() - new Date(scheduledStart).getTime()) / (24 * 60 * 60 * 1000)
            )
          )
        : 1;
    const paymentMode = req.body.paymentMode || 'gateway';
    const pricingInput = {
      pricingMode: service.pricingMode,
      basePrice: unit,
      variantPrice: unit,
      hourlyRate: unit,
      unitRate: unit,
      nightlyRate: unit,
      hours: Number(req.body.hours || 1),
      quantity: Number(req.body.quantity || 1),
      nights,
      addons: addonSelections,
      discountAmount: 0,
      // Tax comes from the effective policy, never from the client.
      taxPercent: Number(effectivePolicy.taxPercent || 0),
      // Deposits apply to online collection (gateway and wallet). COD/direct
      // settle in full at completion.
      depositPercent:
        paymentMode === 'gateway' || paymentMode === 'wallet'
          ? Number(effectivePolicy.depositPercent || 0)
          : 0,
      minimumCharge: 0,
    };
    if (service.pricingMode === 'INSPECTION_QUOTE') {
      pricingInput.inspection = {
        fee: fromPaise(service.inspectionFee),
        treatment: service.inspectionFeeTreatment || 'additional',
      };
    }
    priced = pricing.priceBooking(pricingInput);
  } else if (req.body.pricing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Client-supplied pricing is not accepted; request a quote instead');
  }

  const scheduledStart = req.body.startAt || req.body.scheduledAt;
  if ((req.body.bookingMode === 'SLOT' || req.body.bookingMode === 'DATE_RANGE') && !scheduledStart) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A start time is required for scheduled bookings');
  }
  if (req.body.bookingMode === 'DATE_RANGE' && !req.body.endAt) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'An end time is required for date-range bookings');
  }
  if ((req.body.bookingMode === 'SLOT' || req.body.bookingMode === 'DATE_RANGE') && !provider) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A provider is required for scheduled bookings');
  }

  if (provider && req.body.address) {
    const Coverage = require('../models/localservice.staff.model').LocalServiceCoverage;
    const { isCovered } = require('../services/localservice.staff.service');
    const coverage = await Coverage.findOne({ provider: provider._id }).lean();
    let address = null;
    try {
      const Address = require('../../../models/user.address.model');
      address = await Address.findById(req.body.address).lean();
    } catch (e) {
      // best-effort
    }
    const locality = address && (address.locality || address.city);
    const pincode = address && address.pincode;
    if ((locality || pincode) && !isCovered(coverage, { locality, pincode })) {
      throw new ApiError(httpStatus.CONFLICT, 'Provider does not serve this address');
    }
  }

  let resourceDoc = null;
  if (req.body.resource) {
    if (!provider) throw new ApiError(httpStatus.BAD_REQUEST, 'A resource requires a provider');
    if (req.body.bookingMode !== 'SLOT' && req.body.bookingMode !== 'DATE_RANGE') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Resources require a scheduled booking');
    }
    resourceDoc = await Resource.findOne({ _id: req.body.resource, provider: provider._id, status: 'active' }).lean();
    if (!resourceDoc) throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown or inactive resource for this provider');
  }

  // Permitted payment channels: the catalogue's own list wins, otherwise the
  // policy's list applies. COD/direct only where allowed, wallet likewise.
  const allowed = policyConfig.allowedPaymentModesFor({
    serviceModes: service.allowedPaymentModes,
    policyModes: effectivePolicy.allowedPaymentModes,
  });
  if (req.body.paymentMode === 'cod' || req.body.paymentMode === 'direct') {
    const okMode =
      req.body.paymentMode === 'cod'
        ? allowed.includes('cod')
        : allowed.includes('cod') || allowed.includes('pay_after');
    if (!okMode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Off-gateway collection is not enabled for this service');
    }
  }
  if (req.body.paymentMode === 'wallet') {
    if (!allowed.includes('wallet')) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Wallet payment is not enabled for this service');
    }
  }
  // Advance window and minimum notice come from the policy.
  if (scheduledStart) {
    policyConfig.assertWithinBookingWindow({ scheduledAt: scheduledStart, effectivePolicy });
  }

  const payload = {
    customer: req.user._id,
    ...pick(req.body, ['subcategoryKey', 'serviceKey', 'bookingMode', 'scheduledAt', 'startAt', 'endAt', 'address', 'paymentMode']),
    categoryKey: categoryKey || undefined,
    provider: provider ? provider._id : undefined,
    offering: offering ? offering._id : undefined,
    variant: variant ? variant._id : undefined,
    service: service._id,
    resource: req.body.resource || undefined,
    pricingMode: service.pricingMode,
    labourAmount: priced ? priced.subtotal : 0,
    partsAmount: 0,
    ...(priced
      ? {
          discountAmount: priced.discount,
          taxAmount: priced.tax,
          inspectionFee: priced.inspectionFee,
          depositAmount: priced.deposit,
          balanceAmount: priced.balance,
          serviceValue: priced.grandTotal,
          items: priced.items,
        }
      : {}),
    status: 'DRAFT',
  };

  // Retry the vanishingly rare code collision instead of failing the request.
  let booking = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      booking = await Booking.create({ bookingCode: bookingService.buildBookingCode(), ...payload });
      break;
    } catch (e) {
      if (e && e.code === 11000 && attempt < 2) continue;
      throw e;
    }
  }

  // Slot hold: serialized per provider so two simultaneous bookings cannot
  // both pass the interval check, with stale 15-min holds expired first.
  if (req.body.bookingMode === 'SLOT' || req.body.bookingMode === 'DATE_RANGE') {
    const startAt = scheduledStart;
    const durationMinutes = offering && offering.durationMinutes ? offering.durationMinutes : 60;
    const endAt = req.body.endAt || new Date(new Date(startAt).getTime() + durationMinutes * 60000);
    if (new Date(endAt) <= new Date(startAt)) {
      await Booking.deleteOne({ _id: booking._id });
      throw new ApiError(httpStatus.BAD_REQUEST, 'End time must be after start time');
    }
    try {
      await slotlock.withLock(`ls-slot:${provider._id}`, async () => {
        await slotlock.expireHolds(provider._id);
        let capacity = 1;
        let bufferMinutes = 10;
        if (req.body.bookingMode === 'SLOT') {
          const rule =
            (service &&
              (await LocalServiceAvailabilityRule.findOne({
                provider: provider._id,
                service: service._id,
                day: new Date(startAt).getDay(),
                status: 'active',
              }).lean())) ||
            (await LocalServiceAvailabilityRule.findOne({
              provider: provider._id,
              service: null,
              day: new Date(startAt).getDay(),
              status: 'active',
            }).lean());
          if (rule) {
            capacity = rule.capacity || 1;
            bufferMinutes = rule.bufferMinutes != null ? rule.bufferMinutes : 10;
            if (!availability.isWithinWorkingHours(rule, startAt, endAt)) {
              throw new ApiError(httpStatus.CONFLICT, 'Slot is outside working hours');
            }
          }
        }
        if (resourceDoc) {
          capacity = Math.max(1, Number(resourceDoc.capacity) || 1);
          bufferMinutes = Math.max(bufferMinutes, Number(resourceDoc.turnaroundMinutes) || 0);
        }
        const reservationQuery = { provider: provider._id, status: { $in: ['held', 'confirmed'] } };
        if (req.body.resource) reservationQuery.resource = req.body.resource;
        const existing = await Reservation.find(reservationQuery);
        availability.assertSlotFree(existing, startAt, endAt, bufferMinutes, { capacity });
        await Reservation.create({
          booking: booking._id,
          provider: provider._id,
          resource: req.body.resource || undefined,
          startAt,
          endAt,
          status: 'held',
          expiresAt: new Date(Date.now() + 15 * 60000),
        });
      });
    } catch (e) {
      await Booking.deleteOne({ _id: booking._id });
      throw e;
    }
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

/**
 * Load the effective policy that governs a booking.
 *
 * Scope is derived from the booking's own snapshot (category/service keys
 * and provider), so a policy set for a category applies to every booking in
 * it without the booking carrying a policy id.
 */
const loadBookingPolicy = async (booking, service) => {
  const policyConfig = require('../services/localservice.policy.config.service');
  const scope = {
    categoryKey: booking.categoryKey || (service && service.categoryKey) || null,
    subcategoryKey: booking.subcategoryKey || null,
    serviceKey: booking.serviceKey || (service && service.key) || null,
    provider: booking.provider || null,
  };
  return policyConfig.loadEffectivePolicy(scope, {
    depositPercent: service ? service.depositPercent : 0,
    allowedPaymentModes: service ? service.allowedPaymentModes : [],
  });
};

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
  // Quote expiry is bounded by policy: a partner may ask for less time, never
  // more. The default comes from the policy when the partner sends nothing.
  const policyConfig = require('../services/localservice.policy.config.service');
  const service = booking.serviceKey
    ? await Service.findOne({ key: booking.serviceKey }).lean()
    : null;
  const effectivePolicy = await loadBookingPolicy(booking, service);
  const expiresAt = req.body.expiresAt
    ? policyConfig.assertQuoteExpiryWithinPolicy({ expiresAt: req.body.expiresAt, effectivePolicy })
    : new Date(Date.now() + effectivePolicy.quoteExpiryHours * 3600000);
  const quote = await Quote.create({
    booking: booking._id,
    ...req.body,
    expiresAt,
    status: 'SUBMITTED',
  });
  res.status(httpStatus.CREATED).send({ quote });
});

const acceptQuote = catchAsync(async (req, res) => {
  const quote = await Quote.findById(req.params.id);
  if (!quote) throw new ApiError(httpStatus.NOT_FOUND, 'Quote not found');
  const booking = await Booking.findById(quote.booking);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (String(booking.customer) !== String(req.user._id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  }
  if (quote.status !== 'SUBMITTED') throw new ApiError(httpStatus.BAD_REQUEST, 'Quote not actionable');
  if (new Date() > new Date(quote.expiresAt)) {
    quote.status = 'EXPIRED';
    await quote.save();
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quote expired');
  }
  const labour = Number(quote.labourAmount) || 0;
  const parts = Number(quote.partsAmount) || 0;
  // Rebuild the frozen lines from the accepted terms; never leave the booking
  // with stale items from the pre-quote request.
  const items = [
    { kind: 'service', label: 'Quoted labour', quantity: 1, unitPrice: labour, lineTotal: labour },
  ];
  if (parts > 0) {
    items.push({ kind: 'service', label: 'Parts', quantity: 1, unitPrice: parts, lineTotal: parts });
  }
  quote.status = 'ACCEPTED';
  await quote.save();
  const service = booking.serviceKey
    ? await Service.findOne({ key: booking.serviceKey, status: 'active' }).lean()
    : null;
  const effectivePolicy = await loadBookingPolicy(booking, service);
  const depositPercent =
    booking.paymentMode === 'gateway' || booking.paymentMode === 'wallet'
      ? Number(effectivePolicy.depositPercent || 0)
      : 0;
  // Tax comes from the effective policy, applied on top of the quoted work.
  const taxPercent = Number(effectivePolicy.taxPercent || 0);
  const taxable = Number((labour + parts).toFixed(2));
  const tax = Number(((taxable * taxPercent) / 100).toFixed(2));
  if (tax > 0) {
    items.push({
      kind: 'tax',
      label: `${effectivePolicy.taxLabel || 'Tax'} ${taxPercent}%`,
      quantity: 1,
      unitPrice: tax,
      lineTotal: tax,
    });
  }
  const grand = Number((taxable + tax).toFixed(2));
  const deposit = Number(((grand * depositPercent) / 100).toFixed(2));
  await Booking.findByIdAndUpdate(quote.booking, {
    labourAmount: labour,
    partsAmount: parts,
    serviceValue: grand,
    depositAmount: deposit,
    balanceAmount: Number((grand - deposit).toFixed(2)),
    discountAmount: 0,
    taxAmount: tax,
    items,
  });
  res.status(httpStatus.OK).send({ quote });
});

const reviseQuote = catchAsync(async (req, res) => {
  // Provider revises: previous terms preserved in revisions[], version bumps,
  // status returns to SUBMITTED for customer re-acceptance.
  const quote = await Quote.findById(req.params.id);
  if (!quote) throw new ApiError(httpStatus.NOT_FOUND, 'Quote not found');
  const booking = await Booking.findById(quote.booking);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  const Provider = require('../models/localservice.provider.model');
  const provider = await Provider.findOne({ owner: req.user._id });
  const owns =
    provider &&
    (String(booking.provider || '') === String(provider._id) ||
      (provider.business && String(booking.provider || '') === String(provider.business)));
  if (!owns) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  if (quote.status !== 'SUBMITTED' && quote.status !== 'REVISED') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only pending quotes can be revised');
  }
  quote.revisions.push({ version: quote.version, labourAmount: quote.labourAmount, partsAmount: quote.partsAmount, note: req.body.note || undefined, createdAt: new Date() });
  quote.version += 1;
  quote.labourAmount = req.body.labourAmount;
  quote.partsAmount = req.body.partsAmount;
  if (req.body.scopeOfWork !== undefined) quote.scopeOfWork = req.body.scopeOfWork;
  // A revision gets the same expiry ceiling as the original quote.
  const policyConfig = require('../services/localservice.policy.config.service');
  const service = booking.serviceKey
    ? await Service.findOne({ key: booking.serviceKey }).lean()
    : null;
  const effectivePolicy = await loadBookingPolicy(booking, service);
  quote.expiresAt = req.body.expiresAt
    ? policyConfig.assertQuoteExpiryWithinPolicy({ expiresAt: req.body.expiresAt, effectivePolicy })
    : new Date(Date.now() + effectivePolicy.quoteExpiryHours * 3600000);
  quote.status = 'SUBMITTED';
  await quote.save();
  res.status(httpStatus.OK).send({ quote });
});

const rescheduleBooking = catchAsync(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  if (String(booking.customer) !== String(req.user._id)) throw new ApiError(httpStatus.FORBIDDEN, 'Not your booking');
  const startAt = booking.startAt || booking.scheduledAt;
  // The reschedule cutoff comes from the effective policy, not a constant.
  const service = booking.serviceKey
    ? await Service.findOne({ key: booking.serviceKey }).lean()
    : null;
  const effectivePolicy = await loadBookingPolicy(booking, service);
  const rescheduleCutoffHours = Number(effectivePolicy.rescheduleCutoffHours || 24);
  if (!policy.canReschedule({ startAt, cutoffHours: rescheduleCutoffHours })) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Reschedule window closed (${rescheduleCutoffHours}h cutoff)`);
  }
  // Reschedules are capped: a booking cannot be moved forever.
  const rescheduleCount = Number(booking.rescheduleCount || 0);
  if (rescheduleCount >= Number(effectivePolicy.rescheduleCountLimit || 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Reschedule limit reached for this booking');
  }
  const newStart = req.body.startAt || req.body.scheduledAt;
  if (!newStart) throw new ApiError(httpStatus.BAD_REQUEST, 'startAt required');
  const newEnd = req.body.endAt || new Date(new Date(newStart).getTime() + 60 * 60000);
  if (new Date(newEnd) <= new Date(newStart)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'End time must be after start time');
  }
  const currentReservation = await Reservation.findOne({ booking: booking._id }).lean();
  const needsReservation =
    booking.bookingMode === 'SLOT' || booking.bookingMode === 'DATE_RANGE' || Boolean(currentReservation);
  if (booking.provider && needsReservation) {
    // A booked resource keeps its own capacity and turnaround buffer; the
    // provider-level rule must not silently widen a room/vehicle booking.
    let resourceCapacity = null;
    let resourceBuffer = 0;
    if (booking.resource) {
      const Resource = require('../models/localservice.resource.model');
      const resource = await Resource.findOne({ _id: booking.resource, provider: booking.provider }).lean();
      if (!resource) throw new ApiError(httpStatus.CONFLICT, 'Booked resource is no longer available');
      if (resource.status !== 'active') throw new ApiError(httpStatus.CONFLICT, 'Booked resource is inactive');
      resourceCapacity = Math.max(1, Number(resource.capacity) || 1);
      resourceBuffer = Number(resource.turnaroundMinutes) || 0;
    }
    await slotlock.withLock(`ls-slot:${booking.provider}`, async () => {
      await slotlock.expireHolds(booking.provider);
      let capacity = 1;
      let bufferMinutes = 10;
      const rule = await LocalServiceAvailabilityRule.findOne({
        provider: booking.provider,
        service: booking.service || null,
        day: new Date(newStart).getDay(),
        status: 'active',
      }).lean();
      if (rule) {
        capacity = rule.capacity || 1;
        bufferMinutes = rule.bufferMinutes != null ? rule.bufferMinutes : 10;
        if (!availability.isWithinWorkingHours(rule, newStart, newEnd)) {
          throw new ApiError(httpStatus.CONFLICT, 'Slot is outside working hours');
        }
      }
      if (resourceCapacity != null) {
        capacity = resourceCapacity;
        bufferMinutes = Math.max(bufferMinutes, resourceBuffer);
      }
      const query = {
        status: { $in: ['held', 'confirmed'] },
        booking: { $ne: booking._id },
        provider: booking.provider,
      };
      if (booking.resource) query.resource = booking.resource;
      const existing = await Reservation.find(query);
      availability.assertSlotFree(existing, newStart, newEnd, bufferMinutes, { capacity });
      const paid = booking.paymentStatus === 'paid';
      await Reservation.findOneAndUpdate(
        { booking: booking._id },
        {
          $set: {
            provider: booking.provider,
            resource: booking.resource || undefined,
            startAt: newStart,
            endAt: newEnd,
            status: paid ? 'confirmed' : 'held',
            expiresAt: new Date(Date.now() + 15 * 60000),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    });
  }
  booking.scheduledAt = newStart;
  booking.startAt = newStart;
  booking.endAt = newEnd;
  booking.rescheduleCount = rescheduleCount + 1;
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
  const booking = await Booking.findOne({ _id: req.params.id, customer: req.user._id })
    .populate('provider', 'businessName')
    .populate('variant', 'name durationMinutes');
  if (!booking) throw new ApiError(httpStatus.NOT_FOUND, 'Booking not found');
  // Surface pending quotes so the customer can accept/decline them without a
  // separate endpoint. Only SUBMITTED (actionable) quotes are returned.
  const Quote = require('../models/localservice.quote.model');
  const quotes = await Quote.find({ booking: booking._id, status: { $in: ['SUBMITTED', 'REVISED'] } })
    .sort({ createdAt: -1 })
    .lean();
  res.status(httpStatus.OK).send({ booking, quotes });
});

const initiatePayment = catchAsync(async (req, res) => {
  const result = await paymentService.initiateBookingPayment({
    bookingId: req.params.id,
    customerId: req.user._id,
    paymentConfigId: req.body.payment,
    paymentRef: req.body.paymentRef,
  });
  res.status(httpStatus.CREATED).send(result);
});

const getBookingPayment = catchAsync(async (req, res) => {
  const result = await paymentService.getBookingPayment({
    bookingId: req.params.id,
    customerId: req.user._id,
  });
  res.status(httpStatus.OK).send(result);
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
    await recordAudit(req, {
      event: 'refund.rejected',
      targetType: 'refund',
      targetId: doc._id,
      details: `Refund rejected for booking ${doc.booking}`,
      metadata: { booking: doc.booking, requestedAmount: doc.requestedAmount, reason: doc.reason },
    });
    return res.status(httpStatus.OK).send({ refund: doc });
  }
  if (req.body.decision !== 'approved') throw new ApiError(httpStatus.BAD_REQUEST, 'Use approved|rejected');
  doc.status = 'approved';
  doc.approvedAmount = doc.requestedAmount;
  await doc.save();
  // Ledger reversal follows approval (original payment untouched). The cash leg
  // runs next: an approval that never moves money is a promise not kept.
  const { reverseRevenueForBooking } = require('../services/localservice.revenue.booking.service');
  try {
    await reverseRevenueForBooking({ bookingId: String(doc.booking), reason: doc.reason || 'refund-approved', actorId: req.user._id });
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }
  await recordAudit(req, {
    event: 'refund.approved',
    targetType: 'refund',
    targetId: doc._id,
    details: `Refund approved for booking ${doc.booking}`,
    metadata: { booking: doc.booking, requestedAmount: doc.requestedAmount, approvedAmount: doc.approvedAmount },
  });

  // A manually recorded gateway reference means the operator already moved
  // the money outside the platform: honour it instead of paying twice.
  if (req.body.gatewayRefundReference) {
    doc.gatewayRefundReference = req.body.gatewayRefundReference;
    doc.status = 'completed';
    doc.completedAt = new Date();
    doc.completedAmount = doc.approvedAmount;
    await doc.save();
    const Booking = require('../models/localservice.booking.model');
    const booking = await Booking.findById(doc.booking);
    if (booking) {
      booking.refundedAmount = Number((Number(booking.refundedAmount || 0) + Number(doc.completedAmount || 0)).toFixed(2));
      booking.paymentStatus =
        booking.refundedAmount + 0.01 >= Number(booking.amountPaid || 0) ? 'refunded' : 'partially_refunded';
      await booking.save();
    }
    await recordAudit(req, {
      event: 'refund.completed',
      targetType: 'refund',
      targetId: doc._id,
      details: `Refund completed manually for booking ${doc.booking}`,
      metadata: { gatewayRefundReference: doc.gatewayRefundReference },
    });
    return res.status(httpStatus.OK).send({ refund: doc });
  }

  // Execute the cash leg. A failure is recorded on the refund and reported,
  // never swallowed: the operator must know the money did not move.
  const refundService = require('../services/localservice.refund.service');
  try {
    const result = await refundService.executeRefund({ refundId: String(doc._id), actorId: req.user._id });
    await recordAudit(req, {
      event: 'refund.completed',
      targetType: 'refund',
      targetId: doc._id,
      details: `Refund of ${result.amount} executed for booking ${doc.booking} via ${result.mode}`,
      metadata: { mode: result.mode, reference: result.reference, amount: result.amount },
    });
    const { notifyUser } = require('../services/localservice.notify.service');
    await notifyUser({
      userId: result.booking.customer,
      title: 'Refund processed',
      content: `₹${result.amount} refunded for booking ${result.booking.bookingCode}`,
      payload: { bookingId: String(result.booking._id), kind: 'local_service_refund' },
    });
    return res.status(httpStatus.OK).send({ refund: result.refund, booking: result.booking });
  } catch (e) {
    await recordAudit(req, {
      event: 'refund.failed',
      targetType: 'refund',
      targetId: doc._id,
      details: `Refund execution failed for booking ${doc.booking}: ${e.message}`,
      metadata: { booking: doc.booking, error: String(e.message || e) },
    });
    throw e;
  }
});

const retryRefund = catchAsync(async (req, res) => {
  const { LocalServiceRefundRequest } = require('../models/localservice.catalog.ext.model');
  const doc = await LocalServiceRefundRequest.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Refund request not found');
  if (!['failed', 'approved'].includes(doc.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Refund is ${doc.status}, not retryable`);
  }
  const refundService = require('../services/localservice.refund.service');
  try {
    const result = await refundService.executeRefund({ refundId: String(doc._id), actorId: req.user._id });
    await recordAudit(req, {
      event: 'refund.completed',
      targetType: 'refund',
      targetId: doc._id,
      details: `Refund retry succeeded for booking ${doc.booking}`,
      metadata: { mode: result.mode, reference: result.reference, amount: result.amount },
    });
    return res.status(httpStatus.OK).send({ refund: result.refund, booking: result.booking });
  } catch (e) {
    await recordAudit(req, {
      event: 'refund.failed',
      targetType: 'refund',
      targetId: doc._id,
      details: `Refund retry failed for booking ${doc.booking}: ${e.message}`,
      metadata: { booking: doc.booking, error: String(e.message || e) },
    });
    throw e;
  }
});

const adminListInvoices = catchAsync(async (req, res) => {
  const { LocalServiceInvoice } = require('../models/localservice.fulfilment.model');
  const filter = { ...pick(req.query, ['status']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceInvoice.paginate(filter, options));
});

const adminListReviews = catchAsync(async (req, res) => {
  const { LocalServiceReview } = require('../models/localservice.fulfilment.model');
  const filter = { ...pick(req.query, ['provider']) };
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceReview.paginate(filter, options));
});

module.exports = { createBooking, transitionBooking, submitQuote, acceptQuote, reviseQuote, rescheduleBooking, disputeBooking, submitReview, listReviews, getInvoice, voidInvoice, createComplaint, listMyComplaints, listAllComplaints, resolveComplaint, listMyBookings, getMyBooking, initiatePayment, getBookingPayment, adminListBookings, adminGetBooking, adminListRefunds, adminListInvoices, adminListReviews, decideRefund, retryRefund };
