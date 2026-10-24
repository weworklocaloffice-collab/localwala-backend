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

const cron = require('node-cron');

/**
 * local-services cron — own node-cron (stores/jhatka pattern), never in the
 * shared scheduler unless non-throwing. Every sweep is idempotent and safe
 * to retry; functions are exported for unit tests.
 */

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

/**
 * Stuck-booking alert (read-only). Transient states older than the threshold
 * are reported for operator triage — never auto-transitioned (money states
 * must move by explicit action, not by clock).
 */
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
  // REQUESTED bookings with no provider: broadcast to eligible providers.
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
          // best-effort
          void err;
        }
      }
  }
  return out;
}

async function reconcileGatewayPayments({ PaymentInitiationModel } = {}) {
  const PaymentInitiation = PaymentInitiationModel || require('../../../models/payment.initiation.model');
  const out = { scanned: 0, reconciled: 0 };
  // Initiated payments older than 10 minutes that never got a callback.
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const stuck = await PaymentInitiation.find({
    paymentFrom: 'localServiceBooking',
    status: 'initiated',
    createdAt: { $lte: cutoff },
  }).lean();
  out.scanned = stuck.length;
  // Reconciliation is a report, not an auto-pay: a payment that never
  // verified at the gateway must not be marked paid. We log them for the
  // operator to chase; the gateway sweep in the shared controller already
  // handles the captured-but-unverified case.
  for (const p of stuck) {
    console.warn('LocalServices unreconciled payment:', p._id, p.localServiceBookingId);
  }
  return out;
}

async function sendBookingReminders({ BookingModel, NotifyModel } = {}) {
  const Booking = BookingModel || require('./models/localservice.booking.model');
  const Notify = NotifyModel || require('../../../models/notification.list.model');
  const out = { scanned: 0, reminded: 0 };
  // CONFIRMED bookings starting in the next 24 hours get one reminder.
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
      // best-effort
      void e;
    }
  }
  return out;
}

function startLocalServicesCron() {
  // Every 15 min: activation/expiry. Idempotent — re-running changes nothing.
  cron.schedule('*/15 * * * *', async () => {
    try {
      const now = new Date();
      await activateScheduledRules(now);
      await expireActiveRules(now);
    } catch (error) {
      console.error('LocalServices rule sweep failed:', error.message);
    }
  });
  // Every 5 min: capacity + quote hygiene. Never blocks a slot forever.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      await releaseExpiredReservations(now);
      await expirePendingQuotes(now);
    } catch (error) {
      console.error('LocalServices hold/quote sweep failed:', error.message);
    }
  });
  // Daily 03:00: recurring occurrences (idempotent, advances either way).
  cron.schedule('0 3 * * *', async () => {
    try {
      const { generateDueOccurrences } = require('./services/localservice.recurring.service');
      await generateDueOccurrences(new Date());
    } catch (error) {
      console.error('LocalServices recurring sweep failed:', error.message);
    }
  });
  // Every 10 min: notify providers of new requests (best-effort broadcast).
  cron.schedule('*/10 * * * *', async () => {
    try {
      const r = await notifyProvidersOfNewRequests(new Date());
      if (r.notified > 0) console.log('LocalServices new-request notifications:', r);
    } catch (error) {
      console.error('LocalServices new-request notify failed:', error.message);
    }
  });
  // Every 30 min: gateway reconciliation report (initiated payments that
  // never got a callback). Never auto-pays; operator chases them.
  cron.schedule('*/30 * * * *', async () => {
    try {
      const r = await reconcileGatewayPayments(new Date());
      if (r.scanned > 0) console.warn('LocalServices unreconciled payments:', r.scanned);
    } catch (error) {
      console.error('LocalServices gateway reconcile failed:', error.message);
    }
  });
  // Every hour: booking reminders for the next 24 hours.
  cron.schedule('0 * * * *', async () => {
    try {
      const r = await sendBookingReminders(new Date());
      if (r.reminded > 0) console.log('LocalServices reminders sent:', r);
    } catch (error) {
      console.error('LocalServices reminder sweep failed:', error.message);
    }
  });

  // Hourly: stuck-booking alert (read-only report for operator triage).
  cron.schedule('0 * * * *', async () => {
    try {
      const stuck = await findStuckBookings(new Date());
      const total = Object.values(stuck).reduce((s, a) => s + a.length, 0);
      if (total > 0) console.warn('LocalServices stuck bookings:', JSON.stringify(stuck));
    } catch (error) {
      console.error('LocalServices stuck sweep failed:', error.message);
    }
  });
}

module.exports = {
  activateScheduledRules,
  expireActiveRules,
  releaseExpiredReservations,
  expirePendingQuotes,
  findStuckBookings,
  notifyProvidersOfNewRequests,
  reconcileGatewayPayments,
  sendBookingReminders,
  STUCK_THRESHOLDS_HOURS,
  startLocalServicesCron,
};
