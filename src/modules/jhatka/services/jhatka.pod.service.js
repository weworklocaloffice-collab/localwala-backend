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
 * jhatka.pod.service.js — proof-of-delivery capture.
 *
 * Extracted verbatim from the `/deliver` handler: POD construction with its
 * validation gate, plus the automatic cold-chain-breach complaint. Both the
 * `/deliver` close-out and the standalone `/pod` evidence capture need POD
 * creation — but only `/deliver` marks the delivery delivered, and conflating
 * the two lets a rider close a COD order by photographing it.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { JhatkaDeliveryPOD, JhatkaComplaint } = require('../../../models');

/**
 * Build, validate and save a POD. Returns the saved document.
 */
async function savePod({
  delivery, clientRef, deliveredTempC, photo, signature,
  location, otp, receiverName, codCollected, note, capturedBy, capturedByName,
}) {
  const maxTempC = delivery.coldChain?.maxTempC ?? 4;
  const breach =
    deliveredTempC === undefined || deliveredTempC === null
      ? false
      : Number(deliveredTempC) > maxTempC;

  const pod = new JhatkaDeliveryPOD({
    delivery: delivery._id,
    order: delivery.order,
    clientRef,
    photo,
    signature,
    location: Array.isArray(location?.coordinates)
      ? { type: 'Point', coordinates: location.coordinates }
      : undefined,
    deliveredTempC: deliveredTempC === undefined ? undefined : Number(deliveredTempC),
    maxTempC,
    coldChainBreached: breach,
    codCollected: delivery.codStatus === 'pending' ? Number(codCollected || 0) : 0,
    otp,
    receiverName,
    note,
    capturedBy,
    capturedByName,
    capturedAt: new Date(),
  });

  const podError = pod.validateSync();
  if (podError) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'POD failed validation', true, '', {
      fields: Object.keys(podError.errors),
    });
  }
  await pod.save();
  return pod;
}

/**
 * A post-delivery temperature breach raises a complaint AUTOMATICALLY.
 * Nobody has to remember: the complaint is created by the delivery itself.
 * Sets `pod.complaint` and persists the pod.
 */
async function maybeCreateComplaint({ delivery, pod, breach, deliveredTempC, maxTempC }) {
  if (!breach) return null;
  const complaint = await JhatkaComplaint.create({
    complaintNo: `CP-DEL-${delivery.deliveryNo}`,
    order: delivery.order,
    outlet: delivery.outlet,
    customer: delivery.customer,
    category: 'food_safety',
    source: 'automatic_cold_chain',
    triggeredBy: 'system',
    subject: 'Cold-chain breach at delivery',
    description: `Delivered at ${deliveredTempC}°C, above the ${maxTempC}°C limit`,
    observedTempC: Number(deliveredTempC),
    status: 'open',
    windowHours: 24,
  });
  pod.complaint = complaint._id;
  await pod.save();
  return complaint;
}

module.exports = { savePod, maybeCreateComplaint };
