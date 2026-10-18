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
 * StoreRoleAssignment — who may do what, and where (BR-40).
 *
 * WHY THIS IS A MODEL AND NOT `User.role`
 *
 * `User.role` is a single platform enum derived from `config/roles.js`. That answers
 * "what kind of account is this" — `storePartner` or `storeDriver`. It cannot answer
 * "what may Raj do this morning", because the same human can be an inventory manager
 * in one business and an order manager in another, and may cover four outlets in one
 * chain and none in another.
 *
 * So role and scope live here, keyed by business and chain. `User.role` is untouched.
 *
 * SCOPE IS THE POINT
 *
 *   scopeType 'outlet'    -> `outlets[]` is the complete authority. Nothing outside it.
 *   scopeType 'chain'     -> every outlet in this chain
 *   scopeType 'business'  -> every chain and outlet in this business
 *
 * A role with `*` permissions is STILL constrained by scope. A regional_manager
 * scoped to one outlet has exactly the authority of a manager at that outlet and
 * nothing anywhere else. Scope is enforced by `resolveActorOutlet` in
 * middlewares/stores.tenant.js on EVERY request — see 2.4 in the specification.
 *
 * @typedef StoreRoleAssignment
 */
const storeRoleAssignmentSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },

    role: {
      type: String,
      required: true,
      enum: [
        'owner',
        'manager',
        'order_manager',
        'inventory_manager',
        'dispatcher',
        'regional_manager',
        'staff',
      ],
    },

    scopeType: {
      type: String,
      required: true,
      enum: ['outlet', 'chain', 'business'],
    },
    // REQUIRED and non-empty when scopeType is 'outlet'. An outlet-scoped role with
    // an empty list would silently mean "no access", which reads as a broken login.
    outlets: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreOutlet',
        required: false,
      },
    ],

    // Denormalised from the role map so an audit can reconstruct authority later even
    // if the role map changes. See services/stores.staff.service.js for ROLE_PERMISSIONS.
    permissions: {
      type: [String],
      default: [],
    },

    // Marks the assignment a partner lands on when they have more than one.
    isPrimary: {
      type: Boolean,
      required: false,
      default: false,
    },

    /**
     * The outlet this person last worked in, per assignment.
     *
     * This is what makes the no-header case safe without a session. The platform is
     * stateless JWT — there is no `req.session` — so "which outlet am I working in"
     * has to live somewhere. Putting it HERE means the fallback value comes from the
     * database and cannot be forged, whereas a client-supplied value is only ever a
     * hint that is validated against scope anyway.
     */
    lastActiveOutletId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: false,
    },
    lastActiveAt: {
      type: Date,
      required: false,
    },

    status: {
      type: String,
      required: false,
      default: 'active',
      enum: ['active', 'inactive', 'suspended'],
    },
    statusReason: {
      type: String,
      required: false,
    },

    joinedAt: {
      type: Date,
      required: false,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      required: false,
    },
    notes: {
      type: String,
      required: false,
      trim: true,
    },

    // Who granted this, so "why can Priya see Hyderabad" is answerable.
    grantedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

storeRoleAssignmentSchema.plugin(toJSON);
storeRoleAssignmentSchema.plugin(paginate);

storeRoleAssignmentSchema.index({ user: 1, business: 1, status: 1 });
storeRoleAssignmentSchema.index({ chain: 1, role: 1, status: 1 });
storeRoleAssignmentSchema.index({ user: 1, chain: 1, outlets: 1 });

/**
 * The complete set of outlets this assignment grants authority over.
 * Used by resolveActorOutlet. Empty array means no access, never "all".
 *
 * @returns {Promise<string[]>} outlet ids
 */
/**
 * Every outlet id this assignment grants authority over. Empty array means NO access,
 * never "all".
 *
 * ## Why this static exists AND is still not the authority
 *
 * It is a convenience for callers holding a populated assignment. It is NOT used by the
 * request path: `stores.profile.service.permittedOutletIds` is, because that one also
 * handles a populated `outlets[]` and returns ids in a consistent order. Two
 * implementations of one rule is a smell, so if this is ever changed, change both and
 * run `verify.stores.tenancy.js`, which asserts they agree.
 */
storeRoleAssignmentSchema.statics.resolveOutletIds = async function resolveOutletIds() {
  if (this.scopeType === 'outlet') return (this.outlets || []).map((o) => String(o._id || o));

  const Outlet = mongoose.model('StoreOutlet');
  const filter =
    this.scopeType === 'chain'
      ? { chain: this.chain, status: { $ne: 'archived' } }
      : {
          // 'chain', not 'distinct("chain")'. StoreChain has no `chain` field, so the
          // old spelling returned an empty array and every business-scoped assignment
          // silently resolved to ZERO outlets — a false "no access" that looks like
          // correct fail-closed behaviour and hides the real misconfiguration.
          chain: {
            $in: await mongoose
              .model('StoreChain')
              .distinct('_id', { business: this.business }),
          },
          status: { $ne: 'archived' },
        };

  const outlets = await Outlet.find(filter).select('_id').lean();
  return outlets.map((o) => String(o._id));
};

const StoreRoleAssignment = mongoose.model('StoreRoleAssignment', storeRoleAssignmentSchema);

module.exports = StoreRoleAssignment;