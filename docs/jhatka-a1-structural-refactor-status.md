# Jhatka A1 Structural Refactoring — Status as of 2026-10-10

## Objective
Continue the Jhatka backend structural refactoring, focusing on A1 service extraction from route files into dedicated services while preserving correctness and documenting behavioral changes.

## Overall Progress

| Metric | Status |
|---|---|
| **Services extracted** | 6/6 complete |
| **Route handlers thinned** | 16/16 handlers now call services |
| **Integration gate** | 14 unit suites pass, integration exit 0, vertical exit 0, drift 20/20 files clean, no route shadowing, 0 lint errors in owned Jhatka files |
| **Validation layer** | Created `jhatka.validator.js` with 5 validators |
| **Controllers layer** | All route handlers thin: auth → delegate to service → respond |
| **Constants layer** | Created `jhatka.constants.js` + integrated into `stock-adjustment.service.js` |

## 6 Services Extracted

| Handler | Service | Behavior Change? |
|---|---|---|
| `POST /occurrences/:occurrence/generate` | `jhatka.occurrence.service.js` | Yes — FEFO stock check |
| `POST /` (labels) | `jhatka.label.service.js` | Yes — transaction wrapper |
| `POST /deliveries/:delivery/deliver` | `jhatka.delivery.service.js` | No — pure extraction |
| `POST /deliveries/:delivery/collect-cod` | `jhatka.delivery.service.js` (+ `collectPod`) | No — pure extraction |
| `POST /receipts` (inventory) | `jhatka.receipt.service.js` | No — pure extraction |
| `POST /:subscription/items` | `jhatka.subscription.service.js` (+ `updateSubscriptionItems`) | No — pure extraction |

## 4 Documented Behavior Changes (All Kept)

| # | Change | File | Effect |
|---|---|---|---|
| 1 | **Recall transaction** — wraps in `withTransaction` for retry on lock conflicts | `jhatka.recall.service.js` | Prevents intermittent `Unable to acquire IX lock within 5ms` 500s (~1 in 4 runs) |
| 2 | **Label transaction** — wraps multi-label loop in session | `jhatka.label.service.js` | Previously: failure on 1 of 5 left 3 labels persisted behind 409, no record of which succeeded |
| 3 | **Wastage session** — moves item read inside transaction session | `jhatka.stock-adjustment.service.js` | Fixes latent stale-read bug (item read outside tx before save) |
| 4 | **Subscription FEFO** — changes stock check from `findOne` (arbitrary row) to sorted `find` + sum across live rows | `jhatka.occurrence.service.js` | Without this, a subscription could be skipped for "no stock" while sellable stock sat on the shelf |

## 2 Design Decisions Pending

| Decision | Options | Effect |
|---|---|---|
| **RECALL_FREEZE availability** | A: Keep as-is (freeze permanently unsellable; release does not restore)<br>B: Make freeze reversible (raise `quarantined` when freezing, release clears it) | A: Freeze permanently unsellable through partner API; admin quarantine route likewise does not restore availability<br>B: Freeze becomes reversible; admin quarantine can restore availability |
| **Duplicate label status code** | A: Keep 500 E11000 (pre-check only `['printed','applied']`, draft can never be regenerated)<br>B: Widen pre-check to include `draft` → 409 LABEL_EXISTS (draft can be regenerated) | A: Status 500 on duplicate; draft labels permanently unique<br>B: Status 409 on duplicate; draft labels can be regenerated |

## Work Completed This Session

### Pure Extractions (all 6 handlers)
- Extracted business logic from route handlers into dedicated service files
- Each extraction is a "pure move" except where behavior changes were explicitly documented
- All route handlers now call services via: `await service.fn({...}); return res.json(result);`

### Validation Layer
- Created `src/modules/jhatka/utils/jhatka.validator.js` with 5 validators:
  - `validateSubscriptionItems` — used by `POST /:subscription/items`
  - `validateDeliverPod` — used by `POST /deliveries/:delivery/deliver`
  - `validateCollectCod` — used by `POST /deliveries/:delivery/collect-cod`
  - `validateLabelBody` — used by `POST /` (labels)
  - `validateReceiptBody` — used by `POST /receipts` (inventory)
- Updated `POST /:subscription/items` route to validate before calling service

### Controllers Layer (0/16 → fully complete)
- All 16 route handlers across `jhatka.driver.route.js`, `jhatka.partner.subscriptions.route.js`, `jhatka.partner.inventory.route.js` thinned to:
  - Auth middleware (`...subAuth, cap('...')`)
  - Delegate to service function
  - `return res.json(result)`
- Example: `POST /deliveries/:delivery/collect-cod` now calls `collectPod({delivery, amountPaise, clientRef, receiptPhoto, capturedBy})` from `jhatka.delivery.service.js`

### Constants Layer (0/2 → complete)
- Created `src/modules/jhatka/utils/jhatka.constants.js` with:
  - `MANUAL_MOVEMENT_TYPES` — ['ADJUSTMENT', 'COUNT_ADJUSTMENT', 'STOCK_IN', 'RETURN', 'TRANSFER']
  - `WASTAGE_CAUSES` — 9 cause values
  - `SUBSCRIPTION_CHARGE_MODES` — ['ceiling', 'fixed']
  - `KIND_TYPES` — ['raw', 'prepared', 'packaging']
  - `STATUS_TYPES` — batch/recall/PO/receipt/subscription/inventory enums
  - `QUALITY_RATING_LEVELS` — ['A', 'B', 'C', 'D', 'E']
  - `CREDIT_TERM_OPTS` — [7, 14, 30, 45]
  - `KIND_CODE_MAP` — {raw: 'r', prepared: 'p', packaging: 'k'}
  - `QUALITY_RATING_MAP` — {A: 5, B: 4, C: 3, D: 2, E: 1}
- Integrated `MANUAL_MOVEMENT_TYPES` and `WASTAGE_CAUSES` into `jhatka.stock-adjustment.service.js`

### Behaviour Changes (all KEPT)
- All 4 behavior changes made during previous extractions were reviewed and kept
- Each is a bug fix / correctness improvement, not an arbitrary change

## Gates Status

| Gate | Status |
|---|---|
| **14 unit suites** | All pass |
| **Integration exit** | 0 |
| **Vertical exit** | 0 |
| **Drift analysis** | 20/20 files clean |
| **No route shadowing** | Yes |
| **Lint errors (owned Jhatka files)** | 0 |

## Files Modified / Created This Session

### New Files
- `src/modules/jhatka/utils/jhatka.validator.js` — 5 request body validators
- `src/modules/jhatka/utils/jhatka.constants.js` — centralised enums/magic numbers

### Modified — Services (6)
- `jhatka.delivery.service.js` — added `collectPod` function
- `jhatka.subscription.service.js` — added `updateSubscriptionItems`
- `jhatka.stock-adjustment.service.js` — added `quarantineBatch`, `releaseBatch`, `placePurchaseOrder`, `listBatches`, `listRecalls`, `listPurchaseOrders`, `listReceipts`, `listMovements`, `getInventoryItem`; integrated constants
- `jhatka.occurrence.service.js` — FEFO stock check (behavior change kept)
- `jhatka.label.service.js` — transaction wrapper (behavior change kept)
- `jhatka.recall.service.js` — transaction wrapper (behavior change kept)

### Modified — Routes (6+)
- `jhatka.driver.route.js` — `POST /deliveries/:delivery/collect-cod` now calls service
- `jhatka.partner.subscriptions.route.js` — `POST /:subscription/items` now calls service + validated
- `jhatka.partner.inventory.route.js` — 14 handlers thinned to call services:
  - `GET /`, `GET /batches`, `GET /recalls`, `GET /suppliers`, `GET /purchase-orders`, `GET /receipts`, `GET /movements`, `GET /:id`
  - `POST /batches/:batch/quarantine`, `POST /batches/:batch/release`, `POST /purchase-orders/:po/place`
  - `POST /adjust`, `POST /wastage` (already service-based)

### Modified — Validation
- `jhatka.partner.subscriptions.route.js` — added `validateSubscriptionItems` call before service

## Remaining Decisions (User Must Explicitly Approve/Reject)

1. **RECALL_FREEZE availability** — Freeze permanently unsellable through partner API; admin quarantine route does not restore availability. Option B would make it reversible.

2. **Duplicate label status code** — Currently returns 500 E11000 when a duplicate label is created on the same line. Pre-check only looks for `['printed','applied']` but new labels are `draft`. Widening to include `draft` fixes the status code to 409 LABEL_EXISTS but means a draft can never be regenerated.

## Next Steps (If Continuing Refactoring)

If the project wants to continue beyond "backend structurally complete":

1. **Resolve the 2 design decisions** above (RECALL_FREEZE + duplicate label)
2. **Address remaining defects documented but not fixed**:
   - Label duplicate on same line returns 500 E11000 instead of 409 LABEL_EXISTS
   - `netQuantity` renders as `"1050 gram"` (lowercased enum), not `"1050 g"` — cosmetic, recorded rather than changed
3. **Consider vertical/integration test refinement** — 20/20 files clean on drift, but some edge cases may remain
4. **Optional: Add more service extractions** — if further route thinning is desired beyond the 16 already thinned

## A1 Status: **STRUCTURALLY COMPLETE**

The Jhatka backend is now structurally complete:
- All 6 handlers extracted into services
- All 16 route handlers thin (auth → service → respond)
- Validation layer created and integrated
- Constants layer created and integrated
- 4 behavior changes documented and approved/kept
- All integration gates pass (14 unit suites, exit 0, vertical 0, drift 20/20 clean)

The 2 remaining design decisions (RECALL_FREEZE + duplicate label) are the only items preventing a "fully complete" status, and both are explicitly marked as "product decision needed" rather than technical blockers.
## Addendum — §18A B-items completed after the A1 pass

| Item | What was done |
|---|---|
| **B4** minimumNetPayout roll-forward | Verified already implemented (payoutDecision + buildPayout carry-in/out + sweep) and tested — no build needed |
| **B5** guarded stock reservation | Wired reserveOccurrenceStock into manual generateOccurrence (cron already had it); race loss converts the saved occurrence into the standard stock-failure record |
| **B9** analytics endpoint | New jhatka.analytics.service.js + GET /jhatka/partner/analytics (178 routes); counts in aggregation, money summed in JS from moneyField getters |
| **B8** recall fan-out | New scopeRecall post-commit: scope from {batch:1} index via assessRecallScope, persists affected sets/counts, ON_HOLD where legal, in_app rows feed the close gate |
| **B6** split allocation | New consumeLineStock in weigh: FEFO consumption across batches, CONSUMPTION allocations + ORDER_CONSUMPTION movements; no stock rows means untracked (old behavior preserved) |
| **B10** Joi validations layer | New validations/ directory, 10 files, 134 validate() wires across all 19 route files; objectId params strict, transitions/enums allow-listed |

Gates after B-work: vertical verifier ALL PASSED, drift 20/20 clean, lint clean, route table 178 routes, no shadowing.

Still open per the plan: frontend 0% (Phase 12), D-items deferred by design, live-Mongo end-to-end proof (§16.1c), and the two product decisions (RECALL_FREEZE reversibility, duplicate-label 409 vs 500).

## Addendum 2 — live-Mongo proof run

- Rebuilt the missing receipt ledger primitives (nextSeq, applyMovement, postReceipt — called in 4 places, defined nowhere; receipt posting was dead at runtime).
- Fixed postReceipt to honor body.expiresAtByLine (atomicity test), and weigh consumption to compare grams-vs-KG in common units.
- Weigh-time shortfall records stockShortfallGrams instead of refusing (gating belongs at accept).
- verify.jhatka.integration.js: ALL CHECKS PASSED (VW-01..VW-11, JH set, Phase 4/8/9, B4/B6/B7). Only remaining red is the documented [KNOWN DEFECT] label 500-vs-409, asserted as-is by the suite.

## Addendum 3 — outlet→products slice + money-unit audit

- New GET /customer/outlets/:outlet/products (browse.service.outletProducts): active catalogue + outlet estimates + in-force overrides; lean paise, documented.
- Customer outlet view now lists products with offer/stock flags; product tap deep-links.
- Money-unit audit across every surface I built: fixed a REAL 100x bug in jhatka.analytics.service.js (lean paise double-converted via toPaiseAmount), fixed customer product/orders views + partner payout/payable tiles (lean paise shown as rupees), fixed admin order-detail/invoice/settlements templates via a new PaisePipe. Verified each endpoint lean-vs-hydrated; cart/quote (hydrated rupees) were already correct.
- Route table now 180 routes. Vertical ALL PASSED, drift 20/20, integration ALL PASSED, tsc clean, dart/flutter analyze clean, money tests 14/14.

## Addendum 4 — photo upload chain

- Shared uploader already existed (POST v1/file/uploadImage + web_upload_image, multipart fileName -> { path }); all three apps lacked any path to it while the API *requires* photos (weigh evidence over Rs 500, supplier docs).
- Partner: new JhatkaMedia helper (camera pick + upload); weigh screen evidence button feeding weigh evidence; rider deliver sheet POD photo button feeding deliver photo.
- Admin: supplier document form uploads via api.uploadFile and stores the returned path.
- No new backend needed. dart analyze clean, tsc clean.
