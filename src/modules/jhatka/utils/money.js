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
 * The paise ↔ moneyField bridge. §0, and the defect this file exists to prevent.
 *
 * ## The trap
 *
 * `src/utils/money.field.js` documents the platform convention as
 * **"rupees at the edges, paise inside"**, and implements it like this:
 *
 *     setter:  v  →  toPaise(v)      // takes RUPEES, stores paise   (×100)
 *     getter:  v  →  Number(v / 100) // returns RUPEES               (÷100)
 *
 * So a Mongoose document read normally gives you RUPEES, while the SAME document
 * read with `.lean()` gives you RAW PAISE, because `.lean()` bypasses getters.
 *
 * ## Why this file is needed
 *
 * Jhatka's money helpers — `linePricePaise`, `reconcileWeight`, `codCeilingPaise`,
 * `subscriptionCeilingPaise` — all work in PAISE and are unit-tested in PAISE. That
 * is correct and should stay.
 *
 * The bug is at the BOUNDARY: assigning a computed paise total straight onto a
 * `moneyField` path multiplies it by 100 a second time. A ₹400 order stored as
 * 4,200,000 paise. Nothing throws, no validation error appears, and every pure
 * function test still passes — because the arithmetic was correct and only the
 * WRITE was wrong.
 *
 * **This was found by `verify.jhatka.integration.js`**, the first suite in this
 * vertical to execute a handler against a real database. Ten unit suites reported
 * green throughout. It is the exact defect `money.field.js` warns about: "a single
 * field where the pair drifts by a factor is a silent 100x money bug".
 *
 * ## The rule
 *
 *     compute in PAISE  →  asMoney(paise)  →  assign to a moneyField path
 *
 * And when READING a value that will be used in paise arithmetic, read it with
 * `.lean()` (raw paise) or convert explicitly. Do not mix a getter result (rupees)
 * into paise arithmetic.
 */

const { fromPaise } = require('../../../utils/money');

/**
 * Convert a PAISE amount into the RUPEES value a `moneyField` setter expects.
 *
 * Use at EVERY assignment of computed money onto a moneyField path.
 *
 * @param {number} paise
 * @returns {number} rupees
 */
const asMoney = (paise) => fromPaise(Number(paise || 0));

/**
 * Convert a RUPEES value (what a getter returns) into PAISE for arithmetic.
 *
 * @param {number} rupees
 * @returns {number} paise
 */
const toPaiseAmount = (rupees) => Math.round(Number(rupees || 0) * 100);

module.exports = { asMoney, toPaiseAmount };