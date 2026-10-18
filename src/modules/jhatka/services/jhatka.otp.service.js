/**
 * jhatka.otp.service.js — the delivery OTP a rider must be given at the door.
 *
 * ## Threat model, stated because a 6-digit code is a weak secret
 *
 * A hashed OTP is still only a million candidates. So the code is the LAST of four
 * controls, not the only one:
 *
 *   1. `maxAttempts` (5) — the counter is the real brake. A hash is fast to brute
 *      force offline, so the attacker must guess through the API where each try costs
 *      an attempt and an audit entry.
 *   2. `expiresAt` — a code is good for 2 hours. A parcel is not handed over at 3am.
 *   3. Single-use — `verifiedAt` is set on success and a used code cannot verify twice,
 *      so a screenshot of a verified code cannot release a second parcel.
 *   4. SHA-256 of a random 6-digit value — enough to keep the plaintext out of the
 *      database, which is where the real risk is (backups, logs, support queries).
 *
 * ## `crypto.randomInt`, not `Math.random`
 *
 * `Math.random()` is a seeded PRNG. It is fine for an order number and wrong for a
 * secret: the internal state is recoverable from a handful of outputs, so a sequence
 * of codes could be predicted. `crypto.randomInt` draws from the OS CSPRNG and is
 * uniform, which `Math.random() * 1e6` is not — it biases toward zero by ~0.05%.
 *
 * ## Comparison is timing-safe
 *
 * `timingSafeEqual` on equal-length digests. A naive `===` leaks the answer one
 * character at a time through response timing.
 */

const crypto = require('crypto');
const { Buffer } = require('buffer');

const OTP_TTL_MINUTES = 120;
const OTP_LENGTH = 6;

/** Generate a fresh code and its hash. The PLAINTEXT is returned exactly once. */
function generateOtp(ttlMinutes = OTP_TTL_MINUTES) {
  const code = String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
  return {
    code,
    codeHash: hash(code),
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + ttlMinutes * 60000),
  };
}

/** SHA-256 hex digest. Not a password hash, and does not need to be. */
function hash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/**
 * Check a submitted code against an order's stored hash.
 *
 * Returns a structured result rather than a boolean so the caller can tell the rider
 * "expired" from "wrong" — an expired code is not the rider's fault, and a wrong one
 * is. Indistinguishable errors turn a legitimate handoff into an argument at the door.
 *
 * @returns {{ok: true} | {ok: false, code: string, remainingAttempts?: number}}
 */
function verifyOtp(order, submitted) {
  const otp = order.deliveryOtp;
  if (!otp || !otp.codeHash) {
    return { ok: false, code: 'NO_OTP' };
  }

  if (otp.verifiedAt) {
    return { ok: false, code: 'ALREADY_USED' };
  }

  if (new Date(otp.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: 'EXPIRED' };
  }

  if (otp.attempts >= otp.maxAttempts) {
    return { ok: false, code: 'TOO_MANY_ATTEMPTS' };
  }

  const submittedHash = hash(submitted);
  // `Buffer` is a Node global; this file's eslint env does not declare node globals,
  // so it is required explicitly rather than silenced with an inline disable.
  const a = Buffer.from(submittedHash, 'utf8');
  const b = Buffer.from(otp.codeHash, 'utf8');

  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!matches) {
    otp.attempts += 1;
    return {
      ok: false,
      code: 'INVALID',
      remainingAttempts: Math.max(0, otp.maxAttempts - otp.attempts),
    };
  }

  otp.verifiedAt = new Date();
  otp.verifiedBy = null; // set by the caller — it knows who handed over
  return { ok: true };
}

/** Public view of an order's OTP. NEVER includes the code. */
function publicOtpView(order) {
  const otp = order.deliveryOtp;
  if (!otp || !otp.codeHash) return { enabled: false };

  return {
    enabled: true,
    issuedAt: otp.issuedAt,
    expiresAt: otp.expiresAt,
    verifiedAt: otp.verifiedAt || null,
    attemptsUsed: otp.attempts || 0,
    maxAttempts: otp.maxAttempts,
    lockedOut: (otp.attempts || 0) >= otp.maxAttempts,
  };
}

module.exports = { generateOtp, verifyOtp, publicOtpView, hash, OTP_TTL_MINUTES };