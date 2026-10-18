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
 * Copies the named keys off an object.
 *
 * ## Why this handles Mongoose documents
 *
 * This is called on both plain objects and live Mongoose documents, and the two
 * behave differently. A document keeps its schema fields in `_doc`, so
 * `hasOwnProperty('status')` on the document itself is **false** — the value is
 * there and readable as `doc.status`, but it is not an own property of the document.
 *
 * The original version therefore returned `{}` for every document it was handed,
 * silently. `PATCH /joining_request/review/:request/:id` shipped that way: the review
 * was recorded correctly, and the API answered with an empty body, so a caller had
 * no way to learn the outcome of the decision it had just made.
 *
 * Reading through `_doc` fixes that at the one place every caller goes through,
 * rather than leaving each controller to remember.
 *
 * @param {Object} object a plain object, or a Mongoose document
 * @param {string[]} keys the keys to keep
 * @returns {Object} a new plain object holding only those keys that exist
 */
const pick = (object, keys) => {
  if (!object) {
    return {};
  }

  // A Mongoose document keeps its schema fields in `_doc`, so
  // `hasOwnProperty('status')` on the document is false even though `doc.status`
  // reads correctly. Reading through `_doc` is what makes documents work at all.
  //
  // Everything else keeps the original own-property behaviour exactly. That matters:
  // `pick` is shared with the food module, which calls it 24 times in
  // `orders.controller.js` on `req.query` and `req.body`. Reading inherited
  // properties instead of own ones would silently widen what those calls return.
  const isDocument = Boolean(object._doc) && typeof object._doc === 'object';
  const source = isDocument ? object._doc : object;
  const has = (key) =>
    isDocument
      ? source[key] !== undefined
      : Object.prototype.hasOwnProperty.call(source, key);

  return keys.reduce((result, key) => {
    if (has(key) && source[key] !== undefined) {
      result[key] = source[key];
    }
    return result;
  }, {});
};

module.exports = pick;

