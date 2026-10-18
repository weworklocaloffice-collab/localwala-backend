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
 * The receipt quality gate. §5.3 Rule B. Pure.
 *
 * ## What "pure" buys
 *
 * `evaluateQuality` takes a policy and a set of readings and returns a verdict. No
 * database, no models, no clock beyond an injected `now`. That means:
 *
 *   - every threshold in this vertical is unit-testable in a second
 *   - a policy change cannot be validated against a real receipt
 *   - the rule that decides whether a supplier's stock enters the building is one
 *     readable function rather than logic spread across a controller
 *
 * The dairy equivalent is `dairy.procurement.service.evaluateQuality`, and the
 * two return the same shape on purpose: `{passed, failures, warnings}`. A failure
 * is something that is wrong; a warning is something a human should look at.
 *
 * ## The whole design is in that distinction
 *
 * §5.3 Rule B: a hard fail auto-rejects, a borderline reading goes to a person.
 * If every failure auto-rejected, the rejection queue would be empty and nobody
 * would ever look at a borderline crate. If nothing auto-rejected, a delivery at
 * 14 °C would sit on the counter waiting for a decision that was never in doubt.
 *
 * `autoReject` therefore comes from the rejection REASON, not from this function.
 * This function reports; the reason decides.
 */

/** Failure codes. Seeded onto `JhatkaQualityRejectionReason.code`. */
const FAILURE_CODES = [
  'temp_high',
  'temp_frozen',
  'odour_off',
  'discolouration',
  'packaging_torn',
  'weight_short',
  'transit_excess',
  'docs_missing',
];

/**
 * Below this a smell score is fine. 1 is fresh, 5 is off.
 */
const SMELL_FAIL_THRESHOLD = 4;
const COLOUR_FAIL_THRESHOLD = 4;

/**
 * Evaluate one receipt line.
 *
 * @param {object} args
 * @param {object} args.policy        `JhatkaOutlet.qualityPolicy`
 * @param {object} args.readings      `line.readings`
 * @param {object} args.receivedQty   `line.receivedQty`
 * @param {object} args.expectedQty   purchase-order ordered quantity, if any
 * @param {Date}   [args.now]
 * @returns {{
 *   passed: boolean,
 *   failures: Array<{code: string, observed: *, limit: *, message: string}>,
 *   warnings: Array<{code: string, observed: *, limit: *, message: string}>
 * }}
 */
/**
 * `now` is accepted for call-site symmetry with every other gate function, but
 * nothing here reads the clock: expiry comparisons happen in
 * `JhatkaSupplierDocument.deriveStatus`, and every threshold in this function is
 * relative to a reading rather than to a date. It stays in the signature — as `_now`
 * so the intent is visible to the linter and to the next reader — because a future
 * rule that does need a clock should not have to change every call site.
 */
function evaluateQuality({ policy = {}, readings = {}, receivedQty, expectedQty, _now }) {
  const failures = [];
  const warnings = [];

  // ---- temperature ---------------------------------------------------------
  // The check that matters most, and the one most often skipped. A warm delivery
  // is not fresh meat however it looks, and "the crate did not feel cold" is the
  // inspection that actually happens on a loading dock at 5am.
  const maxIntake = policy.maxIntakeTemperatureC ?? 8;
  const t = readings.temperatureC;
  if (typeof t === 'number') {
    if (t > maxIntake) {
      failures.push({
        code: 'temp_high',
        observed: t,
        limit: maxIntake,
        message: `arrived at ${t}°C, above the ${maxIntake}°C intake limit`,
      });
    } else if (t > maxIntake - 2) {
      // Within 2 degrees of the limit. Not a failure, but a trend worth seeing: a
      // supplier running at 5.9°C every morning is a supplier who will be at 9°C
      // next month, and "it passed today" is how that goes unnoticed.
      warnings.push({
        code: 'temp_high',
        observed: t,
        limit: maxIntake,
        message: `${t}°C is within 2°C of the ${maxIntake}°C limit — watch this supplier`,
      });
    }
    // Frozen meat arriving on a chilled vehicle is a different failure from warm
    // meat, and the corrective action is different too (re-thermalise vs reject).
    if (t <= -18) {
      failures.push({
        code: 'temp_frozen',
        observed: t,
        limit: -18,
        message: `arrived at ${t}°C — frozen, not chilled`,
      });
    }
  } else {
    // A MISSING temperature is a warning, not a failure. Refusing every delivery
    // without a probe reading would push operators back to eyeballing, which is
    // worse than recording that they did.
    warnings.push({
      code: 'temp_high',
      observed: null,
      limit: maxIntake,
      message: 'no intake temperature recorded',
    });
  }

  // ---- long transit --------------------------------------------------------
  // Two days in transit is spoilage regardless of the temperature at the door.
  //
  // Deliberately its OWN code rather than reusing `temp_high`. `temp_high` is a
  // hard, auto-rejecting, cold-chain reason owned by the transporter's cold chain;
  // a long transit is a sourcing decision by the buyer. Reusing the code would let
  // a slow supplier's stock be auto-rejected under a reason booked against the
  // wrong party, and `JhatkaQualityRejectionReason.fault` would report the cause
  // wrongly.
  if (typeof readings.transitHours === 'number' && readings.transitHours > 48) {
    failures.push({
      code: 'transit_excess',
      observed: readings.transitHours,
      limit: 48,
      message: `${readings.transitHours}h in transit — past 48h`,
    });
  }

  // ---- sensory -------------------------------------------------------------
  // Scales are inverted deliberately: 1 is best. A higher number is worse, which
  // is the opposite of a temperature reading and the sort of thing that gets a
  // comparison backwards in a hurry.
  if (typeof readings.smellScore === 'number' && readings.smellScore >= SMELL_FAIL_THRESHOLD) {
    failures.push({
      code: 'odour_off',
      observed: readings.smellScore,
      limit: SMELL_FAIL_THRESHOLD,
      message: `off odour (score ${readings.smellScore} of 5)`,
    });
  }

  if (typeof readings.colourScore === 'number' && readings.colourScore >= COLOUR_FAIL_THRESHOLD) {
    failures.push({
      code: 'discolouration',
      observed: readings.colourScore,
      limit: COLOUR_FAIL_THRESHOLD,
      message: `discoloured (score ${readings.colourScore} of 5)`,
    });
  }

  // ---- packaging -----------------------------------------------------------
  if (readings.packagingIntact === false) {
    failures.push({
      code: 'packaging_torn',
      observed: false,
      limit: true,
      message: 'packaging torn or leaking',
    });
  }

  // ---- weight --------------------------------------------------------------
  // Only meaningful against a purchase order. A walk-in delivery has no expected
  // quantity, and inventing one would fail every receipt.
  if (expectedQty && receivedQty && isFinite(expectedQty.value) && expectedQty.value > 0) {
    const factor = expectedQty.unit === 'KG' ? 1000 : 1;
    const expectedGrams = Math.round(expectedQty.value * factor);
    const recvFactor = receivedQty.unit === 'KG' ? 1000 : 1;
    const receivedGrams = Math.round(receivedQty.value * recvFactor);

    // 5% short is the conventional tolerance. Below it is a rounding difference
    // between the supplier's scale and ours, not a short-delivery.
    const shortfallPct = ((expectedGrams - receivedGrams) / expectedGrams) * 100;
    if (shortfallPct > 5) {
      failures.push({
        code: 'weight_short',
        observed: Math.round(shortfallPct * 100) / 100,
        limit: 5,
        message: `${shortfallPct.toFixed(1)}% short against the purchase order`,
      });
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
  };
}

/**
 * What the gate's verdict means for the line, given the reasons it matched.
 *
 * The gate reports; this decides. `autoReject` lives on
 * `JhatkaQualityRejectionReason`, and this is where it is applied — which is why
 * that field is admin-controlled data rather than a threshold in this file. A
 * reason mis-set to `autoReject: true` silently throws away good stock, and that
 * should require a deliberate configuration change.
 *
 * @param {{passed: boolean, failures: Array}} verdict
 * @param {Array<{autoReject: boolean}>} matchedReasons
 * @param {boolean} policyAutoRejectOnTemperature outlet's blanket rule
 * @returns {{ qualityStatus: string, requiresHumanDecision: boolean, autoRejected: boolean }}
 */
function decideLineQuality(verdict, matchedReasons = [], policyAutoRejectOnTemperature = true) {
  if (verdict.passed) {
    return { qualityStatus: 'accepted', requiresHumanDecision: false, autoRejected: false };
  }

  // A hard fail whose REASON says auto-reject, or a COLD-CHAIN failure under an
  // outlet that has the blanket rule on, goes straight to rejected.
  //
  // Only `temp_high` and `temp_frozen` are covered by the blanket rule. A torn
  // crate, an off odour, a short weight or an excess transit are judgement calls
  // that belong to the `autoReject` flag on their reason, not to the outlet's
  // temperature rule — an outlet that opted into auto-rejecting warm deliveries did
  // not opt into silently binning every short delivery from its cheapest supplier.
  const anyAuto = matchedReasons.some((r) => r && r.autoReject === true);
  const coldChainFailure = verdict.failures.some(
    (f) => f.code === 'temp_high' || f.code === 'temp_frozen'
  );

  if (anyAuto || (coldChainFailure && policyAutoRejectOnTemperature)) {
    return { qualityStatus: 'rejected', requiresHumanDecision: false, autoRejected: true };
  }

  // Everything else waits for a person. This is the whole point of the split: the
  // queue should contain only genuinely borderline cases.
  return { qualityStatus: 'pending', requiresHumanDecision: true, autoRejected: false };
}

module.exports = {
  FAILURE_CODES,
  SMELL_FAIL_THRESHOLD,
  COLOUR_FAIL_THRESHOLD,
  evaluateQuality,
  decideLineQuality,
};