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
 * Phase 1 geographic kernel — load, geometry and regression checks.
 *
 * Run:  node scripts/verify.realestate.kernel.js
 *
 * ## Why these are three scripts and not one
 *
 * They fail for different reasons and are run at different moments:
 *
 *   verify.realestate.kernel.js                 — "does it load at all?"  CI, every commit
 *   verify.realestate.geo.math.js               — "is the maths right?"    CI, every commit
 *   verify.realestate.kernel.integration.js     — "did we break anything?" before a release
 *
 * The integration one is the expensive one (it builds the whole express router and
 * loads all 190 models), so it runs on a schedule rather than on every save.
 *
 * ## The regression checks that matter most
 *
 * Check [7] in the integration script asserts that `City`, `Locality` and `Restaurant`
 * STILL carry `default: 'Point'` on their nested GeoJSON type. That reads as odd — we
 * are asserting a bug is still present — and it is deliberate.
 *
 * The Real Estate plan §4.2.2 commits to adding `State`, `OperationalZone` and
 * `GeoBoundary` **without touching any existing model**, because `City` is referenced
 * by 21 models including the food and delivery path. If someone "helpfully" removes
 * that default while fixing F-13 in the same branch, this check fails and the release
 * stops, because removing it changes write behaviour on documents already in the
 * database. F-13 is a separate, separately-reviewed change.
 */
