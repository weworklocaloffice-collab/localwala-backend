const cron = require('node-cron');

async function activateScheduledRules(now = new Date(), { RuleModel } = {}) {
  const Rule = RuleModel || require('./models/localservice.revenue.rule.model');
  const res = await Rule.updateMany(
    { status: { $in: ['approved', 'scheduled'] }, effectiveFrom: { $lte: now } },
    { $set: { status: 'active', activatedAt: now } }
  );
  return { activated: res.modifiedCount || 0 };
}

async function expireActiveRules(now = new Date(), { RuleModel } = {}) {
  const Rule = RuleModel || require('./models/localservice.revenue.rule.model');
  const res = await Rule.updateMany(
    { status: 'active', effectiveTo: { $ne: null, $lte: now } },
    { $set: { status: 'expired' } }
  );
  return { expired: res.modifiedCount || 0 };
}

async function releaseExpiredReservations(now = new Date(), { ReservationModel } = {}) {
  const Reservation =
    ReservationModel || require('./models/localservice.reservation.model');
  const res = await Reservation.updateMany(
    { status: 'held', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } }
  );
  return { released: res.modifiedCount || 0 };
}

async function expirePendingQuotes(now = new Date(), { QuoteModel } = {}) {
  const Quote = QuoteModel || require('./models/localservice.quote.model');
  const res = await Quote.updateMany(
    { status: 'SUBMITTED', expiresAt: { $lte: now } },
    { $set: { status: 'EXPIRED' } }
  );
  return { expired: res.modifiedCount || 0 };
}

async function sweepMarketingCampaigns(now = new Date(), { CampaignModel } = {}) {
  const { sweepCampaigns } = require('./services/localservice.marketing.service');
  return sweepCampaigns(now, { CampaignModel });
}

async function sweepSubscriptionRenewals(now = new Date(), { SubscriptionModel } = {}) {
  const { expireSubscriptions } = require('./services/localservice.subscription.payment.service');
  return expireSubscriptions(now, { SubscriptionModel });
}

const STUCK_THRESHOLDS_HOURS = Object.freeze({ PENDING_PROVIDER: 24, PAYMENT_PENDING: 2, IN_PROGRESS: 48 });

async function findStuckBookings(now = new Date(), { BookingModel } = {}) {
  const Booking = BookingModel || require('./models/localservice.booking.model');
  const out = {};
  for (const [status, hours] of Object.entries(STUCK_THRESHOLDS_HOURS)) {
    const cutoff = new Date(now.getTime() - hours * 3600000);
    const rows = await Booking.find({ status, updatedAt: { $lte: cutoff } }).select('_id bookingCode status updatedAt').lean();
    out[status] = rows.map((r) => r.bookingCode || String(r._id));
  }
  return out;
}

async function notifyProvidersOfNewRequests({ BookingModel, ProviderModel, NotifyModel } = {}) {
  const Booking = BookingModel || require('./models/localservice.booking.model');
  const Provider = ProviderModel || require('./models/localservice.provider.model');
  const Notify = NotifyModel || require('../../../models/notification.list.model');
  const out = { scanned: 0, notified: 0 };
  const open = await Booking.find({ status: 'REQUESTED', provider: null }).lean();
  out.scanned = open.length;
  for (const b of open) {
    if (!b.serviceKey) continue;
    const offeringProviders = await Provider.find({ status: 'ACTIVE', bookable: true }).lean();
    for (const p of offeringProviders) {
      try {
        await Notify.create({
          user: p.owner,
          title: 'New service request',
          content: `A new ${b.serviceKey} request is available — ${b.bookingCode}`,
          payload: { bookingId: String(b._id), kind: 'local_service_request' },
        });
        out.notified += 1;
      } catch (err) {
        void err;
      }
    }
  }
  return out;
}

async function reconcileGatewayPayments({ PaymentInitiationModel } = {}) {
  const PaymentInitiation = PaymentInitiationModel || require('../../../models/payment.initiation.model');
  const out = { scanned: 0, reconciled: 0 };
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const stuck = await PaymentInitiation.find({
    paymentFrom: 'localServiceBooking',
    status: 'initiated',
    createdAt: { $lte: cutoff },
  }).lean();
  out.scanned = stuck.length;
  for (const p of stuck) {
    console.warn('LocalServices unreconciled payment:', p._id, p.localServiceBookingId);
  }
  return out;
}

async function sendBookingReminders({ BookingModel, NotifyModel } = {}) {
  const Booking = BookingModel || require('./models/localservice.booking.model');
  const Notify = NotifyModel || require('../../../models/notification.list.model');
  const out = { scanned: 0, reminded: 0 };
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 3600000);
  const upcoming = await Booking.find({
    status: 'CONFIRMED',
    scheduledAt: { $gte: now, $lte: horizon },
  }).lean();
  out.scanned = upcoming.length;
  for (const b of upcoming) {
    try {
      await Notify.create({
        user: b.customer,
        title: 'Upcoming service',
        content: `Your booking ${b.bookingCode} is scheduled soon`,
        payload: { bookingId: String(b._id), kind: 'local_service_reminder' },
      });
      out.reminded += 1;
    } catch (e) {
      void e;
    }
  }
  return out;
}

async function reconcileRevenue({ BookingModel, RevenueEntryModel } = {}) {
  const Booking = BookingModel || require('./models/localservice.booking.model');
  const Entry = RevenueEntryModel || require('./models/localservice.revenue.entry.model');
  const out = { scanned: 0, missing: 0, orphaned: 0 };
  const completed = await Booking.find({ status: 'COMPLETED' }).select('_id').lean();
  out.scanned = completed.length;
  for (const b of completed) {
    const exists = await Entry.findOne({ bookingId: String(b._id) }).lean();
    if (!exists) out.missing += 1;
  }
  const orphanedEntries = await Entry.find({ bookingId: { $ne: null } }).lean();
  for (const e of orphanedEntries) {
    const b = await Booking.findById(e.bookingId).lean().catch(() => null);
    if (!b) out.orphaned += 1;
  }
  if (out.missing > 0 || out.orphaned > 0) {
    console.warn('LocalServices revenue reconciliation:', JSON.stringify(out));
  }
  return out;
}

async function processOutbox({ OutboxModel } = {}) {
  const { processPending } = require('./services/localservice.outbox.service');
  const out = await processPending({ OutboxModel });
  if (out.failed > 0) console.warn('LocalServices outbox:', out);
  return out;
}

function startLocalServicesCron() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const now = new Date();
      await activateScheduledRules(now);
      await expireActiveRules(now);
    } catch (error) {
      console.error('LocalServices rule sweep failed:', error.message);
    }
  });
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      await releaseExpiredReservations(now);
      await expirePendingQuotes(now);
      await sweepMarketingCampaigns(now);
      await sweepSubscriptionRenewals(now);
    } catch (error) {
      console.error('LocalServices hold/quote sweep failed:', error.message);
    }
  });
  cron.schedule('0 3 * * *', async () => {
    try {
      const { generateDueOccurrences } = require('./services/localservice.recurring.service');
      const Booking = require('./models/localservice.booking.model');
      const Service = require('./models/localservice.service.model');
      const bookingService = require('./services/localservice.booking.service');
      const buildBooking = async (ag, occDate) => {
        const svc = ag.service ? await Service.findById(ag.service).lean() : null;
        const code = bookingService.buildBookingCode();
        const doc = await Booking.create({
          bookingCode: code,
          customer: ag.customer,
          provider: ag.provider || undefined,
          service: ag.service || undefined,
          serviceKey: svc ? svc.key : undefined,
          categoryKey: svc ? svc.categoryKey : undefined,
          pricingMode: svc ? svc.pricingMode : undefined,
          bookingMode: 'INSTANT',
          status: 'DRAFT',
          scheduledAt: occDate,
          labourAmount: ag.labourAmount || 0,
          partsAmount: ag.partsAmount || 0,
          serviceValue: Number(ag.labourAmount || 0) + Number(ag.partsAmount || 0),
          paymentMode: 'gateway',
        });
        return doc;
      };
      await generateDueOccurrences(new Date(), { buildBooking });
    } catch (error) {
      console.error('LocalServices recurring sweep failed:', error.message);
    }
  });
  cron.schedule('*/10 * * * *', async () => {
    try {
      const r = await notifyProvidersOfNewRequests(new Date());
      if (r.notified > 0) console.log('LocalServices new-request notifications:', r);
    } catch (error) {
      console.error('LocalServices new-request notify failed:', error.message);
    }
  });
  cron.schedule('*/30 * * * *', async () => {
    try {
      const r = await reconcileGatewayPayments(new Date());
      if (r.scanned > 0) console.warn('LocalServices unreconciled payments:', r.scanned);
    } catch (error) {
      console.error('LocalServices gateway reconcile failed:', error.message);
    }
  });
  cron.schedule('0 * * * *', async () => {
    try {
      const r = await sendBookingReminders(new Date());
      if (r.reminded > 0) console.log('LocalServices reminders sent:', r);
    } catch (error) {
      console.error('LocalServices reminder sweep failed:', error.message);
    }
  });
  cron.schedule('0 * * * *', async () => {
    try {
      const stuck = await findStuckBookings(new Date());
      const total = Object.values(stuck).reduce((s, a) => s + a.length, 0);
      if (total > 0) console.warn('LocalServices stuck bookings:', JSON.stringify(stuck));
    } catch (error) {
      console.error('LocalServices stuck sweep failed:', error.message);
    }
  });
  cron.schedule('0 */2 * * *', async () => {
    try {
      const r = await reconcileRevenue(new Date());
      if (r.missing > 0 || r.orphaned > 0) console.warn('LocalServices revenue reconcile:', r);
    } catch (error) {
      console.error('LocalServices revenue reconcile failed:', error.message);
    }
  });
  cron.schedule('* * * * *', async () => {
    try {
      const r = await processOutbox({});
      if (r.failed > 0) console.warn('LocalServices outbox:', r);
    } catch (error) {
      console.error('LocalServices outbox failed:', error.message);
    }
  });
}

module.exports = {
  activateScheduledRules,
  expireActiveRules,
  releaseExpiredReservations,
  expirePendingQuotes,
  sweepMarketingCampaigns,
  sweepSubscriptionRenewals,
  findStuckBookings,
  notifyProvidersOfNewRequests,
  reconcileGatewayPayments,
  sendBookingReminders,
  STUCK_THRESHOLDS_HOURS,
  reconcileRevenue,
  processOutbox,
  startLocalServicesCron,
};
