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
 * Business-hours SLA clock.
 *
 * Deadlines used to be plain wall-clock arithmetic: a ticket raised at 11pm
 * on a Sunday was "breached" before anyone had a chance to log in. Real
 * support organisations pause the clock outside staffed hours and on holidays,
 * so this adds `addWorkingSeconds(start, seconds, schedule)`.
 *
 * A schedule is `{ days: { mon: [540, 1080], ... }, timezone: 'Asia/Kolkata' }`
 * where each entry is [startMinute, endMinute] in minutes from midnight.
 * `days` may be empty or null, which means 24x7 - the previous behaviour, so
 * existing tickets keep their deadlines and existing policies need no edit.
 */

// One week, Monday-first, matching the `mon`..`sun` keys.
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const is24x7 = (schedule) => {
  if (!schedule || !schedule.days) return true;
  return Object.keys(schedule.days).length === 0;
};

// Offset in minutes from midnight for a given local instant, in the schedule's
// timezone. Kept dependency-free on purpose: `Intl.DateTimeFormat` is already
// required by the SLA dashboard, and this avoids pulling in a tz library for
// two numbers.
const zonedParts = (date, timeZone) => {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = {};
    for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
    const hour = parseInt(parts.hour, 10) % 24; // Intl can emit 24 for midnight
    return {
      dayKey: String(parts.weekday || '').toLowerCase().slice(0, 3),
      minute: hour * 60 + parseInt(parts.minute, 10),
    };
  } catch {
    // Unknown timezone: behave as UTC rather than throwing inside a deadline
    // calculation.
    const dayKey = DAY_KEYS[date.getUTCDay()];
    return { dayKey, minute: date.getUTCHours() * 60 + date.getUTCMinutes() };
  }
};

// Start of the given local day as a real Date, by walking the calendar day in
// the target timezone. Small helper used only to step forward whole days.
const addDays = (date, timeZone, days) => {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

/**
 * Add `seconds` of BUSINESS time to `from`.
 *
 * Returns `from` unchanged for a 24x7 schedule, so tickets created while the
 * feature is off behave exactly as before.
 */
const addWorkingSeconds = (from, seconds, schedule) => {
  const needed = Math.max(0, Math.round(seconds || 0));
  if (!needed) return new Date(from.getTime());
  if (is24x7(schedule)) return new Date(from.getTime() + needed * 1000);

  const timeZone = schedule.timezone;
  const days = schedule.days || {};
  const cursor = new Date(from.getTime());
  // Guard against a schedule with no usable window (every day empty): treat it
  // as 24x7 rather than looping forever.
  const hasWindow = Object.keys(days).some((k) => (days[k] || []).length > 0);
  if (!hasWindow) return new Date(from.getTime() + needed * 1000);

  let remaining = needed;
  // Windows per weekday, cleaned and sorted once.
  const windowsFor = (dayKey) =>
    (days[dayKey] || [])
      .map((w) => [Math.min(w[0], w[1]), Math.max(w[0], w[1])])
      .filter((w) => w[1] > w[0])
      .sort((a, b) => a[0] - b[0]);

  // Each step either finishes inside the next open window, lands exactly on a
  // window's end, or rolls to the next day. Re-reading the local time every
  // iteration matters: a day can hold several windows (lunch breaks), and the
  // previous implementation broke out of the window list after the first one,
  // so a shift with a mid-day gap silently jumped to the NEXT DAY instead of
  // resuming after the gap.
  for (let guard = 0; guard < 400 && remaining > 0; guard += 1) {
    const { dayKey, minute } = zonedParts(cursor, timeZone);
    const next = windowsFor(dayKey).find(([, end]) => minute < end);

    if (!next) {
      // Nothing open for the rest of today: jump to 00:00 local tomorrow.
      const tomorrow = addDays(cursor, timeZone, 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      if (tomorrow.getTime() <= cursor.getTime()) return new Date(from.getTime() + needed * 1000);
      cursor.setTime(tomorrow.getTime());
      // eslint-disable-next-line no-continue
      continue;
    }

    const [start, end] = next;
    const into = minute > start ? minute : start;
    const availableSec = (end - into) * 60;
    if (remaining <= availableSec) {
      return new Date(cursor.getTime() + (into - minute) * 60 * 1000 + remaining * 1000);
    }
    remaining -= availableSec;
    cursor.setTime(cursor.getTime() + (end - minute) * 60 * 1000);
  }

  // Ran past the guard (pathological schedule): fall back to wall clock rather
  // than returning a deadline in the past.
  return new Date(from.getTime() + needed * 1000);
};

/**
 * Seconds of deadline already consumed by `at`, counting only business time
 * between `start` and `at`. Used to decide whether a ticket is breached now.
 */
const workedSecondsBetween = (start, at, schedule) => {
  if (is24x7(schedule)) return Math.max(0, Math.round((at - start) / 1000));
  if (at <= start) return 0;
  // Walk forward in 1-minute slices inside working windows. Bounded to 30
  // days of history, which is far beyond any SLA window in use.
  let worked = 0;
  const timeZone = schedule.timezone;
  const days = schedule.days || {};
  let cursor = new Date(start.getTime());
  const end = new Date(at.getTime());
  while (cursor < end && worked < 30 * 24 * 3600) {
    const { dayKey, minute } = zonedParts(cursor, timeZone);
    const windows = (days[dayKey] || [])
      .map((w) => [Math.min(w[0], w[1]), Math.max(w[0], w[1])])
      .filter((w) => w[1] > w[0]);
    for (const [ws, we] of windows) {
      if (minute >= we) continue;
      const into = minute > ws ? minute : ws;
      const windowEnd = cursor.getTime() + (we - into) * 60 * 1000;
      const sliceEnd = Math.min(windowEnd, end.getTime());
      if (sliceEnd > cursor.getTime()) {
        worked += Math.round((sliceEnd - cursor.getTime()) / 1000);
        cursor = new Date(sliceEnd);
        if (cursor >= end) return worked;
        break;
      }
    }
    // Outside every window: jump a day forward.
    const next = new Date(addDays(cursor, timeZone, 1).getTime());
    next.setUTCHours(0, 0, 0, 0);
    if (next.getTime() <= cursor.getTime()) return worked;
    cursor = next;
  }
  return worked;
};

module.exports = {
  addWorkingSeconds,
  workedSecondsBetween,
  is24x7,
};