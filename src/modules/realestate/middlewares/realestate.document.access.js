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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/**
 * BR-18 — who may see which document.
 *
 * ## Why this is a middleware and a single lookup table, not a response mapper
 *
 * A response mapper is one forgotten `.select()` away from leaking a vendor's PAN into
 * a customer payload, and the failure is silent: the response looks fine, the field is
 * just there. A middleware is one missing route-mount away, and when it is missing
 * every route under it fails loudly.
 *
 * So the visibility decision is one table, applied by one middleware on every property
 * document route, and the query it produces is the only way documents are read.
 *
 * ## The second half: `fileUrl` never leaves for a non-privileged actor
 *
 * Blueprint §14 says "show only safe customer-facing verification information". A
 * customer is entitled to know *that* an ownership document cleared. They are not
 * entitled to the document. Returning the URL and trusting the client to hide it is not
 * access control — the URL works for anyone who has it.
 *
 * `redact()` therefore strips `fileUrl`, `fileName` and `checksum` for actors that may
 * see the *existence* of a document but not the file.
 */

/**
 * The lookup table. One row per actor type; nothing else in the codebase should know
 * this mapping.
 *
 *   customer   — sees that documents cleared, never the files
 *   executive  — same as a customer; a field agent is not a document reviewer
 *   vendor     — sees their OWN internal working papers (scoped separately by owner)
 *   bank       — sees income/tax papers for assessment, plus what the customer sees
 *   admin      — everything, including reviewer material
 */
const VISIBILITY_BY_ACTOR = {
  guest: ['CUSTOMER_VISIBLE'],
  customer: ['CUSTOMER_VISIBLE'],
  executive: ['CUSTOMER_VISIBLE'],
  vendor: ['INTERNAL', 'CUSTOMER_VISIBLE'],
  bank: ['BANK_VISIBLE', 'CUSTOMER_VISIBLE'],
  admin: ['INTERNAL', 'CUSTOMER_VISIBLE', 'BANK_VISIBLE', 'ADMIN_ONLY'],
};

/**
 * Actors allowed to receive `fileUrl`. Everyone else gets metadata only.
 *
 * A vendor may download their own documents — that is scoped by ownership downstream,
 * not by this list. A customer is not on it at all.
 */
const ACTORS_WHO_MAY_DOWNLOAD = ['vendor', 'bank', 'admin'];

const documentAccess = {
  VISIBILITY_BY_ACTOR,
  ACTORS_WHO_MAY_DOWNLOAD,

  /**
   * Resolve an actor type from the request.
   *
   * `req.user.role` is set by the passport strategies. `guest` is the default so an
   * unrecognised role gets the narrowest set rather than the widest.
   *
   * @param {object} req
   * @returns {string}
   */
  actorTypeOf(req) {
    const role = (req && req.user && req.user.role) || 'guest';
    if (VISIBILITY_BY_ACTOR[role]) return role;
    // A bank is modelled as the `bank` role; anything else unknown is treated as guest.
    return 'guest';
  },

  /**
   * The visibility classes an actor may read.
   *
   * @param {string} actorType
   * @returns {Array<string>}
   */
  allowedClasses(actorType) {
    return VISIBILITY_BY_ACTOR[actorType] || VISIBILITY_BY_ACTOR.guest;
  },

  /**
   * Whether an actor may receive a file URL at all.
   *
   * @param {string} actorType
   * @returns {boolean}
   */
  mayDownload(actorType) {
    return ACTORS_WHO_MAY_DOWNLOAD.includes(actorType);
  },

  /**
   * Build the query fragment a document read MUST include.
   *
   * @param {string} actorType
   * @param {string|ObjectId} propertyId
   * @returns {object} a Mongo filter
   */
  buildQuery(actorType, propertyId) {
    const query = { visibility: { $in: documentAccess.allowedClasses(actorType) } };
    if (propertyId) query.property = propertyId;
    return query;
  },

  /**
   * Strip what an actor must not receive.
   *
   * @param {object} doc a document (lean or hydrated)
   * @param {string} actorType
   * @returns {object}
   */
  redact(doc, actorType) {
    if (!doc) return doc;
    const out = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };

    if (!documentAccess.mayDownload(actorType)) {
      delete out.fileUrl;
      delete out.fileName;
      delete out.checksum;
    }
    // `rejectionReason` and `verifiedBy` are reviewer working notes.
    if (actorType !== 'admin' && actorType !== 'vendor') {
      delete out.rejectionReason;
      delete out.verifiedBy;
    }
    return out;
  },

  /**
   * Redact a list.
   *
   * @param {Array<object>} docs
   * @param {string} actorType
   * @returns {Array<object>}
   */
  redactAll(docs, actorType) {
    return (docs || []).map((d) => documentAccess.redact(d, actorType));
  },

  /**
   * Express middleware. Resolves the actor once and puts the decision on the request.
   *
   * Handlers read `req.documentAccess.allowedClasses` and `req.documentAccess.mayDownload`
   * rather than re-deriving them. Re-deriving is how two routes end up disagreeing.
   *
   * @returns {Function} Express middleware
   */
  attach() {
    return (req, res, next) => {
      const actorType = documentAccess.actorTypeOf(req);
      req.documentAccess = {
        actorType,
        allowedClasses: documentAccess.allowedClasses(actorType),
        mayDownload: documentAccess.mayDownload(actorType),
        buildQuery: (propertyId) => documentAccess.buildQuery(actorType, propertyId),
        redact: (doc) => documentAccess.redact(doc, actorType),
        redactAll: (docs) => documentAccess.redactAll(docs, actorType),
      };
      return next();
    };
  },

  /**
   * Assert a single document may be read by this actor.
   *
   * For a by-id fetch, where the query fragment above cannot be used because the id is
   * the key. Returns 404, not 403, for a document the actor may not see — a 403
   * confirms the document exists, which is itself a disclosure.
   *
   * @param {object} doc
   * @param {object} req requires `req.documentAccess`
   * @throws {ApiError} 404
   */
  assertReadable(doc, req) {
    if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
    const access = req && req.documentAccess;
    const allowed = (access && access.allowedClasses) || VISIBILITY_BY_ACTOR.guest;
    if (!allowed.includes(doc.visibility)) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
    }
    return doc;
  },
};

module.exports = documentAccess;
