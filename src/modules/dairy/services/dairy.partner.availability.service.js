const { status: httpStatus } = require('http-status');
const { Business, Locality } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { LOCATION_REQUIRED_MESSAGE, locationRequirements } = require('./dairy.outlet.location');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const idOf = (value) => String(value?._id || value || '');
const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const getBusiness = async (businessId) => {
  const business = await Business.findOne({ _id: businessId, vertical: 'dairy' });
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Dairy outlet not found');
  return business;
};

const approvedLocalities = (business) => {
  const configured = (business.deliveryCoverage?.activeLocalities || []).map(idOf).filter(Boolean);
  return configured.length ? [...new Set(configured)] : (business.locality ? [idOf(business.locality)] : []);
};

const assertPrimaryLocalityEnabled = (business, allowedIds, requestedIds) => {
  const primaryLocalityId = idOf(business.locality);
  if (allowedIds.has(primaryLocalityId) && !requestedIds.includes(primaryLocalityId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Your registered primary locality must remain enabled. Pause all orders to stop service everywhere.');
  }
};

const normalizeSchedule = (rows) => {
  if (!Array.isArray(rows) || rows.length !== 7) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Set hours for all seven days of the week');
  }
  const seen = new Set();
  return rows.map((row) => {
    const day = Number(row.day);
    if (!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Each weekday must appear exactly once');
    }
    seen.add(day);
    if (typeof row.isOpen !== 'boolean') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Choose whether each day is open or closed');
    }
    if (row.isOpen && (!validTime(row.opensAt) || !validTime(row.closesAt) || row.opensAt >= row.closesAt)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${DAYS[day]} hours must have a valid opening time before closing time`);
    }
    return {
      day,
      isOpen: row.isOpen,
      ...(row.isOpen ? { opensAt: row.opensAt, closesAt: row.closesAt } : {}),
    };
  }).sort((a, b) => a.day - b.day);
};

const validLocalDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const normalizeSpecialHours = (rows) => {
  if (!Array.isArray(rows)) throw new ApiError(httpStatus.BAD_REQUEST, 'Special hours must be a list');
  if (rows.length > 90) throw new ApiError(httpStatus.BAD_REQUEST, 'You can configure up to 90 special dates at a time');
  const seen = new Set();
  return rows.map((row) => {
    if (!validLocalDate(row.date)) throw new ApiError(httpStatus.BAD_REQUEST, 'Special hours must use a valid YYYY-MM-DD local date');
    if (seen.has(row.date)) throw new ApiError(httpStatus.BAD_REQUEST, 'Each special date can appear only once');
    seen.add(row.date);
    if (typeof row.isClosed !== 'boolean') throw new ApiError(httpStatus.BAD_REQUEST, 'Choose whether the special date is closed');
    if (!row.isClosed && (!validTime(row.opensAt) || !validTime(row.closesAt) || row.opensAt >= row.closesAt)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${row.date} must have a valid opening time before closing time`);
    }
    if (row.orderCutoffTime != null && !validTime(row.orderCutoffTime)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${row.date} order cut-off must use HH:mm local time`);
    }
    return {
      date: row.date,
      isClosed: row.isClosed,
      ...(!row.isClosed ? { opensAt: row.opensAt, closesAt: row.closesAt } : {}),
      ...(row.orderCutoffTime ? { orderCutoffTime: row.orderCutoffTime } : {}),
      ...(row.label ? { label: String(row.label).trim().slice(0, 100) } : {}),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
};

const assertTimezone = (value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch (_error) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a valid time zone');
  }
};

const localClock = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  return { day, date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
};

const evaluateAvailability = (operations = {}, at = new Date()) => {
  const timezone = operations.timezone || 'Asia/Kolkata';
  const { day, date, time } = localClock(at, timezone);
  const schedule = operations.operatingHours || [];
  const today = schedule.find((row) => Number(row.day) === day);
  const special = (operations.specialHours || []).find((row) => row.date === date);
  const effectiveHours = special
    ? (special.isClosed ? null : special)
    : today;
  const cutoff = special?.orderCutoffTime || operations.orderCutoffTime || null;
  let reason = 'open';
  if (operations.acceptingOrders === false) reason = 'paused';
  else if (special?.isClosed === true) reason = 'special_closed';
  else if (!special && schedule.length && (!today || today.isOpen !== true)) reason = 'closed_today';
  else if (effectiveHours && (time < effectiveHours.opensAt || time >= effectiveHours.closesAt)) reason = 'outside_hours';
  else if (cutoff && time >= cutoff) reason = 'cutoff_passed';

  return {
    canAcceptOrders: reason === 'open',
    isAcceptingOrders: operations.acceptingOrders !== false,
    isOpenNow: reason === 'open',
    reason,
    timezone,
    localTime: time,
    localDate: date,
    orderCutoffTime: cutoff,
    todayHours: effectiveHours || null,
    specialHours: special || null,
  };
};

const getPartnerAvailability = async (businessId) => {
  const business = await getBusiness(businessId);
  const operations = business.dairyOperations?.toObject?.() || business.dairyOperations || {};
  const approvedIds = approvedLocalities(business);
  const primaryLocalityId = idOf(business.locality);
  const selectedIds = Array.isArray(operations.serviceableLocalities)
    ? [...new Set([...operations.serviceableLocalities.map(idOf), ...(approvedIds.includes(primaryLocalityId) ? [primaryLocalityId] : [])])]
    : approvedIds;
  const [approved, selected] = await Promise.all([
    Locality.find({ _id: { $in: approvedIds }, city: business.city, status: true }).select('_id name').lean(),
    Locality.find({ _id: { $in: selectedIds }, city: business.city, status: true }).select('_id name').lean(),
  ]);
  return {
    settings: {
      acceptingOrders: operations.acceptingOrders !== false,
      timezone: operations.timezone || 'Asia/Kolkata',
      operatingHours: operations.operatingHours || [],
      specialHours: operations.specialHours || [],
      orderCutoffTime: operations.orderCutoffTime || null,
      serviceabilityConfigured: Array.isArray(operations.serviceableLocalities),
      serviceableLocalities: selected.map((row) => String(row._id)),
      primaryLocalityId: approvedIds.includes(primaryLocalityId) ? primaryLocalityId : null,
      orderAvailability: evaluateAvailability(operations),
      updatedAt: operations.updatedAt || null,
    },
    approvedLocalities: approved,
  };
};

const updatePartnerAvailability = async (businessId, actorId, payload) => {
  const business = await getBusiness(businessId);
  const updates = {};
  if (payload.acceptingOrders !== undefined) updates.acceptingOrders = payload.acceptingOrders;
  if (payload.operatingHours !== undefined) updates.operatingHours = normalizeSchedule(payload.operatingHours);
  if (payload.specialHours !== undefined) updates.specialHours = normalizeSpecialHours(payload.specialHours);
  if (payload.timezone !== undefined) updates.timezone = assertTimezone(payload.timezone);
  if (payload.orderCutoffTime !== undefined) {
    if (payload.orderCutoffTime !== null && !validTime(payload.orderCutoffTime)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order cut-off must use HH:mm local time');
    }
    updates.orderCutoffTime = payload.orderCutoffTime || null;
  }
  if (payload.serviceableLocalities !== undefined) {
    const allowed = new Set(approvedLocalities(business));
    const requested = [...new Set(payload.serviceableLocalities.map(idOf))];
    if (requested.length !== payload.serviceableLocalities.length || requested.some((id) => !allowed.has(id))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'You can serve only unique localities already approved for this outlet');
    }
    const rows = await Locality.find({ _id: { $in: requested }, city: business.city, status: true }).select('_id').lean();
    if (rows.length !== requested.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Every selected locality must be active and approved for this outlet');
    }
    assertPrimaryLocalityEnabled(business, allowed, requested);
    updates.serviceableLocalities = requested;
  }
  if (!Object.keys(updates).length) throw new ApiError(httpStatus.BAD_REQUEST, 'No availability settings were supplied');

  const current = business.dairyOperations?.toObject?.() || business.dairyOperations || {};
  business.dairyOperations = {
    ...current,
    ...updates,
    updatedAt: new Date(),
    updatedBy: actorId,
  };
  await business.save();
  return getPartnerAvailability(businessId);
};

const assertOrderAvailable = async (businessId, at = new Date()) => {
  const business = await getBusiness(businessId);
  if (!locationRequirements(business).complete) {
    throw new ApiError(httpStatus.CONFLICT, LOCATION_REQUIRED_MESSAGE);
  }
  const availability = evaluateAvailability(business.dairyOperations || {}, at);
  if (!availability.canAcceptOrders) {
    const message = availability.reason === 'paused'
      ? 'This Dairy outlet has paused new orders'
      : availability.reason === 'cutoff_passed'
      ? `This Dairy outlet has passed its order cut-off (${availability.orderCutoffTime})`
      : 'This Dairy outlet is currently outside its order hours';
    throw new ApiError(httpStatus.CONFLICT, message);
  }
  return availability;
};

module.exports = {
  approvedLocalities,
  assertPrimaryLocalityEnabled,
  normalizeSchedule,
  normalizeSpecialHours,
  evaluateAvailability,
  getPartnerAvailability,
  updatePartnerAvailability,
  assertOrderAvailable,
};
