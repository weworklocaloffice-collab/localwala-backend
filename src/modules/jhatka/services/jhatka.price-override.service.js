/**
 * jhatka.price-override.service.js — outlet price overrides.
 *
 * ## What an override is, and is not
 *
 * A bounded, approved, temporary departure from the list price (§7.3). It is
 * never a silent repricing: it carries a reason (≥10 chars, enforced by the
 * model), a closed date range (open-ended overrides become permanent prices),
 * and the list price at creation so the variance stays readable without a
 * price history that does not exist.
 *
 * ## The ±20% ceiling
 *
 * Beyond ±20% variance the creator cannot approve their own override — a
 * different approver is required. This is the control that stops one operator
 * setting any price on any variant. `approvedBy` must differ from `createdBy`
 * when `requiresSecondApproval()` is true, enforced here rather than trusted
 * to the caller.
 *
 * ## Money discipline
 *
 * `pricePerUnit` arrives in RUPEES (API convention) and `JhatkaVariant` is
 * read HYDRATED so its moneyField getter also returns RUPEES — like with
 * like, no crossing. `listPriceAtCreation` snapshots the variant's price so
 * `variancePct()` stays computable after the list moves.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');

/** Roles that may approve or revoke another person's override. */
const OVERRIDE_APPROVER_ROLES = ['owner', 'manager'];

function assertApprover(role) {
  if (!OVERRIDE_APPROVER_ROLES.includes(role)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Only an owner or manager may approve a price override',
      true,
      '',
      { code: 'OVERRIDE_APPROVAL_FORBIDDEN', role }
    );
  }
}

/**
 * Outlet overrides, newest first, with live variance + force flags computed.
 */
async function listOverrides({ models, outletId, query }) {
  const { status } = query || {};
  const filter = { outlet: outletId };
  if (status) {
    if (!models.JhatkaPriceOverride.STATUSES.includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown override status '${status}'`);
    }
    filter.status = status;
  }

  const overrides = await models.JhatkaPriceOverride.find(filter)
    .populate('variant', 'name sku priceBasis')
    .sort({ createdAt: -1 })
    .limit(200);

  return {
    overrides: overrides.map((o) => ({
      id: String(o._id),
      variant: o.variant
        ? {
          id: String(o.variant._id),
          name: o.variant.name,
          sku: o.variant.sku,
          priceBasis: o.variant.priceBasis,
        }
        : null,
      pricePerUnit: o.pricePerUnit,
      priceBasis: o.priceBasis,
      listPriceAtCreation: o.listPriceAtCreation,
      variancePct: o.variancePct(),
      requiresSecondApproval: o.requiresSecondApproval(),
      inForce: o.isInForce(),
      status: o.status,
      effectiveFrom: o.effectiveFrom,
      effectiveTo: o.effectiveTo,
      reason: o.reason,
      createdByName: o.createdByName,
      approvedByName: o.approvedByName,
      approvedAt: o.approvedAt,
    })),
  };
}

/**
 * Draft an override. Always starts `draft` — activation is the approve step,
 * so a wide variance can never slip live without a second pair of eyes.
 */
async function createOverride({ models, outletId, actor, body }) {
  const { variant, pricePerUnit, priceBasis, minQuantity, maxQuantity, effectiveFrom, effectiveTo, reason } = body || {};

  if (!variant) throw new ApiError(httpStatus.BAD_REQUEST, 'variant is required');
  if (pricePerUnit === undefined || pricePerUnit === null || Number(pricePerUnit) < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'pricePerUnit is required and must be >= 0');
  }
  if (!effectiveFrom) throw new ApiError(httpStatus.BAD_REQUEST, 'effectiveFrom is required');
  if (!effectiveTo) throw new ApiError(httpStatus.BAD_REQUEST, 'effectiveTo is required');
  if (!reason || String(reason).trim().length < 10) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required (at least 10 characters)');
  }

  const variantDoc = await models.JhatkaVariant.findById(variant);
  if (!variantDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Variant not found');

  // The basis is copied for display AND checked for equality: an override that
  // changed the basis would silently reinterpret what the number means.
  const basis = priceBasis || variantDoc.priceBasis;
  if (basis !== variantDoc.priceBasis) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `priceBasis must match the variant's basis '${variantDoc.priceBasis}'`,
      true,
      '',
      { code: 'PRICE_BASIS_MISMATCH', variantBasis: variantDoc.priceBasis }
    );
  }

  const override = new models.JhatkaPriceOverride({
    outlet: outletId,
    variant: variantDoc._id,
    product: variantDoc.product,
    pricePerUnit: Number(pricePerUnit),
    priceBasis: basis,
    minQuantity: minQuantity || 0,
    maxQuantity: maxQuantity || 0,
    effectiveFrom: new Date(effectiveFrom),
    effectiveTo: new Date(effectiveTo),
    reason: String(reason).trim(),
    status: 'draft',
    listPriceAtCreation: variantDoc.pricePerUnit,
    createdBy: actor._id,
    createdByName: actor.name,
  });

  const overrideError = override.validateSync();
  if (overrideError) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Override failed validation', true, '', {
      fields: Object.keys(overrideError.errors),
    });
  }
  await override.save();

  return {
    override: {
      id: String(override._id),
      variant: String(override.variant),
      pricePerUnit: override.pricePerUnit,
      priceBasis: override.priceBasis,
      listPriceAtCreation: override.listPriceAtCreation,
      variancePct: override.variancePct(),
      requiresSecondApproval: override.requiresSecondApproval(),
      status: override.status,
      effectiveFrom: override.effectiveFrom,
      effectiveTo: override.effectiveTo,
    },
    note: override.requiresSecondApproval()
      ? 'Beyond ±20%: a different approver (owner/manager) must activate this.'
      : 'Within ±20%: ready to activate.',
  };
}

/**
 * Activate a draft. Beyond the ceiling the approver must differ from the
 * creator; within it the creator may self-approve if they hold the role.
 */
async function approveOverride({ models, outletId, actor, role, override: overrideId }) {
  assertApprover(role);

  const override = await models.JhatkaPriceOverride.findOne({ _id: overrideId, outlet: outletId });
  if (!override) throw new ApiError(httpStatus.NOT_FOUND, 'Override not found for this outlet');
  if (override.status !== 'draft') {
    throw new ApiError(httpStatus.CONFLICT, `Override is ${override.status}, not draft`);
  }

  if (override.requiresSecondApproval() && String(override.createdBy) === String(actor._id)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Beyond ±20% variance the approver must differ from the creator',
      true,
      '',
      { code: 'SECOND_APPROVAL_REQUIRED', variancePct: override.variancePct() }
    );
  }

  override.status = 'active';
  override.approvedBy = actor._id;
  override.approvedByName = actor.name;
  override.approvedAt = new Date();
  await override.save();

  return {
    override: {
      id: String(override._id),
      status: override.status,
      approvedByName: override.approvedByName,
      approvedAt: override.approvedAt,
      inForce: override.isInForce(),
    },
  };
}

/**
 * Revoke a live override. The row stays for the price audit; only its status
 * moves, with who/when/why attached.
 */
async function revokeOverride({ models, outletId, actor, role, override: overrideId, revokeReason }) {
  assertApprover(role);

  const override = await models.JhatkaPriceOverride.findOne({ _id: overrideId, outlet: outletId });
  if (!override) throw new ApiError(httpStatus.NOT_FOUND, 'Override not found for this outlet');
  if (override.status !== 'active') {
    throw new ApiError(httpStatus.CONFLICT, `Only an active override can be revoked (is ${override.status})`);
  }
  if (!revokeReason || String(revokeReason).trim().length < 3) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'revokeReason is required');
  }

  override.status = 'revoked';
  override.revokedAt = new Date();
  override.revokedBy = actor._id;
  override.revokedByName = actor.name;
  override.revokeReason = String(revokeReason).trim();
  await override.save();

  return {
    override: { id: String(override._id), status: override.status, revokedAt: override.revokedAt },
  };
}

module.exports = {
  listOverrides,
  createOverride,
  approveOverride,
  revokeOverride,
  OVERRIDE_APPROVER_ROLES,
};
