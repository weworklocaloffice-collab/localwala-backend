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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const SUBSCRIPTION_TRANSITIONS = {
  trial: ['active', 'payment_due', 'cancelled', 'expired'],
  active: ['payment_due', 'cancelled', 'expired'],
  payment_due: ['active', 'retrying', 'cancelled', 'expired'],
  retrying: ['active', 'grace_period', 'cancelled', 'expired'],
  grace_period: ['active', 'suspended', 'cancelled', 'expired'],
  suspended: ['active', 'expired', 'cancelled'],
  cancelled: ['active', 'expired'],
  expired: ['active'],
};

const assertTransition = (from, to) => {
  const allowed = SUBSCRIPTION_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_SUBSCRIPTION_MOVE: ${from} -> ${to} is not allowed. Allowed: ${allowed?.join(', ') || 'none'}`);
  }
};

/**
 * The chain's subscription.
 *
 * `forOutlet` returns null for an unsubscribed chain, which is the correct caller signal
 * ("treat as expired") rather than a 500 on a screen that must render for free partners
 * too. This wrapper converts that into a 404 for the API surface, where a missing
 * subscription genuinely is not-found.
 */
const getSubscription = async (chainId) => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const sub = await StoreSubscription.findOne({ chain: chainId })
    .sort({ createdAt: -1 })
    .lean();
  if (!sub) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  return sub;
};

/**
 * Start a subscription.
 *
 * ## Field names, and why they look unfamiliar
 *
 * These write `endsAt` and `nextPaymentDueAt`, not `currentPeriodEnd` / `nextBillingDate`.
 * The model is the contract — see `store.subscription.model.js` and its 27 assertions —
 * and Mongoose drops unknown paths silently under `strict`, so writing a field that does
 * not exist produces a subscription that LOOKS created but has no due date and is
 * therefore invisible to the dunning sweeper. Field names here must match the model exactly.
 *
 * ## A trial has no paid period
 *
 * `endsAt` stays null while `status === 'trial'`. A trial is not a paid period that has
 * not ended yet, and stamping an end date on it would make `hasEnded` answer the wrong
 * question. The trial's own horizon is `trialEndsAt`, and the `effectiveStatus` virtual
 * reads it.
 */
const createSubscription = async ({ chain, business, plan, amount, taxAmount, totalAmount, trialDays, features, endsAt, nextPaymentDueAt }) => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const now = new Date();
  const trialEndsAt = trialDays > 0 ? new Date(now.getTime() + trialDays * 86400000) : null;

  return StoreSubscription.create({
    chain,
    business,
    plan,
    status: trialDays > 0 ? 'trial' : 'active',
    amount,
    taxAmount,
    totalAmount,
    trialDays,
    trialEndsAt,
    features: features || [],
    startedAt: now,
    endsAt: trialDays > 0 ? null : endsAt || null,
    nextPaymentDueAt: trialDays > 0 ? null : nextPaymentDueAt || endsAt || null,
  });
};

/**
 * One rung of the dunning ladder (BR-16, §6.3).
 *
 * Every branch persists the date that the NEXT sweep reads, so the ladder advances from
 * stored state rather than from anything held in memory. That is what makes a repeated
 * sweep idempotent: a restart mid-ladder resumes at the rung the database says, not at
 * whatever the previous process had in a variable.
 */
const transitionSubscription = async (subscriptionId, to, { notes, actor } = {}) => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const sub = await StoreSubscription.findById(subscriptionId);
  if (!sub) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');

  assertTransition(sub.status, to);

  const from = sub.status;
  const now = new Date();

  switch (to) {
    case 'active':
      // Recovery. The paid period restarts and the retry streak resets — a partner who
      // has just charged successfully is not a partner mid-dunning.
      sub.startedAt = now;
      sub.endsAt = sub.endsAt && sub.endsAt > now ? sub.endsAt : null;
      sub.nextPaymentDueAt = sub.nextPaymentDueAt || null;
      sub.retryCount = 0;
      sub.graceEndsAt = null;
      sub.lastPaymentAt = now;
      break;
    case 'payment_due':
      sub.nextPaymentDueAt = now;
      break;
    case 'retrying':
      sub.retryCount += 1;
      sub.lastPaymentFailedAt = now;
      break;
    case 'grace_period':
      // Three days, per the specification's ladder. Persisted as `graceEndsAt` because
      // `dueForDunning` sweeps on it.
      sub.graceEndsAt = new Date(now.getTime() + 3 * 86400000);
      break;
    case 'suspended':
      sub.graceEndsAt = now;
      break;
    case 'expired':
      sub.expiredAt = now;
      break;
    case 'cancelled':
      sub.cancelledAt = now;
      sub.cancelReason = notes;
      // Cancelling stops the clock on the paid period. It does not end it: `hasEnded`
      // compares `endsAt` to now, so a mid-period cancellation still entitles the partner
      // until the date they actually paid through.
      if (!sub.endsAt) sub.endsAt = now;
      break;
    default:
      break;
  }

  sub.statusHistory.push({ from, to, by: actor, reason: notes, at: now });
  sub.status = to;

  await sub.save();
  return sub;
};

const recordPayment = async ({ subscription, attemptNo, amount, status, paymentMethod, gatewayReference, gatewayResponse, failureCode, failureReason }) => {
  const StoreSubscriptionPayment = mongoose.model('StoreSubscriptionPayment');
  return StoreSubscriptionPayment.create({
    subscription,
    chain: subscription.chain,
    attemptNo,
    amount,
    status,
    paymentMethod,
    gatewayReference,
    gatewayResponse,
    failureCode,
    failureReason,
    paidAt: status === 'success' ? new Date() : undefined,
    failedAt: status === 'failed' ? new Date() : undefined,
  });
};

/**
 * Advance the dunning ladder by one rung for everything currently due.
 *
 * ## One rung per sweep, not the whole ladder
 *
 * Each subscription moves at most one step per run. Walking a partner from `active` to
 * `suspended` in a single pass would skip the retry notifications the partner is entitled
 * to, and would make "how long has this partner been in trouble" unreadable from the data.
 * The ladder is walked by repeated runs, each reading the rung the database last wrote.
 *
 * ## Idempotent under a doubled sweep (T3)
 *
 * There is no queue and pm2 runs one instance, so a doubled sweep is a certainty on
 * scale-out. Two guards make it harmless: `dueForDunning` filters on status, so a row
 * already advanced is not selected again; and `assertTransition` refuses an illegal move
 * rather than writing a status the ladder does not contain.
 */
const processBillingSweep = async () => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const now = new Date();
  const due = await StoreSubscription.dueForDunning(now);
  const results = { advanced: 0, skipped: 0, failed: 0 };

  for (const sub of due) {
    try {
      let next = null;

      if (sub.status === 'payment_due') {
        next = 'retrying';
      } else if (sub.status === 'retrying' && sub.retryCount < sub.maxRetries) {
        next = 'retrying';
      } else if (sub.status === 'retrying' || sub.status === 'grace_period') {
        // Retries exhausted, or the grace window itself is over.
        next = 'suspended';
      }

      if (!next) {
        results.skipped += 1;
        continue;
      }

      await transitionSubscription(sub._id, next, { notes: `Sweep ${now.toISOString()}` });
      results.advanced += 1;
    } catch (error) {
      // One partner's bad row must not abort the sweep for everyone else.
      results.failed += 1;
    }
  }

  return results;
};

/**
 * Grace period over -> suspended.
 *
 * Reads `graceEndsAt`, the date the ladder wrote when it entered grace, rather than
 * recomputing "three days from the last run" — a sweep that missed a night must still
 * suspend on the original deadline, not on a rolling one.
 */
const processGracePeriodExpiry = async () => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const now = new Date();
  const overdue = await StoreSubscription.find({ status: 'grace_period', graceEndsAt: { $lte: now } });

  let suspended = 0;
  for (const sub of overdue) {
    try {
      await transitionSubscription(sub._id, 'suspended', { notes: 'Grace period expired' });
      suspended += 1;
    } catch (error) {
      /* one bad row must not stop the rest */
    }
  }

  return { suspended };
};

/**
 * Suspended past the long-stop -> expired.
 *
 * The specification allows a suspended partner to read history and fulfil existing orders
 * but not accept new ones. `expired` removes even that, so it is deliberately the LAST
 * rung and never reached by a single sweep from `grace_period`.
 */
const processSuspendedExpiry = async () => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const now = new Date();
  const stale = await StoreSubscription.find({
    status: 'suspended',
    // Fourteen days without payment, per the ladder in §6.3.
    graceEndsAt: { $lte: new Date(now.getTime() - 14 * 86400000) },
  });

  let expired = 0;
  for (const sub of stale) {
    try {
      await transitionSubscription(sub._id, 'expired', { notes: 'Suspended period expired' });
      expired += 1;
    } catch (error) {
      /* one bad row must not stop the rest */
    }
  }

  return { expired };
};

/**
 * Trial past its end -> expired.
 *
 * Separate from the dunning sweeps because a trial is not a dunning state: it is healthy
 * until its date passes, and then it is simply over. The `effectiveStatus` virtual already
 * reports an overdue trial as `expired` for READ paths — this sweep is what makes that
 * true in STORAGE, so the activation guard and the console agree with it.
 */
const processTrialExpiry = async () => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const now = new Date();
  const trials = await StoreSubscription.expiringTrials(now);

  let expired = 0;
  for (const sub of trials) {
    try {
      await transitionSubscription(sub._id, 'expired', { notes: 'Trial ended' });
      expired += 1;
    } catch (error) {
      /* one bad row must not stop the rest */
    }
  }

  return { expired };
};

module.exports = {
  getSubscription,
  createSubscription,
  transitionSubscription,
  recordPayment,
  processBillingSweep,
  processGracePeriodExpiry,
  processSuspendedExpiry,
  processTrialExpiry,
  assertTransition,
  SUBSCRIPTION_TRANSITIONS,
};