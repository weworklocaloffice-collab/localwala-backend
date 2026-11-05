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
 * jhatka.area-change.service.js — partner-proposed delivery-area changes.
 *
 * The partner proposes new ring values (increase OR decrease); the admin
 * approves and the values apply atomically. The platform ceiling
 * (`Vertical.settings.maxRadiusKm`, fallback 12) is checked at REQUEST time —
 * a proposal beyond it is refused immediately with the reason, never parked in
 * a queue destined for rejection. Direct outlets don't need this flow: admin
 * edits their area directly via the outlets PATCH.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/** Platform ceiling fallback when the Vertical row carries no value. */
const DEFAULT_MAX_RADIUS_KM = 12;

/** Read the platform ceiling for jhatka delivery radii, in km. */
async function getMaxRadiusKm({ models }) {
  const vertical = await models.Vertical.findOne({ key: 'jhatka' })
    .select('settings')
    .lean();
  const max = Number(vertical?.settings?.maxRadiusKm);
  return Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_RADIUS_KM;
}

/**
 * Partner proposes new ring values.
 *
 * Guards, in order:
 *   1. One OPEN request per outlet (partial-unique index + explicit check for
 *      the readable 409).
 *   2. radiusKm + extendedRadiusKm ≤ platform maxRadiusKm — the ceiling is on
 *      the TOTAL reach, not each band independently.
 *   3. extendedRadiusKm > 0 requires extendedDeliveryFee > 0 (a promised paid
 *      band with no price is a misconfiguration, mirroring resolveDeliveryFee).
 *   4. Direct outlets are refused: they are LocalWala's own counters — admin
 *      edits their area directly.
 *
 * @param {object} p
 * @param {object} p.models   `{ JhatkaOutlet, JhatkaAreaChangeRequest, Vertical }`
 * @param {string} p.outletId from the TENANT
 * @param {object} p.actor    `{ _id, name }`
 * @param {object} p.body     `{ proposed: { radiusKm, extendedRadiusKm, extendedDeliveryFee }, reason }`
 */
async function createAreaRequest({ models, outletId, actor, body }) {
  const { JhatkaOutlet, JhatkaAreaChangeRequest } = models;

  // HYDRATED, not lean: `serviceArea.extendedDeliveryFee` is a `moneyField`, so
  // property access returns RUPEES. That is what the compare snapshot stores
  // (the model's own moneyField converts back to paise at rest).
  const outlet = await JhatkaOutlet.findById(outletId);
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  if (outlet.businessModel === 'direct') {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Direct outlets are operated by LocalWala — the delivery area is edited by admin directly',
      true, '', { code: 'DIRECT_OUTLET_NO_REQUEST' }
    );
  }

  const open = await JhatkaAreaChangeRequest.findOne({
    outlet: outletId,
    status: 'requested',
  }).lean();
  if (open) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Request ${open.requestNo} is already pending for this outlet`,
      true, '', { code: 'AREA_REQUEST_ALREADY_OPEN', requestNo: open.requestNo }
    );
  }

  const proposed = body?.proposed || {};
  const radiusKm = Number(proposed.radiusKm);
  const extendedRadiusKm = Number(proposed.extendedRadiusKm ?? 0);
  // RUPEES at the edge; the model's moneyField stores paise.
  const extendedDeliveryFee = Number(proposed.extendedDeliveryFee ?? 0);
  if (!Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'radiusKm must be a number ≥ 0');
  }
  if (!Number.isFinite(extendedRadiusKm) || extendedRadiusKm < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'extendedRadiusKm must be a number ≥ 0');
  }
  if (!Number.isFinite(extendedDeliveryFee) || extendedDeliveryFee < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'extendedDeliveryFee must be a number ≥ 0');
  }
  if (!body?.reason || String(body.reason).trim().length < 3) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A reason is required (the admin reads it)');
  }

  const maxRadiusKm = await getMaxRadiusKm({ models });
  if (radiusKm + extendedRadiusKm > maxRadiusKm) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `The platform ceiling is ${maxRadiusKm} km total reach — this proposal asks for ${(radiusKm + extendedRadiusKm).toFixed(1)} km`,
      true, '',
      { code: 'PLATFORM_RADIUS_CEILING', maxRadiusKm, requested: radiusKm + extendedRadiusKm }
    );
  }
  if (extendedRadiusKm > 0 && extendedDeliveryFee <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'A paid band requires a fee — an outer ring priced at zero is a misconfiguration',
      true, '', { code: 'OUTER_BAND_ZERO_FEE' }
    );
  }

  const requestNo = `JA${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const request = await JhatkaAreaChangeRequest.create({
    requestNo,
    outlet: outlet._id,
    business: outlet.business,
    businessModel: outlet.businessModel,
    requestedBy: actor._id,
    requestedByName: actor.name,
    proposed: { radiusKm, extendedRadiusKm, extendedDeliveryFee },
    current: {
      radiusKm: outlet.serviceArea?.radiusKm,
      extendedRadiusKm: outlet.serviceArea?.extendedRadiusKm ?? 0,
      extendedDeliveryFee: outlet.serviceArea?.extendedDeliveryFee ?? 0,
    },
    reason: String(body.reason).trim(),
    status: 'requested',
  });

  return { request: request.toObject(), maxRadiusKm };
}

/**
 * Admin approves: the proposed values apply to the outlet's serviceArea
 * atomically, and the approval is stamped on the request.
 */
async function approveAreaRequest({ models, requestId, actor }) {
  const { JhatkaAreaChangeRequest, JhatkaOutlet } = models;
  const request = await JhatkaAreaChangeRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Area request not found');
  if (!models.JhatkaAreaChangeRequest.canTransition(request.status, 'approved')) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${request.status} area request cannot be approved`,
      true, '', { code: 'ILLEGAL_AREA_MOVE', from: request.status }
    );
  }

  const outlet = await JhatkaOutlet.findById(request.outlet);
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

  // Field-by-field, NOT a spread of `serviceArea`: spreading a Mongoose
  // subdocument drags `polygon`/`localities` internals into a plain object and
  // the save then fails its cast on `serviceArea.polygon`. (Seen in the
  // integration suite: a 500 on a legitimate approval.)
  outlet.set('serviceArea.radiusKm', request.proposed.radiusKm);
  outlet.set('serviceArea.extendedRadiusKm', request.proposed.extendedRadiusKm);
  // `request.proposed.extendedDeliveryFee` is RUPEES on a hydrated doc (its
  // moneyField getter); the outlet's own moneyField stores paise.
  outlet.set('serviceArea.extendedDeliveryFee', request.proposed.extendedDeliveryFee);
  await outlet.save();

  request.status = 'approved';
  request.approval = { by: actor._id, byName: actor.name, at: new Date() };
  await request.save();

  const savedArea = outlet.serviceArea?.toObject
    ? outlet.serviceArea.toObject()
    : outlet.serviceArea;
  return { request: request.toObject(), serviceArea: savedArea };
}

async function rejectAreaRequest({ models, requestId, reason }) {
  const { JhatkaAreaChangeRequest } = models;
  const request = await JhatkaAreaChangeRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Area request not found');
  if (!models.JhatkaAreaChangeRequest.canTransition(request.status, 'rejected')) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${request.status} area request cannot be rejected`,
      true, '', { code: 'ILLEGAL_AREA_MOVE', from: request.status }
    );
  }
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'A rejection reason is required');
  request.status = 'rejected';
  request.statusReason = reason;
  await request.save();
  return { request: request.toObject() };
}

async function cancelAreaRequest({ models, requestId, actor }) {
  const { JhatkaAreaChangeRequest } = models;
  const request = await JhatkaAreaChangeRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Area request not found');
  if (!models.JhatkaAreaChangeRequest.canTransition(request.status, 'cancelled')) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${request.status} area request cannot be cancelled`,
      true, '', { code: 'ILLEGAL_AREA_MOVE', from: request.status }
    );
  }
  request.status = 'cancelled';
  request.cancelledBy = actor._id;
  request.cancelledAt = new Date();
  await request.save();
  return { request: request.toObject() };
}

module.exports = {
  createAreaRequest,
  approveAreaRequest,
  rejectAreaRequest,
  cancelAreaRequest,
  getMaxRadiusKm,
};
