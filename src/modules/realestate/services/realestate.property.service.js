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

const { status: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const ApiError = require('../../../utils/ApiError');
const RealEstateProperty = require('../models/realestate.property.model');
const categoryService = require('./realestate.category.service');
const entitlementService = require('./realestate.listing.entitlement.service');
const auditService = require('./realestate.audit.service');
const geographicService = require('../../../kernel/geographic/services/geographic.service');

/**
 * Property service — creation, editing and the moderation lifecycle.
 *
 * ## Transitions are a table, checked in one place
 *
 * Blueprint §8 defines the lifecycle. The rule from the plan's `§0.0 Rules of
 * engagement` is that transitions live in a table in the service, are allow-listed a
 * second time in Joi, and the target state is a route parameter.
 *
 * The reason for a table rather than `if` statements at each call site: every
 * additional state is a chance to leave one path open. `DRAFT → PUBLISHED` must be
 * impossible, and the only way to be sure it is impossible is for there to be exactly
 * one place that decides.
 *
 * ## `status` and `availability` move independently (BR-11)
 *
 * Two tables, two functions, no cross-writes. A moderation action never changes
 * availability and a commercial action never changes status. Conflating them is how a
 * held property disappears from search while customers are still asking about it.
 *
 * ## Nothing is hard-deleted (BR-21)
 *
 * There is no `remove()` here. A property with a lead against it must keep existing.
 * `ARCHIVED` is the terminal state and it is reachable from anywhere.
 */

/**
 * Moderation transitions. `→` means "from the key, to any of the values".
 *
 * Read as: which target states are reachable from a given current state.
 */
const STATUS_TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'ARCHIVED'],
  // Resubmission after a correction returns to SUBMITTED, not straight to IN_REVIEW —
  // otherwise the review queue has no record that the vendor resubmitted.
  SUBMITTED: ['IN_REVIEW', 'CHANGES_REQUIRED', 'REJECTED', 'ARCHIVED'],
  IN_REVIEW: ['APPROVED', 'CHANGES_REQUIRED', 'REJECTED', 'ARCHIVED'],
  // APPROVED is the gate. Only a verified property is publishable (BR-03, BR-04).
  APPROVED: ['PUBLISHED', 'CHANGES_REQUIRED', 'REJECTED', 'ARCHIVED'],
  CHANGES_REQUIRED: ['SUBMITTED', 'REJECTED', 'ARCHIVED'],
  PUBLISHED: ['SUSPENDED', 'EXPIRED', 'SOLD', 'RENTED', 'ARCHIVED'],
  // A suspended listing is reinstated to PUBLISHED, not back through review — the
  // content did not change, the suspension did.
  SUSPENDED: ['PUBLISHED', 'ARCHIVED'],
  // Renewal after package expiry.
  EXPIRED: ['PUBLISHED', 'ARCHIVED'],
  // Terminal.
  REJECTED: ['ARCHIVED'],
  SOLD: ['ARCHIVED'],
  RENTED: ['ARCHIVED'],
  ARCHIVED: [],
};

/**
 * Commercial transitions (BR-11, blueprint §49).
 */
const AVAILABILITY_TRANSITIONS = {
  AVAILABLE: ['ON_HOLD', 'SOLD', 'RENTED', 'UNAVAILABLE', 'SUSPENDED'],
  // A hold released returns the unit to the market; a hold converted becomes a sale.
  ON_HOLD: ['AVAILABLE', 'SOLD', 'RENTED', 'UNAVAILABLE', 'SUSPENDED'],
  UNAVAILABLE: ['AVAILABLE'],
  SUSPENDED: ['AVAILABLE'],
  // Terminal for this property. A relist is a new property, because the sale record
  // references this one and must keep resolving.
  SOLD: [],
  RENTED: [],
};

/**
 * Which states may be set directly by which actor.
 *
 * The moderation path is the interesting one: a vendor may move their own listing
 * DRAFT → SUBMITTED and nothing else. Every review-side transition is admin-only,
 * because the whole point of verification is that the vendor cannot approve
 * themselves.
 */
const STATUS_ACTORS = {
  SUBMITTED: ['vendor', 'admin'],
  IN_REVIEW: ['admin'],
  APPROVED: ['admin'],
  CHANGES_REQUIRED: ['admin'],
  REJECTED: ['admin'],
  PUBLISHED: ['admin'],
  SUSPENDED: ['admin'],
  EXPIRED: ['system', 'admin'],
  SOLD: ['admin', 'system'],
  RENTED: ['admin', 'system'],
  ARCHIVED: ['vendor', 'admin'],
};

const realEstatePropertyService = {
  STATUS_TRANSITIONS,
  AVAILABILITY_TRANSITIONS,
  STATUS_ACTORS,

  // ------------------------------------------------------------- transitions

  /**
   * Assert a moderation transition is legal for this actor.
   *
   * @param {string} from current status
   * @param {string} to target status
   * @param {'vendor'|'admin'|'system'} actorType
   * @throws {ApiError} 422 when the transition is not allowed
   */
  assertStatusTransition(from, to, actorType) {
    if (!STATUS_TRANSITIONS[from]) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Unknown current status "${from}"`);
    }
    if (!STATUS_TRANSITIONS[to]) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Unknown target status "${to}"`);
    }
    if (from === to) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Property is already ${to}`);
    }

    const reachable = STATUS_TRANSITIONS[from];
    if (!reachable.includes(to)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Cannot move a property from ${from} to ${to}. From ${from} you may go to ` +
          `${reachable.length ? reachable.join(', ') : '(nothing — terminal state)'}.`
      );
    }

    const allowedActors = STATUS_ACTORS[to] || [];
    if (!allowedActors.includes(actorType)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        `A ${actorType} may not move a property to ${to}. Permitted: ` +
          `${allowedActors.join(', ') || '(nobody)'}.`
      );
    }
  },

  /**
   * Assert a commercial transition is legal.
   *
   * There is deliberately no separate actor table here: every availability change is
   * driven by a recorded business event (a hold, a sale, an admin suspension), and the
   * guard that matters is that the event exists — not who is calling.
   *
   * @param {string} from
   * @param {string} to
   * @throws {ApiError} 422
   */
  assertAvailabilityTransition(from, to) {
    if (!AVAILABILITY_TRANSITIONS[from]) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Unknown availability "${from}"`);
    }
    if (!AVAILABILITY_TRANSITIONS[to]) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Unknown availability "${to}"`);
    }
    if (from === to) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Property is already ${to}`);
    }
    const reachable = AVAILABILITY_TRANSITIONS[from];
    if (!reachable.includes(to)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Cannot move availability from ${from} to ${to}. From ${from}: ` +
          `${reachable.length ? reachable.join(', ') : '(terminal)'}.`
      );
    }
  },

  // ------------------------------------------------------------------ codes

  /**
   * A human-facing reference, e.g. `RE-HYD-A3F10C`.
   *
   * Built from the city slug plus the tail of a fresh ObjectId. The ObjectId is the
   * source of randomness because Mongo already guarantees its uniqueness, and the
   * unique index on `propertyCode` catches the (rare) 24-bit tail collision — see
   * `create`, which retries.
   *
   * Not a sequential counter on purpose: a counter needs its own atomic collection,
   * and at this phase adding a fifth model to hold two integers is a poor trade. If
   * sequential codes are wanted later, a `RealEstateCounter` with
   * `findOneAndUpdate({$inc})` is the right shape — it is atomic and needs no
   * transaction.
   *
   * @param {object} city a City document, `{ name }`
   * @returns {string}
   */
  generatePropertyCode(city) {
    const prefix = String((city && city.name) || 'IND')
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 3)
      .toUpperCase()
      .padEnd(3, 'X');
    const tail = new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase();
    return `RE-${prefix}-${tail}`;
  },

  // ---------------------------------------------------------------- helpers

  /**
   * BR-19. Resolve the operational zone from the locality, server-side.
   *
   * Never accepted from a client. A client-supplied zone would let a vendor place
   * their listing in whichever zone has the more active executives.
   *
   * @param {string|ObjectId} localityId
   * @returns {Promise<ObjectId|null>}
   */
  async resolveZone(localityId) {
    if (!localityId) return null;
    const zone = await geographicService.findZoneByLocality(localityId);
    return zone ? zone._id : null;
  },

  /**
   * Freeze the customer-visible category facts at publish time (blueprint §56).
   *
   * @param {object} category
   * @returns {object}
   */
  buildCategorySnapshot(category) {
    return {
      key: category.key,
      name: category.name,
      group: category.group,
      amenityOptions: category.amenityOptions || [],
      frozenAt: new Date(),
    };
  },

  /**
   * Which spec keys a category allows a customer to filter on.
   *
   * Used by the public filters endpoint so the client renders the right controls
   * without a hardcoded per-category map.
   *
   * @param {object} category
   * @returns {Array<object>} descriptors for filterable fields only
   */
  filterableFields(category) {
    const fields = (category.specSchema && category.specSchema.fields) || [];
    const keys = category.filterableKeys;
    if (!Array.isArray(keys) || !keys.length) return [];
    return fields.filter((f) => keys.includes(f.key));
  },

  // ------------------------------------------------------------------ write

  /**
   * Create a property.
   *
   * @param {object} payload
   * @param {object} actor `{ _id, actorType }`
   * @returns {Promise<object>}
   * @throws {ApiError} 422 on invalid category, specs, amenities or coordinates
   */
  async create(payload, actor = {}) {
    const category = await categoryService.findById(payload.category);
    if (!category) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Unknown property category');
    }
    if (category.status === false) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Category "${category.key}" is disabled and cannot be used for new listings`
      );
    }

    const tts = category.transactionTypes;
    if (Array.isArray(tts) && tts.length && !tts.includes(payload.transactionType)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Category "${category.key}" supports ${tts.join(', ')}, not ${payload.transactionType}`
      );
    }

    // Category-specific fields. Throws with the field path on a bad value.
    const specs = categoryService.validateSpecs(category, payload.specs);
    const amenities = categoryService.validateAmenities(category, payload.amenities);

    // Location arrives nested (`location: { locality, city, ... }`) from the
    // vendor controller, flat (`locality`, `city`, ...) from older callers
    // (services, scripts, tests). Both shapes work: nested wins when both
    // carry a value, because the validated request body is authoritative.
    // Without this, `payload.locality` is undefined on the HTTP path, the
    // zone never resolves, and the required top-level refs fail validation.
    const loc =
      payload.location && typeof payload.location === 'object' ? payload.location : {};
    const locality = loc.locality !== undefined ? loc.locality : payload.locality;
    const city = loc.city !== undefined ? loc.city : payload.city;
    const country = loc.country !== undefined ? loc.country : payload.country;

    // BR-19 — derived, never taken from the client.
    const operationalZone = await realEstatePropertyService.resolveZone(locality);

    // `state` follows the same rule: explicit caller value wins (admin,
    // scripts), otherwise the locality's zone supplies it, otherwise null.
    // No client can resolve a State id, so requiring it here would make
    // creation impossible from any UI.
    let state = loc.state !== undefined ? loc.state : payload.state;
    if (!state && operationalZone) {
      const OperationalZone = require('../../../kernel/geographic/models/operational.zone.model');
      const zone = await OperationalZone.findById(operationalZone).select('state').lean();
      if (zone && zone.state) state = zone.state;
    }

    // `generatePropertyCode` wants the city *document* (for the name
    // prefix). The controller never sends one, so resolve the name here —
    // otherwise every vendor listing codes as RE-IND-*.
    let cityDoc = payload.cityDoc;
    if (!cityDoc && city) {
      const City = require('../../../models/city.model');
      cityDoc = await City.findById(city).select('name').lean();
    }

    const doc = {
      ...payload,
      locality,
      city,
      country,
      state,
      specs,
      amenities,
      operationalZone,
      // Always DRAFT on create. A property is never born published (BR-03/BR-04).
      status: 'DRAFT',
      availability: 'AVAILABLE',
      createdBy: actor._id,
      updatedBy: actor._id,
    };

    // Complete GeoJSON: the vendor payload carries coordinates but no
    // `type` (Joi forbids it), and the schema deliberately defaults
    // nothing (F-13). With coordinates present, `Point` is correct —
    // without it radius search cannot match the listing.
    if (doc.location && doc.location.coordinates && !doc.location.type) {
      doc.location = { ...doc.location, type: 'Point' };
    }

    // `propertyCode` is unique, so a tail collision must be retried rather than
    // surfaced as a 500. Three attempts is generous: the chance of one collision with
    // a 24-bit space is ~1 in 16 million.
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const property = await RealEstateProperty.create({
          ...doc,
          propertyCode: realEstatePropertyService.generatePropertyCode(cityDoc),
        });

        // BR-20 — property creation is a permission-bearing fact.
        await auditService.record({
          eventType: 'LISTING_PUBLISHED',
          targetType: 'Property',
          targetId: property._id,
          actor: actor._id,
          actorType: actor.actorType || 'admin',
          after: { status: property.status, source: property.source },
          metadata: { createdBy: String(actor._id), source: property.source },
        });

        return property;
      } catch (e) {
        if (e.code === 11000 && /propertyCode/.test(e.message)) {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Could not allocate a unique property code after 3 attempts' +
        (lastErr ? `: ${lastErr.message}` : '')
    );
  },

  /**
   * Update an editable property.
   *
   * Editing a PUBLISHED property is allowed for content, and does NOT send it back
   * through review — with one exception: changing a field that was verified. That
   * exception is enforced in Phase 3 when the verification record exists; here the
   * caller passes `actorType: 'admin'` to edit a published listing.
   *
   * @param {string} id
   * @param {object} payload
   * @param {object} actor
   * @returns {Promise<object>}
   */
  async update(id, payload, actor = {}) {
    const property = await RealEstateProperty.findById(id);
    if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
    if (property.status === 'ARCHIVED') {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'An archived property cannot be edited');
    }

    const category = await categoryService.findById(payload.category || property.category);
    if (!category) throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Unknown property category');

    const update = { ...payload, updatedBy: actor._id };

    if (payload.specs !== undefined) {
      update.specs = categoryService.validateSpecs(category, payload.specs);
    }
    if (payload.amenities !== undefined) {
      update.amenities = categoryService.validateAmenities(category, payload.amenities);
    }
    if (payload.locality !== undefined) {
      // Moving a property moves its zone. Derived again, never accepted.
      update.operationalZone = await realEstatePropertyService.resolveZone(payload.locality);
    }
    if (payload.location && typeof payload.location === 'object' && payload.location.locality !== undefined) {
      // The vendor controller nests location (`location: { locality, ... }`),
      // so `payload.locality` above never fires on the HTTP path. A move
      // re-derives the zone AND the state (same rule as create); moving out
      // of zone coverage clears the state rather than leaving a stale one.
      if (String(property.locality) !== String(payload.location.locality)) {
        update.operationalZone = await realEstatePropertyService.resolveZone(payload.location.locality);
        update.state = null;
        if (update.operationalZone) {
          const OperationalZone = require('../../../kernel/geographic/models/operational.zone.model');
          const zone = await OperationalZone.findById(update.operationalZone).select('state').lean();
          if (zone && zone.state) update.state = zone.state;
        }
      }
    }

    // `categorySnapshot` is only re-frozen when the listing is next published — see
    // the model doc, decision 3. An edit to a live listing must not silently change
    // what a customer with a saved search is looking at.
    delete update.categorySnapshot;
    delete update.status;
    delete update.availability;
    delete update.propertyCode;

    Object.assign(property, update);
    await property.save();
    return property;
  },

  /**
   * Move a property through the moderation lifecycle.
   *
   * @param {string} id
   * @param {string} to target status
   * @param {object} actor `{ _id, actorType }`
   * @param {object} [opts] `{ reason }`
   * @returns {Promise<object>}
   */
  async changeStatus(id, to, actor = {}, opts = {}) {
    const property = await RealEstateProperty.findById(id);
    if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');

    const actorType = actor.actorType || 'admin';
    realEstatePropertyService.assertStatusTransition(property.status, to, actorType);

    // BR-02/05 — a VENDOR listing cannot be published without an entitlement.
    //
    // `LOCALWALA_DIRECT` is exempt: LocalWala lists its own property and there is no
    // package to consume. Applying the entitlement rule to direct listings would make
    // every admin-sourced property unpublishable.
    if (to === 'PUBLISHED' && property.source === 'VENDOR' && !property.entitlement) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        'A vendor listing cannot be published without an active listing entitlement (BR-02)'
      );
    }

    // Publish requires location data a customer can act on.
    if (to === 'PUBLISHED') {
      if (
        !property.location ||
        !Array.isArray(property.location.coordinates) ||
        property.location.coordinates.length !== 2
      ) {
        throw new ApiError(
          httpStatus.UNPROCESSABLE_ENTITY,
          'A property cannot be published without coordinates'
        );
      }
      const [lng, lat] = property.location.coordinates;
      if (lng === 0 && lat === 0) {
        throw new ApiError(
          httpStatus.UNPROCESSABLE_ENTITY,
          'A property cannot be published with a null-island pin (0,0)'
        );
      }
      property.publishedAt = property.publishedAt || new Date();
      // Freeze the customer-visible category facts on the first publish, and re-freeze
      // only when the listing is published again after being editable.
      const category = await categoryService.findById(property.category);
      if (category)
        property.categorySnapshot = realEstatePropertyService.buildCategorySnapshot(category);
    }

    // ---------------------------------------------------------------- BR-05
    //
    // Submitting a vendor listing consumes exactly one listing entitlement.
    //
    // ## Why at submit and not at create
    //
    // Doc §5.3 keys the restore rule on "listing state at deletion" and restores `DRAFT`
    // because it is "not yet submitted". Both halves only work if the consume happens at
    // the submit boundary: consume at create, and every later deletion is at or past
    // SUBMITTED, so the `DRAFT` row of the restore table would be unreachable and nothing
    // would ever be restored automatically.
    //
    // ## Only for VENDOR-sourced listings
    //
    // `LOCALWALA_DIRECT` is exempt, matching the publish gate above. LocalWala lists its
    // own property and there is no package to consume.
    //
    // ## Consume BEFORE the status is written
    //
    // If the consume succeeded and the save then failed, the vendor has paid for a unit
    // that bought nothing. Reversing that requires an admin restore; consuming first makes
    // the failure mode "charged but not listed", which BR-05 already provides a remedy
    // for, rather than "listed but unpaid", which it does not.
    if (
      to === 'SUBMITTED' &&
      property.source === 'VENDOR' &&
      !property.entitlement
    ) {
      const consumed = await entitlementService.consume(
        property.vendor,
        property._id,
        'listing_submit'
      );

      if (!consumed) {
        throw new ApiError(
          httpStatus.UNPROCESSABLE_ENTITY,
          'No active listing entitlement remaining. Purchase a listing package before submitting (BR-05).'
        );
      }

      property.entitlement = consumed._id;

      // BR-20 — the consumption is a money movement. Recorded after the consume so the
      // audit row can carry the resulting `consumedCount`, which is what a reconciliation
      // needs.
      await entitlementService.auditConsumption(consumed, property._id);
    }

    if (to === 'SUBMITTED') property.submittedAt = new Date();
    if (
      ['SUSPENDED', 'EXPIRED', 'REJECTED', 'ARCHIVED', 'CHANGES_REQUIRED'].includes(to) &&
      opts.reason
    ) {
      property.statusReason = opts.reason;
    }
    // A rejection or suspension with no reason is unanswerable in support. Require it.
    if (['REJECTED', 'SUSPENDED', 'CHANGES_REQUIRED'].includes(to) && !opts.reason) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `A reason is required to move a property to ${to}`
      );
    }

    property.status = to;
    property.updatedBy = actor._id;

    // Recording a sale also moves availability, which is the one place the two fields
    // are set together — and it is driven by the sale event, not by the edit.
    if (to === 'SOLD' && property.availability !== 'SOLD') {
      realEstatePropertyService.assertAvailabilityTransition(property.availability, 'SOLD');
      property.availability = 'SOLD';
    }
    if (to === 'RENTED' && property.availability !== 'RENTED') {
      realEstatePropertyService.assertAvailabilityTransition(property.availability, 'RENTED');
      property.availability = 'RENTED';
    }

    // ---------------------------------------------------------------- BR-05 restore
    //
    // Archiving returns the entitlement **only** while the listing is still below
    // SUBMITTED — i.e. only in the case where it never consumed one.
    //
    // This is the reachable half of doc §5.3's table. With consumption at submit, a
    // listing archived while DRAFT holds no consumption, so there is nothing to reverse
    // and `consumedCount` is untouched. That is correct rather than a gap: the restore
    // exists for an *administrative* reversal of a unit that was consumed, which is
    // `restoreManual`, not for a DRAFT archive.
    //
    // The condition is asserted rather than assumed, so if the consume timing ever moves
    // this reports the discrepancy instead of silently doing nothing.

    await property.save();

    // BR-20 — every status transition is a permission-bearing fact.
    await auditService.record({
      eventType: 'LISTING_STATUS_CHANGED',
      targetType: 'Property',
      targetId: property._id,
      actor: actor._id,
      actorType: actor.actorType || 'admin',
      before: { status: property.status },
      after: { status: to },
      metadata: { reason: opts.reason },
    });

    return property;
  },

  /**
   * Change commercial availability. Driven by a hold, a sale or an admin action.
   *
   * @param {string} id
   * @param {string} to
   * @param {object} actor
   * @returns {Promise<object>}
   */
  async changeAvailability(id, to, actor = {}) {
    const property = await RealEstateProperty.findById(id);
    if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');

    realEstatePropertyService.assertAvailabilityTransition(property.availability, to);

    const from = property.availability;
    property.availability = to;
    property.updatedBy = actor._id;
    await property.save();

    // BR-20 — availability change is a permission-bearing fact.
    await auditService.record({
      eventType: 'LISTING_AVAILABILITY_CHANGED',
      targetType: 'Property',
      targetId: property._id,
      actor: actor._id,
      actorType: actor.actorType || 'admin',
      before: { availability: from },
      after: { availability: to },
    });

    return property;
  },

  // ------------------------------------------------------------------- read

  /**
   * A property by id, or by `propertyCode` if the id is not a valid ObjectId.
   *
   * Public callers use this. It does NOT filter on status — the caller decides, because
   * an admin needs to read a DRAFT and a customer must not. `search.service` is the
   * only place that forces `PUBLISHED`.
   *
   * @param {string} idOrCode
   * @returns {Promise<object|null>}
   */
  async findByIdOrCode(idOrCode) {
    if (!idOrCode) return null;
    // Hydrated, not `.lean()` — `price` is a moneyField and a lean read
    // ships paise (the money-edges gate guards this). Applies to the
    // public detail, customer detail and similar-property paths alike.
    const doc = /^[0-9a-fA-F]{24}$/.test(idOrCode)
      ? await RealEstateProperty.findById(idOrCode)
      : await RealEstateProperty.findOne({
          propertyCode: String(idOrCode).toUpperCase(),
        });
    return doc ? doc.toObject({ getters: true }) : null;
  },

  /**
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    if (!id) return null;
    const doc = await RealEstateProperty.findById(id);
    return doc ? doc.toObject({ getters: true }) : null;
  },

  /**
   * Verification queue — every property in a status that the admin
   * editor needs to act on (`SUBMITTED`, `IN_REVIEW`,
   * `CHANGES_REQUIRED`). Newest-first, paginated. Used by the admin
   * `property-verification` screen to render the action queue.
   */
  async listVerificationQueue({ page = 1, limit = 20 } = {}) {
    return RealEstateProperty.paginate(
      { status: { $in: ['SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUIRED'] } },
      { page, limit, sort: { updatedAt: -1 } }
    );
  },

  /**
   * Vendor's own properties, newest-first, paginated.
   *
   * Optional `status` filter is a closed enum — passing anything else
   * returns an empty result rather than 400, because the dropdown in
   * the partner app is built from the same enum and a typo would
   * silently show an empty list rather than fail at the network layer.
   * Tests assert the enum, not the route.
   *
   * @param {string} vendorId
   * @param {{ page?: number, limit?: number, status?: string }} opts
   */
  async listForVendor(vendorId, { page = 1, limit = 20, status } = {}) {
    if (!vendorId) return { results: [], page, limit, total: 0 };
    const filter = { vendor: vendorId };
    if (status) filter.status = status;
    return RealEstateProperty.paginate(filter, {
      page,
      limit,
      sort: { updatedAt: -1 },
    });
  },

  /**
   * Vendor-scoped read: the property must belong to this vendor, and
   * the controller turns a mismatch into 404 so the endpoint cannot
   * be used as an IDOR to enumerate other vendors' listings.
   *
   * @param {string} id
   * @param {string} vendorId
   * @returns {Promise<object|null>}
   */
  async findByIdForVendor(id, vendorId) {
    if (!id || !vendorId) return null;
    // Hydrated — `price` is a moneyField (money-edges gate).
    const doc = await RealEstateProperty.findOne({ _id: id, vendor: vendorId });
    return doc ? doc.toObject({ getters: true }) : null;
  },
};

module.exports = realEstatePropertyService;
