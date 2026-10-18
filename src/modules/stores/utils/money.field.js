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
 * MOVED. The implementation now lives at `src/utils/money.field.js`.
 *
 * This re-export exists so the three store models that require `../utils/money.field`
 * — store.onboarding.model.js, store.outlet.model.js, store.subscription.model.js —
 * keep working untouched.
 *
 * It is deliberately NOT deleted and deliberately NOT duplicated. Two copies of a
 * money getter/setter pair is precisely the drift this promotion exists to prevent:
 * the getter/setter MUST match, and a pair that differs by a factor of 100 is a
 * silent money bug, not a crash. See the doc comment on `src/utils/money.field.js`.
 *
 * New code should require `../../../utils/money.field` directly. This file can go
 * once the three store models are repointed, which is a cosmetic follow-up, not a
 * blocker.
 */
module.exports = require('../../../utils/money.field');
