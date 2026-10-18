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
 * Helpers for the rupee/paise money fields.
 *
 * ## Why this file exists
 *
 * Money fields in this codebase are declared as *rupees at the edges, paise
 * inside*: the schema setter multiplies by 100 and the getter divides by 100. That
 * keeps `order.grandTotal === 120` meaning ₹120 rather than 120 paise, which is
 * the only way arithmetic like `wallet.balance - order.grandTotal` can be correct.
 *
 * The trap is that **Mongoose applies that setter to `$inc` and `$set` values too.**
 * So this, which looks like a ₹120 debit, is a ₹12,000 debit:
 *
 *     Wallet.updateOne({ _id }, { $inc: { balance: -120 } });   // stores -12000 paise
 *
 * A read-modify-save (`wallet.balance = x; await wallet.save()`) applies the
 * setter exactly once and is correct. Anything needing a single atomic statement —
 * a conditional debit that must not overdraw a shared balance — cannot use `$inc`
 * on such a field.
 *
 * ## The rule
 *
 * - Read/modify/write in rupees and `save()`. Correct, and the default.
 * - When a guarded atomic update is genuinely required, use
 *   {@link debitMoneyField} / {@link creditMoneyField} below. They talk to the raw
 *   collection, so no setter or getter is involved and values are **paise**,
 *   in and out. Re-read through the model afterwards if you need rupees.
 *
 * Every value passed to these helpers is paise. Getting that wrong is a 100x
 * error, so the parameter names say so.
 */

const toPaise = (rupees) => Math.round(Number(rupees) * 100);

/**
 * Paise back to rupees. The exact inverse of {@link toPaise}.
 *
 * ## Why this exists
 *
 * `moneyField` converts in its setter and back in its getter, so a MONGOOSE DOCUMENT
 * always reads as rupees. A **lean** object does not: `.lean()` hands back the raw
 * stored value, which is paise.
 *
 * So any `findOne().lean()` / aggregation over a document with money fields silently
 * returns paise, and the API then reports delivery fee 15000 where the operator typed
 * 150. Nothing throws. The number is simply a hundred times too large, which is
 * precisely the defect recorded in the Dairy plan 9.4.
 *
 * Call this on any lean/aggregation result containing money fields. `null` and
 * `undefined` pass through untouched so an absent field stays absent rather than
 * becoming 0.
 *
 * @param {number} paise
 * @returns {number|undefined|null}
 */
const fromPaise = (paise) => {
  if (paise === undefined || paise === null) return paise;
  return Number((Number(paise) / 100).toFixed(2));
};

/**
 * Atomically subtracts from a money field, refusing to overdraw.
 *
 * @param {mongoose.Model} model
 * @param {ObjectId} id
 * @param {string} field money field name, e.g. `balance`
 * @param {number} amountPaise amount to subtract, in paise
 * @param {Object} [extra] additional update operators, e.g. a `$push` of history
 * @returns {Promise<{debited: boolean}>} `debited: false` means insufficient funds
 */
const debitMoneyField = async (model, id, field, amountPaise, extra = {}) => {
  const result = await model.collection.updateOne(
    { _id: id, [field]: { $gte: amountPaise } },
    { $inc: { [field]: -amountPaise }, ...extra }
  );

  return { debited: result.matchedCount === 1 };
};

/**
 * Atomically adds to a money field.
 *
 * @param {mongoose.Model} model
 * @param {ObjectId} id
 * @param {string} field money field name
 * @param {number} amountPaise amount to add, in paise
 * @param {Object} [extra] additional update operators
 */
const creditMoneyField = async (model, id, field, amountPaise, extra = {}) => {
  const result = await model.collection.updateOne(
    { _id: id },
    { $inc: { [field]: amountPaise }, ...extra }
  );

  return { credited: result.matchedCount === 1 };
};

module.exports = {
  toPaise,
  fromPaise,
  debitMoneyField,
  creditMoneyField,
};
