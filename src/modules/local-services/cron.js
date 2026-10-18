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
  STUCK_THRESHOLDS_HOURS,
  startLocalServicesCron,
};
