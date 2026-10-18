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

const mongoose = require('mongoose');

/**
 * The operational consoles.
 *
 * ## What these are and are not
 *
 * §12.3 lists eight admin surfaces and is explicit that they are "not CRUD screens" —
 * they exist because each one is revenue or trust bleeding at a rate an operator cannot
 * see from a list page. A subscription stuck in `grace_period` for two of its three days
 * looks identical to one that started today in a plain subscription table; it is the
 * difference between a partner and a churned partner.
 *
 * Every function here is a QUERY, not a mutation. They answer "what needs a human, and
 * how urgently". The mutation lives on the record's own screen, which means an operator
 * arrives at a row that already explains why it is in this list.
 *
 * ## `daysRemaining` rather than a boolean
 *
 * Each time-bounded console returns a day count, not just a match. "Overdue" is a
 * question an operator asks; "2 days" is the answer. It is also what makes the console
 * sortable by urgency without a second request.
 */

// ---------------------------------------------------------------------------
// 1. subscription health
// ---------------------------------------------------------------------------

/**
 * Every subscription not in a healthy state, with how long it has been there.
 *
 * `payment_due` and `retrying` are included alongside `grace_period` and `suspended`
 * because they are the two states where action is still cheap. A partner in
 * `grace_period` can be recovered by a successful charge; one in `suspended` cannot take
 * new orders at all.
 */
const subscriptionHealth = async () => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const StoreChain = mongoose.model('StoreChain');
  const StoreSubscriptionPlan = mongoose.model('StoreSubscriptionPlan');

  const subs = await StoreSubscription.find({
    status: { $in: ['payment_due', 'retrying', 'grace_period', 'suspended', 'cancelled', 'expired'] },
  })
    .populate('chain', 'name slug outletCount')
    .populate('plan', 'name slug amount')
    .lean();

  const now = Date.now();
  const days = (d) => (d ? Math.ceil((new Date(d).getTime() - now) / 86400000) : null);

  return subs
    .map((s) => ({
      _id: s._id,
      chainName: s.chain ? s.chain.name : null,
      outletCount: s.chain ? s.chain.outletCount : 0,
      planName: s.plan ? s.plan.name : null,
      amount: s.amount,
      status: s.status,
      retryCount: s.retryCount,
      maxRetries: s.maxRetries,
      nextBillingDate: s.nextBillingDate,
      daysToBilling: days(s.nextBillingDate),
      gracePeriodEndsAt: s.gracePeriodEndsAt,
      daysOfGraceLeft: s.gracePeriodEndsAt ? days(s.gracePeriodEndsAt) : null,
      failureStreak: s.retryCount,
      updatedAt: s.updatedAt,
    }))
    // Worst first: suspended before grace, grace before retrying, retrying before due.
    // A list sorted alphabetically would bury the one row that is actually on fire.
    .sort((a, b) => {
      const rank = { suspended: 0, grace_period: 1, retrying: 2, payment_due: 3, cancelled: 4, expired: 5 };
      const d = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (d !== 0) return d;
      return (a.daysOfGraceLeft ?? 999) - (b.daysOfGraceLeft ?? 999);
    });
};

// ---------------------------------------------------------------------------
// 2. settlement exceptions
// ---------------------------------------------------------------------------

const settlementExceptions = async () => {
  const Settlement = mongoose.model('Settlement');
  const settlements = await Settlement.find({ vertical: 'stores', status: { $in: ['failed', 'disputed', 'reversed', 'processing'] } })
    .populate('counterparty', 'name')
    .populate('store', 'name outletCode')
    .lean();

  const now = Date.now();
  return settlements
    .map((s) => ({
      _id: s._id,
      settlementNo: s.settlementNo,
      counterpartyName: s.counterparty ? s.counterparty.name : null,
      storeName: s.store ? s.store.name : null,
      outletCode: s.store ? s.store.outletCode : null,
      status: s.status,
      netAmount: s.totals ? s.totals.netAmount : 0,
      failureReason: s.failureReason,
      from: s.from,
      to: s.to,
      ageDays: s.createdAt ? Math.floor((now - new Date(s.createdAt).getTime()) / 86400000) : 0,
      createdAt: s.createdAt,
    }))
    .sort((a, b) => {
      const rank = { failed: 0, disputed: 1, reversed: 2, processing: 3 };
      const d = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      return d !== 0 ? d : b.ageDays - a.ageDays;
    });
};

// ---------------------------------------------------------------------------
// 3. refund failures
// ---------------------------------------------------------------------------

const refundFailures = async () => {
  const StoreRefund = mongoose.model('StoreRefund');
  const refunds = await StoreRefund.find({ status: 'FAILED' })
    .populate('customer', 'name mobile')
    .populate('outlet', 'name outletCode')
    .populate('order', 'orderNo grandTotal')
    .lean();

  return refunds.map((r) => ({
    _id: r._id,
    orderNo: r.order ? r.order.orderNo : null,
    storeName: r.store ? r.store.name : null,
    customerName: r.customer ? r.customer.name : null,
    componentKey: r.componentKey,
    amount: r.amount,
    fundingSource: r.fundingSource,
    failureReason: r.failureReason,
    createdAt: r.createdAt,
  }));
};

// ---------------------------------------------------------------------------
// 4. inventory drift
// ---------------------------------------------------------------------------

/**
 * Stock rows whose cached counters disagree with their own arithmetic.
 *
 * `availableQty` is a cache of `onHand - reserved - damaged`. It exists so a browse query
 * can filter on it without an aggregation, which means it can drift when a write path
 * updates one counter and misses the cache — precisely the failure mode §6.5's
 * reconciliation cron exists to catch.
 *
 * A non-zero `movementSeq` with a matching set of movements is what makes this trustworthy
 * rather than a guess, so `driftAmount` is reported explicitly: an operator needs to know
 * whether the cache is off by one unit or by a hundred.
 */
const inventoryDrift = async () => {
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const rows = await StoreOutletStockItem.find({
    $expr: { $ne: ['$availableQty', { $subtract: ['$onHand', { $subtract: ['$reserved', '$damaged'] }] }] },
  })
    .populate('outlet', 'name outletCode')
    .populate('product', 'name slug')
    .lean();

  return rows.map((r) => {
    const expected = r.onHand - r.reserved - r.damaged;
    return {
      _id: r._id,
      outletName: r.outlet ? r.outlet.name : null,
      outletCode: r.outlet ? r.outlet.outletCode : null,
      productName: r.product ? r.product.name : null,
      onHand: r.onHand,
      reserved: r.reserved,
      damaged: r.damaged,
      availableQty: r.availableQty,
      expectedAvailable: expected,
      driftAmount: r.availableQty - expected,
      movementSeq: r.movementSeq,
      updatedAt: r.updatedAt,
    };
  });
};

// ---------------------------------------------------------------------------
// 5. compliance expiry
// ---------------------------------------------------------------------------

/**
 * Compliance documents and subscriptions inside their warning window.
 *
 * The 30/15/7 split is the useful shape: 30 is a planning queue, 7 is this week. A flat
 * "expiring soon" gives an operator no way to triage, so the bucket is computed here.
 */
const complianceExpiry = async () => {
  const StoreComplianceDocument = mongoose.model('StoreComplianceDocument');
  const StoreSubscription = mongoose.model('StoreSubscription');

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);

  const [docs, subs] = await Promise.all([
    StoreComplianceDocument.find({
      status: 'approved',
      expiryDate: { $lte: in30, $gte: now },
    })
      .populate('outlet', 'name outletCode')
      .lean(),
    StoreSubscription.find({
      status: { $in: ['active', 'trial', 'payment_due', 'retrying', 'grace_period'] },
      nextBillingDate: { $lte: in30, $gte: now },
    })
      .populate('chain', 'name slug')
      .lean(),
  ]);

  const bucket = (d) => {
    const days = Math.ceil((new Date(d).getTime() - now.getTime()) / 86400000);
    if (days <= 7) return '7d';
    if (days <= 15) return '15d';
    return '30d';
  };

  return {
    documents: docs.map((d) => ({
      _id: d._id,
      outletName: d.outlet ? d.outlet.name : null,
      outletCode: d.outlet ? d.outlet.outletCode : null,
      docType: d.docType || d.type,
      expiryDate: d.expiryDate,
      daysRemaining: Math.ceil((new Date(d.expiryDate).getTime() - now.getTime()) / 86400000),
      bucket: bucket(d.expiryDate),
    })),
    subscriptions: subs.map((s) => ({
      _id: s._id,
      chainName: s.chain ? s.chain.name : null,
      status: s.status,
      nextBillingDate: s.nextBillingDate,
      daysRemaining: Math.ceil((new Date(s.nextBillingDate).getTime() - now.getTime()) / 86400000),
      bucket: bucket(s.nextBillingDate),
    })),
  };
};

// ---------------------------------------------------------------------------
// 6. organic verification queue
// ---------------------------------------------------------------------------

const organicVerificationQueue = async () => {
  const StoreOrganicVerification = mongoose.model('StoreOrganicVerification');
  const rows = await StoreOrganicVerification.find({ status: { $in: ['pending', 'expired'] } })
    .populate('outlet', 'name outletCode')
    .populate('product', 'name slug')
    .lean();

  const now = Date.now();
  return rows
    .map((v) => ({
      _id: v._id,
      subjectType: v.subjectType,
      subjectName: v.outlet ? v.outlet.name : v.product ? v.product.name : null,
      certificateType: v.certificateType,
      certificateNumber: v.certificateNumber,
      issuingAuthority: v.issuingAuthority,
      status: v.status,
      issueDate: v.issueDate,
      expiryDate: v.expiryDate,
      expiredDaysAgo:
        v.status === 'expired' && v.expiryDate
          ? Math.floor((now - new Date(v.expiryDate).getTime()) / 86400000)
          : null,
      createdAt: v.createdAt,
    }))
    .sort((a, b) => (a.status === 'expired' ? -1 : 1) - (b.status === 'expired' ? -1 : 1));
};

// ---------------------------------------------------------------------------
// 7. abuse queue — flagged reviews and open complaints
// ---------------------------------------------------------------------------

/**
 * Flagged reviews and unresolved complaints, merged into one queue.
 *
 * Two collections, one list. An operator triaging "is this partner a problem" wants one
 * ordered feed; two tabs means choosing a tab, and the choice is a guess.
 */
const abuseQueue = async () => {
  const StoreReview = mongoose.model('StoreReview');
  const StoreComplaint = mongoose.model('StoreComplaint');

  const [reviews, complaints] = await Promise.all([
    StoreReview.find({ $or: [{ status: 'flagged' }, { reportedCount: { $gt: 0 } }] })
      .populate('customer', 'name')
      .populate('outlet', 'name outletCode')
      .lean(),
    StoreComplaint.find({ status: { $in: ['open', 'escalated'] } })
      .populate('customer', 'name')
      .populate('outlet', 'name outletCode')
      .lean(),
  ]);

  const merged = [
    ...reviews.map((r) => ({
      kind: 'review',
      _id: r._id,
      outletName: r.outlet ? r.outlet.name : null,
      outletCode: r.outlet ? r.outlet.outletCode : null,
      customerName: r.customer ? r.customer.name : null,
      rating: r.rating,
      comment: r.comment,
      status: r.status,
      reportedCount: r.reportedCount,
      priority: r.reportedCount > 2 ? 'high' : 'medium',
      createdAt: r.createdAt,
    })),
    ...complaints.map((c) => ({
      kind: 'complaint',
      _id: c._id,
      outletName: c.outlet ? c.outlet.name : null,
      outletCode: c.outlet ? c.outlet.outletCode : null,
      customerName: c.customer ? c.customer.name : null,
      category: c.category,
      subject: c.subject,
      description: c.description,
      status: c.status,
      priority: c.priority || (c.status === 'escalated' ? 'urgent' : 'medium'),
      createdAt: c.createdAt,
    })),
  ];

  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  return merged.sort((a, b) => {
    const d = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
    return d !== 0 ? d : new Date(b.createdAt) - new Date(a.createdAt);
  });
};

// ---------------------------------------------------------------------------
// 8. unreviewed applications ageing
// ---------------------------------------------------------------------------

/**
 * Submitted applications with nothing done to them, oldest first.
 *
 * Separate from the applications queue because that one is ordered by submission date
 * for working through the list; this one is ordered by how long each has been waiting,
 * which is the thing an operator is actually trying to reduce.
 */
const applicationAgeing = async () => {
  const StoreOnboarding = mongoose.model('StoreOnboarding');
  const rows = await StoreOnboarding.find({ status: { $in: ['submitted', 'under_review', 'changes_required'] } }).lean();

  const now = Date.now();
  return rows
    .map((a) => ({
      _id: a._id,
      businessName: a.businessInfo ? a.businessInfo.legalName : null,
      storeName: a.storeInfo ? a.storeInfo.name : null,
      status: a.status,
      submittedAt: a.submittedAt,
      ageDays: a.submittedAt ? Math.floor((now - new Date(a.submittedAt).getTime()) / 86400000) : null,
      incompleteSteps: a.incompleteSteps || [],
      currentStep: a.currentStep,
    }))
    .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
};

/**
 * COD remittance exceptions (§6.21.3, §12.3).
 *
 * Unmatched cash, nonzero variances, and disputed remittances. A `disputed`
 * remittance blocks the outlet's next settlement, so it sorts first; a
 * nonzero variance without dispute is money unaccounted for, second. Clean
 * reconciled rows never appear here — this console answers "what needs a
 * human", not "show me the ledger".
 */
const codRemittance = async () => {
  const StoreDriverRemittance = mongoose.model('StoreDriverRemittance');

  // Getters on: expected/collected/remitted/variance are moneyField-backed
  // (paise inside) and would otherwise display 100x in the console.
  const rows = await StoreDriverRemittance.find({
    $or: [{ status: { $in: ['pending', 'disputed'] } }, { variance: { $ne: 0 } }],
  })
    .populate('driver', 'driverCode name')
    .populate('outlet', 'name outletCode')
    .sort({ date: -1 })
    .lean({ getters: true });

  return rows
    .map((r) => ({
      _id: r._id,
      driver: r.driver,
      outlet: r.outlet,
      date: r.date,
      expected: r.expected,
      collected: r.collected,
      remitted: r.remitted,
      variance: r.variance,
      status: r.status,
    }))
    .sort((a, b) => {
      const rank = (s) => (s === 'disputed' ? 0 : s === 'pending' ? 1 : 2);
      return rank(a.status) - rank(b.status);
    });
};

/**
 * Counts for every console, for the admin dashboard to show without eight requests.
 */
const consoleSummary = async () => {
  const [subs, settlements, refunds, drift, compliance, organic, abuse, applications, cod] = await Promise.all([
    subscriptionHealth(),
    settlementExceptions(),
    refundFailures(),
    inventoryDrift(),
    complianceExpiry(),
    organicVerificationQueue(),
    abuseQueue(),
    applicationAgeing(),
    codRemittance(),
  ]);

  return {
    subscriptionHealth: subs.filter((s) => ['suspended', 'grace_period', 'retrying', 'payment_due'].includes(s.status)).length,
    settlementExceptions: settlements.length,
    refundFailures: refunds.length,
    inventoryDrift: drift.length,
    complianceExpiry: compliance.documents.length + compliance.subscriptions.length,
    organicVerification: organic.length,
    abuse: abuse.length,
    applicationAgeing: applications.filter((a) => (a.ageDays ?? 0) > 3).length,
    codRemittance: cod.length,
  };
};

module.exports = {
  subscriptionHealth,
  settlementExceptions,
  refundFailures,
  inventoryDrift,
  complianceExpiry,
  organicVerificationQueue,
  abuseQueue,
  applicationAgeing,
  codRemittance,
  consoleSummary,
};