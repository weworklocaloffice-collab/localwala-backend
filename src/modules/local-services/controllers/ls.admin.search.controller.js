const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');

const adminSearch = catchAsync(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(httpStatus.OK).send({ providers: [], services: [], bookings: [] });
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const LocalServiceProvider = require('../models/localservice.provider.model');
  const LocalServiceService = require('../models/localservice.service.model');
  const LocalServiceBooking = require('../models/localservice.booking.model');

  const [providers, services, bookings] = await Promise.all([
    LocalServiceProvider.find({ $or: [{ businessName: rx }, { contactName: rx }, { contactPhone: rx }, { gstin: rx }] }).select('businessName providerType status').limit(8).lean(),
    LocalServiceService.find({ $or: [{ key: rx }, { name: rx }, { categoryKey: rx }] }).select('key name categoryKey status').limit(8).lean(),
    LocalServiceBooking.find({ bookingCode: rx }).select('bookingCode status serviceValue').limit(8).lean(),
  ]);

  res.status(httpStatus.OK).send({
    providers: providers.map((p) => ({ id: p._id, title: p.businessName, subtitle: p.providerType, status: p.status, route: '/admin/local-services-management/providers/' + p._id })),
    services: services.map((s) => ({ id: s._id, title: s.name || s.key, subtitle: s.categoryKey, status: s.status, route: '/admin/local-services-management/services' })),
    bookings: bookings.map((b) => ({ id: b._id, title: b.bookingCode, subtitle: '₹' + (b.serviceValue || 0), status: b.status, route: '/admin/local-services-management/bookings/' + b._id })),
  });
});

module.exports = { adminSearch };
