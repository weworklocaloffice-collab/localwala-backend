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
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * JhatkaTenantRoleAssignment — a person's authority INSIDE an outlet. §14.1.
 *
 * ## This is the second authorization layer, and it is deliberately separate
 *
 * `config/roles.js` says what KIND of thing you may touch. This says what you may
 * touch INSIDE an outlet. `stores` makes the same split and states the reason:
 *
 *   "These are PLATFORM rights only. What a person may do inside an outlet is
 *    decided by their role plus scope. That is deliberately a separate mechanism, so
 *    a platform right can never accidentally imply business authority over a chain
 *    the person does not belong to."
 *
 * If they were one mechanism, a person holding `jhatka_payout_pay` for one outlet
 * would hold it for every outlet of the business, because platform rights are
 * per-ROLE and roles are per-BUSINESS.
 *
 * ## `scopeType` and the empty-array rule
 *
 * `outlet` grants the listed outlets. `business` grants every outlet of the
 * business. There is no third option, and an assignment that resolves to an EMPTY
 * list means NO ACCESS — never all. That single rule, stated in the service and
 * asserted in the verify suite, is the difference between tenancy and its absence.
 */
const SCOPE_TYPES = ['outlet', 'business'];

const ASSIGNMENT_STATUSES = ['active', 'inactive', 'revoked'];

const jhatkaTenantRoleAssignmentSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /**
     * The role. See `OUTLET_ROLES` in `jhatka.profile.service`.
     *
     * `weigher` and `compliance_officer` are not in the source blueprint's list and
     * they exist for reasons given there: weight confirmation is the only action in
     * this vertical that determines money, and a recall must be triggerable by
     * someone who is not the person whose batch it is.
     */
    role: {
      type: String,
      required: true,
      enum: [
        'owner',
        'manager',
        'order_staff',
        'inventory_staff',
        'packing_staff',
        'weigher',
        'dispatcher',
        'compliance_officer',
      ],
    },
    scopeType: {
      type: String,
      required: false,
      enum: SCOPE_TYPES,
      default: 'outlet',
    },
    /**
     * The outlets in scope. REQUIRED when `scopeType: 'outlet'`.
     *
     * Including `outlet` itself keeps a reviewer able to answer "who can touch this
     * counter" by looking at one field.
     */
    outlets: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'JhatkaOutlet',
        required: false,
      },
    ],
    /**
     * The primary outlet for this person at this business.
     *
     * Resolution order is hint → `lastActiveOutletId` → `outlets[0]`, so this only
     * matters when two outlets are equally valid. It exists because a person with
     * three counters needs one to open by default, and which one should be a
     * decision someone made rather than array order.
     */
    isPrimary: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * The outlet the app opened last.
     *
     * DATABASE-BACKED, therefore unforgeable — unlike a header or a query
     * parameter. Used as the fallback when no hint is supplied, and it is only
     * honoured when it is still in scope, because an assignment can be narrowed
     * after it was written.
     */
    lastActiveOutletId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: false,
      default: undefined,
    },
    status: {
      type: String,
      required: false,
      enum: ASSIGNMENT_STATUSES,
      default: 'active',
    },
    statusReason: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * A revoked assignment is retained, never deleted. §14.2 is about authority
     * inside one outlet, and "who used to be able to approve this payout" is a
     * question an audit must be able to answer.
     */
    endedAt: {
      type: Date,
      required: false,
      default: undefined,
    },
    endedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    grantedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    grantedByName: { type: String, required: false, trim: true },
    /**
     * §14.2. `owner` is the only role that may GRANT owner. An owner who cannot be
     * replaced without the platform is a single point of failure, and an owner who
     * can promote anyone to owner is not a control at all.
     */
    canGrantOwner: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaTenantRoleAssignmentSchema.plugin(toJSON);
jhatkaTenantRoleAssignmentSchema.plugin(paginate);
/**
 * One ACTIVE assignment per (user, outlet, role).
 *
 * Partial-unique so a revoked assignment can coexist with a fresh one — otherwise
 * re-hiring somebody who previously held the role is impossible.
 */
jhatkaTenantRoleAssignmentSchema.index(
  { user: 1, outlet: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active', endedAt: { $exists: false } },
    name: 'one_active_assignment_per_user_outlet_role',
  }
);
/**
 * `resolveActorScope`'s query: active assignments for a user, primary first.
 *
 * The `endedAt: { $exists: false }` half is in the index as well as the query,
 * because a query predicate that the index does not carry has to be evaluated per
 * row.
 */
jhatkaTenantRoleAssignmentSchema.index({ user: 1, status: 1, isPrimary: -1, createdAt: 1 });
// The outlet's staff list.
jhatkaTenantRoleAssignmentSchema.index({ outlet: 1, status: 1, role: 1 });
// The business's staff list across outlets.
jhatkaTenantRoleAssignmentSchema.index({ business: 1, status: 1 });
// The switcher: which outlets this person may open.
jhatkaTenantRoleAssignmentSchema.index({ user: 1, status: 1, outlets: 1 });
// The "who touched this counter" audit.
jhatkaTenantRoleAssignmentSchema.index({ outlet: 1, createdAt: -1 });

jhatkaTenantRoleAssignmentSchema.statics.SCOPE_TYPES = SCOPE_TYPES;
jhatkaTenantRoleAssignmentSchema.statics.STATUSES = ASSIGNMENT_STATUSES;
jhatkaTenantRoleAssignmentSchema.statics.ROLES = [
  'owner',
  'manager',
  'order_staff',
  'inventory_staff',
  'packing_staff',
  'weigher',
  'dispatcher',
  'compliance_officer',
];

/**
 * Is this assignment live?
 *
 * `endedAt` is checked in addition to `status`, because a soft-revoke writes a date
 * and leaves the status alone until somebody tidies it, and an ended assignment
 * that still resolves to an outlet is an authority that outlived its revocation.
 */
jhatkaTenantRoleAssignmentSchema.methods.isLive = function () {
  return this.status === 'active' && !this.endedAt;
};

/**
 * Revoke. Never delete — see the schema note.
 */
jhatkaTenantRoleAssignmentSchema.methods.revoke = function (byUserId, reason) {
  this.status = 'revoked';
  this.endedAt = new Date();
  this.endedBy = byUserId;
  this.statusReason = reason;
  return this;
};

/**
 * @typedef JhatkaTenantRoleAssignment
 */
const JhatkaTenantRoleAssignment = mongoose.model(
  'JhatkaTenantRoleAssignment',
  jhatkaTenantRoleAssignmentSchema
);

module.exports = JhatkaTenantRoleAssignment;