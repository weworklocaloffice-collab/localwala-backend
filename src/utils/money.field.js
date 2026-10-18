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

const { toPaise } = require('./money');

/**
 * The platform money convention: **rupees at the edges, paise inside.**
 *
 * Every monetary field in the platform is defined with `moneyField(...)` rather than
 * an inline getter/setter pair.
 *
 * WHY A HELPER RATHER THAN THE INLINE PATTERN
 *
 * The inline form is:
 *
 *     price: { type: Number, get: v => Number((v/100).toFixed(2)),
 *                              set: v => Math.round(v*100), default: 0 }
 *
 * The getter divides by 100 and the setter multiplies by 100. They MUST match. This
 * vertical has well over a hundred money fields across 55 models, and a single field
 * where the pair drifts by a factor is a silent 100x money bug — the exact defect
 * recorded in the Dairy plan 9.4, where an aggregation summed raw paise and the
 * setter multiplied by 100 again on every recompute.
 *
 * Defining the pair once makes that class of bug structurally impossible. This
 * deliberately deviates from the inline style used in the food and dairy models.
 *
 * ## Why this lives in `src/utils/` and not in a module
 *
 * It was originally `modules/stores/utils/money.field.js`, because stores was the
 * first vertical written with the helper. That is a location that guarantees drift:
 * the next vertical either copies the file (two copies, one of which will eventually
 * be edited to fix something and not the other) or reaches across into another
 * module's `utils/` (a dependency the module boundary is supposed to forbid).
 *
 * Both failure modes are silent 100x money bugs. So the helper is promoted here,
 * `src/utils/`, beside `money.js` which it wraps, and `modules/stores/utils/money.field.js`
 * remains as a one-line re-export so no store model changed. See the Real Estate
 * plan §4.2 and §9.2.
 *
 * USAGE
 *
 *     deliveryFee: moneyField(0),
 *     price:      moneyField(),
 *     grandTotal: moneyField(0),
 *
 * `$inc` IS STILL FORBIDDEN on these fields — Mongoose applies the setter. Use
 * `debitMoneyField` / `creditMoneyField` from src/utils/money.js, which write raw
 * paise. Stock counters are plain integers and must NOT use this helper.
 *
 * @param {number} [defaultRupees=0] default value in RUPEES
 * @returns {object} a Mongoose field definition storing paise
 */
const moneyField = (defaultRupees = 0) => ({
  type: Number,
  get: (v) => (v === undefined || v === null ? v : Number((v / 100).toFixed(2))),
  set: (v) => (v === undefined || v === null ? v : toPaise(v)),
  default: defaultRupees,
});

module.exports = moneyField;
