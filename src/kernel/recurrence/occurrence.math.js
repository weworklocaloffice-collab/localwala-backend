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

const nextOccurrence = (from, cadence, intervalCount = 1) => {
  const d = new Date(from);
  switch (cadence) {
    case 'weekly': d.setDate(d.getDate() + 7 * intervalCount); break;
    case 'biweekly': d.setDate(d.getDate() + 14 * intervalCount); break;
    case 'monthly': d.setMonth(d.getMonth() + intervalCount); break;
    default: d.setDate(d.getDate() + 7 * intervalCount);
  }
  return d;
};

const isDue = (nextDate, today = new Date()) => new Date(nextDate) <= today;

const getOccurrenceDates = (startDate, cadence, count, intervalCount = 1) => {
  const dates = [];
  let current = new Date(startDate);
  for (let i = 0; i < count; i += 1) {
    dates.push(new Date(current));
    current = nextOccurrence(current, cadence, intervalCount);
  }
  return dates;
};

module.exports = {
  nextOccurrence,
  isDue,
  getOccurrenceDates,
};