/**
 * jhatka.delivery.service.js — deliver a completed order and create a POD.
 *
 * ## Why this belongs in a service
 *
 * The `/deliveries/:delivery/deliver` handler is 150 lines of intertwined logic:
 * idempotency checks, cold‑chain breach detection, POD creation, complaint generation,
 * delivery‑status updates, COD collection, order finalisation, and driver‑statistics
 * increments. Moving it out makes the route thin and lets the same rules be reused
 * from a standalone `/pod` call (which also needs idempotency and POD creation without
 * marking the delivery delivered).
 *
 * ## Idempotency
 *
 * The unique index on `{ delivery: 1, clientRef: 1 }` guarantees that a retry of the
 * same `clientRef` produces a replay rather than a duplicate POD. The service mirrors
 * that guarantee.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { assertStatus } = require('../middlewares/jhatka.delivery');
const { savePod, maybeCreateComplaint } = require('./jhatka.pod.service');
const { syncOrderRefundState } = require('./jhatka.refund.settlement');
const lifecycleService = require('./jhatka.order-lifecycle.service');
const complianceGate = require('./jhatka.compliance-gate.service');
const { verifyOtp } = require('./jhatka.otp.service');
const { JhatkaDeliveryPOD, JhatkaDriver, JhatkaOrder, JhatkaRefund, JhatkaOutlet, JhatkaCompliance } = require('../../../models');

/** Deliver a delivery and create a POD.  Idempotent on `clientRef`. */
async function deliverPod({ delivery, clientRef, deliveredTempC, photo, signature,
  location, otp, receiverName, codCollected, note, capturedBy, capturedByName }) {
  // Idempotency first: a retried deliver must not create a second POD.
  const existing = await JhatkaDeliveryPOD.findOne({ delivery: delivery._id, clientRef });
  if (existing) {
    return {
      delivery: { id: String(delivery._id), status: delivery.status },
      pod: {
        id: String(existing._id),
        clientRef: existing.clientRef,
        deliveredTempC: existing.deliveredTempC,
        coldChainBreached: existing.coldChainBreached,
        codCollected: existing.codCollected,
      },
      idempotentReplay: true,
    };
  }

  // Idempotency first, status second: a retry of a completed deliver must
  // replay, not 409. A fresh deliver for a delivery that never left the
  // counter still refuses.
  assertStatus(delivery, ['out_for_delivery']);

  // §12.2, fulfil class: only a SUSPENDED outlet stops a delivery in progress.
  // The bag is already on a bike — an FSSAI lapse this morning does not un-deliver
  // it, and refusing here would strand the rider with a customer waiting. But a
  // suspended outlet's deliveries stop, because suspension means "do not trade", not
  // "finish up first".
  if (delivery.outlet) {
    const outletDoc = await JhatkaOutlet.findById(delivery.outlet).lean();
    if (outletDoc) {
      await complianceGate.assertJhatkaOperational({
        outlet: outletDoc,
        operation: 'deliver',
        models: { JhatkaCompliance },
      });
    }
  }

  const maxTempC = delivery.coldChain?.maxTempC ?? 4;
  const breach = deliveredTempC === undefined || deliveredTempC === null
    ? false
    : Number(deliveredTempC) > maxTempC;

  // Delivery OTP, when the customer issued one. Until now the code travelled
  // from customer to rider to POD without anything checking it — `verifyOtp`
  // existed, was unit-tested, and had zero callers outside its own file. A
  // handover code nobody verifies is not security, it is theatre.
  //
  // Opt-in per order: no issued code means no check. An issued-but-unverified
  // code means the rider MUST present it — a wrong code is distinguished from
  // an expired one because an expired code is not the rider's fault and a wrong
  // one might be. Attempts are persisted on failure so the 5-try limit is real
  // across retries rather than per-request.
  const deliveredOrderForOtp = await JhatkaOrder.findById(delivery.order);
  if (deliveredOrderForOtp?.deliveryOtp?.codeHash && !deliveredOrderForOtp.deliveryOtp.verifiedAt) {
    if (otp === undefined || otp === null || String(otp).trim() === '') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'This delivery requires the customer handover code',
        true,
        '',
        { code: 'OTP_REQUIRED' }
      );
    }
    const verdict = verifyOtp(deliveredOrderForOtp, String(otp).trim());
    // Persist attempts even on failure — otherwise the limit resets every retry.
    await deliveredOrderForOtp.save();
    if (!verdict.ok) {
      const messages = {
        EXPIRED: 'The handover code expired — ask the customer to issue a fresh one.',
        TOO_MANY_ATTEMPTS: 'Too many wrong codes — ask the customer to issue a fresh one.',
        ALREADY_USED: 'This code was already used.',
        INVALID: `Wrong code${verdict.remainingAttempts !== undefined ? ` — ${verdict.remainingAttempts} tries left` : ''}.`,
        NO_OTP: 'No handover code on this order.',
      };
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        messages[verdict.code] || 'Handover code not accepted',
        true,
        '',
        { code: verdict.code, remainingAttempts: verdict.remainingAttempts }
      );
    }
    deliveredOrderForOtp.deliveryOtp.verifiedBy = capturedBy;
    await deliveredOrderForOtp.save();
  }

  const pod = await savePod({
    delivery, clientRef, deliveredTempC, photo, signature, location, otp,
    receiverName, codCollected, note, capturedBy, capturedByName,
  });

  // A post‑delivery temperature breach raises a complaint AUTOMATICALLY (-13.4).
  if (breach) {
    await maybeCreateComplaint({ delivery, pod, breach, deliveredTempC, maxTempC });
  }

  // Mark the delivery as delivered.
  delivery.status = 'delivered';
  delivery.proofOfDelivery = pod._id;

  if (delivery.coldChain) {
    delivery.coldChain.deliveredTempC = deliveredTempC === undefined ? undefined : Number(deliveredTempC);
    delivery.coldChain.deliveredAt = new Date();
    delivery.coldChain.breachDetectedAt = breach ? new Date() : undefined;
    delivery.coldChain.breachComplaint = pod.complaint;
  }

  if (delivery.codStatus === 'pending') {
    delivery.codStatus = 'collected';
    // Matches the handler this was extracted from: whatever was collected is
    // recorded, temp or no temp. An earlier draft zeroed this when no
    // temperature was captured, which would have silently dropped COD money.
    delivery.codCollectedAmount = Number(codCollected || 0);
    delivery.codCollectedAt = new Date();
    delivery.codCollectedBy = capturedBy;
  }

  await delivery.save();

  // Finalise the order — through the lifecycle table, not around it.
  //
  // This used to be a raw `findByIdAndUpdate(delivery.order, { lifecycle: 'DELIVERED' })`,
  // which moves ANY state to DELIVERED: a cancelled order, a rejected order, an order
  // still at WEIGHING. The guard is the whole point of §8.2, and bypassing it here
  // meant the strictest part of the state machine had a back door at its most
  // consequential step.
  //
  // `tryMoveTo` rather than throwing: the DELIVERY already happened — the customer has
  // the bag. Refusing to record that because the order is in an unexpected state
  // would leave the money and the meat disagreeing, which is worse than recording a
  // delivery against an odd state and logging it loudly.
  const deliveredOrder = await JhatkaOrder.findById(delivery.order);
  if (deliveredOrder && deliveredOrder.lifecycle !== 'DELIVERED') {
    const moved = await lifecycleService.tryMoveTo(deliveredOrder, 'DELIVERED', {
      deliveredAt: new Date(),
    });
    if (!moved.moved) {
      console.error(
        `[jhatka.delivery] delivered ${delivery._id} but order ${delivery.order} is ${moved.from} — cannot move to DELIVERED`
      );
      deliveredOrder.deliveredAt = new Date();
      await deliveredOrder.save();
    }
  }

  // A delivered order with refunds still in flight is not finished — it is
  // REFUND_PENDING. A weight shortfall refunded at the counter does not stop the van,
  // so it is a side document all the way through fulfillment; DELIVERED is the first
  // state that can legally hold it, and this is where it lands.
  //
  // Best-effort by design: if the sync fails the delivery still happened. The 03:30
  // refund sweep and the next `syncOrderRefundState` call will pick it up.
  try {
    await syncOrderRefundState({
      models: { JhatkaOrder, JhatkaRefund },
      orderId: delivery.order,
    });
  } catch (error) {
    console.error(
      `[jhatka.delivery] delivered ${delivery.order} but could not sync refunds: ${error.message}`
    );
  }

  // Update driver statistics.
  await JhatkaDriver.findOneAndUpdate({ user: capturedBy }, {
    available: true,
    $inc: { 'stats.totalDeliveries': 1 },
  });

  return {
    delivery: {
      id: String(delivery._id),
      status: delivery.status,
      codStatus: delivery.codStatus,
      codCollectedAmount: delivery.codCollectedAmount,
    },
    pod: {
      id: String(pod._id),
      deliveredTempC: pod.deliveredTempC,
      maxTempC: pod.maxTempC,
      coldChainBreached: pod.coldChainBreached,
      complaintRaised: !!pod.complaint,
    },
  };
}

/** Collect COD amount for a delivery.  Idempotent on `clientRef`. */
async function collectPod({ delivery, amountPaise, clientRef, receiptPhoto, capturedBy }) {
  if (amountPaise === undefined) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountPaise is required');
  }
  const amount = Number(amountPaise);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountPaise must be a non-negative integer');
  }

  // Idempotency first: a retried collect must not double-record.
  if (delivery.codCollectedAt) {
    return {
      delivery: {
        id: String(delivery._id),
        codStatus: delivery.codStatus,
        codCollectionAmount: delivery.codCollectionAmount,
        codCollectedAmount: delivery.codCollectedAmount,
        codVariance: delivery.codVariance,
      },
      idempotentReplay: true,
      note: clientRef
        ? 'A collection was already recorded for this delivery'
        : 'A collection was already recorded for this delivery; pass a distinct clientRef only for a genuinely separate settlement',
    };
  }
  if (delivery.codStatus === 'not_applicable') {
    throw new ApiError(httpStatus.CONFLICT, 'This delivery is not COD');
  }
  if (delivery.codStatus === 'reconciled') {
    throw new ApiError(httpStatus.CONFLICT, 'COD for this delivery is already reconciled');
  }

  delivery.codStatus = 'collected';
  delivery.codCollectedAmount = amount;
  delivery.codCollectedAt = new Date();
  delivery.codCollectedBy = capturedBy;
  if (receiptPhoto) delivery.codReceiptUrl = receiptPhoto;
  delivery.codVariance = amount - (delivery.codCollectionAmount || 0);
  await delivery.save();

  return {
    delivery: {
      id: String(delivery._id),
      codStatus: delivery.codStatus,
      codCollectionAmount: delivery.codCollectionAmount,
      codCollectedAmount: delivery.codCollectedAmount,
      codVariance: delivery.codVariance,
      underCollected: delivery.codVariance < 0,
    },
  };
}

module.exports = {
  deliverPod,
  collectPod,
};