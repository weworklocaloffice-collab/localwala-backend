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

/**
 * Shift coverage.
 *
 * Availability is a self-declared toggle, so the roster can only ever reflect
 * what an agent claims. A shift makes it factual: outside their own window the
 * sweep marks them offline so auto-assign stops handing them tickets, and at
 * the start of a shift it restores whatever they were set to before.
 *
 * Design decision worth stating: outside a shift the SWEEP WINS. An agent can
 * still pick Available by hand, but the next tick will take it back. That looks
 * unhelpful until you see the alternative - someone silently on the roster at
 * 2am because their toggle was left on - which is exactly the failure this is
 * here to prevent.
 *
 * TICKETS ARE NEVER TOUCHED. Going off-shift changes routing only; it must not
 * dump an agent's open tickets back into the queue, because that is the single
 * most destructive thing this sweep could do.
 */

const { addWorkingSeconds, workedSecondsBetween } = require('./support.working.hours.service');
const logger = require('../config/logger');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Minutes-from-midnight for a given local instant.
const zonedMinute = (at, timeZone) => {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = {};
    for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
    return (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10);
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
};

const dayKeyOf = (at, timeZone) => {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', weekday: 'short' });
    const parts = {};
    for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
    return String(parts.weekday || '').toLowerCase().slice(0, 3);
  } catch {
    return DAY_KEYS[at.getUTCDay()];
  }
};

const windowsFor = (shift, at) => {
  const dayKey = dayKeyOf(at, shift.timezone);
  const list = (shift.days && shift.days[dayKey]) || [];
  return list
    .map((w) => [Math.min(w[0], w[1]), Math.max(w[0], w[1])])
    .filter((w) => w[1] > w[0])
    .sort((a, b) => a[0] - b[0]);
};

const shiftApplies = (shift, at) => {
  if (!shift || !shift.isActive || shift.autoOffline === false) return false;
  if (shift.effectiveFrom && at < new Date(shift.effectiveFrom)) return false;
  if (shift.effectiveTo && at > new Date(shift.effectiveTo)) return false;
  return true;
};

/**
 * Is this agent meant to be working at `at`?
 *
 * `at` defaults to now, and the function is deliberately exported pure so the
 * coverage board and the sweep can never disagree about who is on shift.
 */
const isOnShift = (shift, at = new Date()) => {
  if (!shiftApplies(shift, at)) return false;
  const minute = zonedMinute(at, shift.timezone);
  return windowsFor(shift, at).some(([start, end]) => minute >= start && minute < end);
};

/** Minutes until the next window opens today (0 if already inside one). */
const minutesToNextShift = (shift, at = new Date()) => {
  const minute = zonedMinute(at, shift.timezone);
  const windows = windowsFor(shift, at);
  // Already inside a window: the next shift is now, not negative minutes.
  if (windows.some(([start, end]) => minute >= start && minute < end)) return 0;
  const upcoming = windows.find(([start]) => start > minute);
  if (upcoming) return upcoming[0] - minute;
  return null;
};

/**
 * Apply every agent's shift to their presence.
 *
 * Returns counts so the sweep is observable rather than a silent fire-and-
 * forget job - this is the kind of job that fails quietly and takes the roster
 * with it.
 */
const applyShifts = async (at = new Date()) => {
  const { SupportShift, AgentPresence } = require('../models');
  const shifts = await SupportShift.find({ isActive: true }).select('agentId timezone days autoOffline').lean();

  let markedOffline = 0;
  let restored = 0;
  let skipped = 0;

  for (const shift of shifts) {
    if (!shiftApplies(shift, at)) {
      skipped += 1;
      // eslint-disable-next-line no-continue
      continue;
    }
    const onShift = isOnShift(shift, at);
    // eslint-disable-next-line no-await-in-loop
    const presence = await AgentPresence.findOne({ agentId: shift.agentId }).select('offShift preShiftAvailability availability').lean();

    if (onShift) {
      // Only restore what WE changed. An agent who set themselves offline by
      // hand must stay offline when their shift starts.
      if (presence && presence.offShift) {
        const restore = presence.preShiftAvailability || 'available';
        // eslint-disable-next-line no-await-in-loop
        await AgentPresence.updateOne(
          { agentId: shift.agentId, offShift: true },
          {
            $set: { offShift: false, availability: restore, preShiftAvailability: undefined },
          }
        );
        restored += 1;
      }
    } else if (presence && !presence.offShift) {
      // Remember what they had chosen so shift start can restore it.
      // eslint-disable-next-line no-await-in-loop
      await AgentPresence.updateOne(
        { agentId: shift.agentId, offShift: { $ne: true } },
        {
          $set: {
            offShift: true,
            preShiftAvailability: presence.availability || 'available',
            availability: 'offline',
          },
        }
      );
      markedOffline += 1;
    }
  }

  return { shifts: shifts.length, markedOffline, restored, skipped };
};

/**
 * Coverage board: who is scheduled, who is actually in, and who is short.
 * `now` is injectable so the timeline preview below can ask about other times.
 */
const coverageBoard = async (at = new Date()) => {
  const { SupportShift, AgentPresence, User } = require('../models');
  const shifts = await SupportShift.find({ isActive: true })
    .populate('agentId', 'firstName lastName image role')
    .lean();
  const ids = shifts.map((s) => s.agentId && s.agentId._id).filter(Boolean);
  const presence = await AgentPresence.find({ agentId: { $in: ids } })
    .select('agentId online availability lastSeen openTickets offShift')
    .lean();
  const presMap = {};
  for (const p of presence) presMap[String(p.agentId)] = p;

  const rows = shifts.map((s) => {
    const p = presMap[String(s.agentId)] || {};
    const fresh = p.lastSeen && Date.now() - new Date(p.lastSeen).getTime() < 90 * 1000;
    const online = !!(p.online && fresh && !p.offShift);
    return {
      agentId: String(s.agentId._id),
      name: `${s.agentId.firstName || ''} ${s.agentId.lastName || ''}`.trim(),
      role: s.agentId.role,
      shiftName: s.name,
      timezone: s.timezone,
      onShift: isOnShift(s, at),
      // Scheduled and actually here - the gap between the two is the whole
      // point of the board.
      present: online,
      status: online ? (p.availability === 'busy' ? 'busy' : 'available') : 'offline',
      offShift: !!p.offShift,
      openNow: p.openTickets || 0,
      startsInMin: minutesToNextShift(s, at),
      endsAt: (() => {
        const minute = zonedMinute(at, s.timezone);
        const win = windowsFor(s, at).find(([, end]) => end > minute);
        if (!win) return null;
        const d = new Date(at.getTime() + (win[1] - minute) * 60 * 1000);
        return d;
      })(),
    };
  });

  return {
    at,
    scheduled: rows.filter((r) => r.onShift).length,
    present: rows.filter((r) => r.onShift && r.present).length,
    missing: rows.filter((r) => r.onShift && !r.present).map((r) => r.name),
    rows,
  };
};

/** Today's timeline for the board: each shift's current window, in local time. */
const timeline = async () => {
  const { SupportShift } = require('../models');
  const shifts = await SupportShift.find({ isActive: true }).select('timezone days').lean();
  const at = new Date();
  const buckets = {};
  for (const s of shifts) {
    const minute = zonedMinute(at, s.timezone);
    const win = windowsFor(s, at).find(([start, end]) => minute >= start && minute < end);
    const tz = s.timezone || 'UTC';
    buckets[tz] = buckets[tz] || [];
    buckets[tz].push(win ? { start: win[0], end: win[1] } : null);
  }
  return buckets;
};

module.exports = {
  applyShifts,
  isOnShift,
  minutesToNextShift,
  coverageBoard,
  timeline,
  zonedMinute,
  dayKeyOf,
};