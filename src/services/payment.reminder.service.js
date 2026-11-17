const remindPendingPayments = async (windowMin = 30, remindAtMin = 25, limit = 100) => {
  const { Orders } = require('../models');
  const { fcmNotificationService } = require('../services');
  const now = Date.now();
  const olderThan = new Date(now - remindAtMin * 60 * 1000);
  const newerThan = new Date(now - (remindAtMin + 5) * 60 * 1000);
  const stuck = await Orders.find(
    { status: 'pending_payments', createdAt: { $gte: newerThan, $lt: olderThan } },
    { user: 1 }
  )
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  if (!stuck || stuck.length === 0) return { checked: 0, reminded: 0 };
  let reminded = 0;
  const minutesLeft = Math.max(windowMin - remindAtMin, 1);
  for (const row of stuck) {
    try {
      const r = await fcmNotificationService.userPaymentExpiring(row._id, row.user, minutesLeft);
      if (r && !r.skipped) reminded += 1;
    } catch (sweepErr) {
      void sweepErr;
    }
  }
  return { checked: stuck.length, reminded };
};

module.exports = { remindPendingPayments };
