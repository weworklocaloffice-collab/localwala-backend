# Social + Reels — Hybrid-Monolith Architecture

> Status: design + Phase-1 scaffold. Single Node process, single MongoDB/Mongoose
> connection. No separate microservice, database, or server.

## 1. Ownership

- `reels` — owns Reel content, likes, views, comments, shares, and feed.
- `social` — owns contact matching and privacy/social-proof relationships.

Modules are separated **logically** but run inside the same Express app
(`src/app.js` → `src/routes/v1/index.js`) and use the same MongoDB
infrastructure. That is the hybrid monolith.

## 2. Final module map (actual repo paths)

```text
src/
├── app.js
├── routes/v1/
│   ├── index.js              # mounts /reels (existing) + /social (new)
│   └── reel.route.js         # existing — extended, not replaced
├── models/
│   ├── reel.model.js         # existing — kept, reused
│   ├── reelActivity.model.js # existing — kept for backward compat
│   └── index.js              # + new exports (see §12)
├── modules/
│   ├── social/               # NEW — kernel-like, no reels imports
│   │   ├── contacts/
│   │   │   ├── contacts.controller.js
│   │   │   ├── contacts.service.js
│   │   │   ├── contacts.repository.js
│   │   │   └── validators/sync-contacts.validator.js
│   │   ├── models/
│   │   │   ├── user.contact.match.model.js
│   │   │   └── social.privacy.model.js
│   │   ├── social-proof/
│   │   │   └── social-proof.service.js  # pure math; liker data injected by consumer
│   │   ├── privacy/
│   │   │   ├── privacy.service.js
│   │   │   └── privacy.controller.js
│   │   ├── routes/
│   │   │   └── social.route.js
│   │   └── index.js          # barrel — the ONLY import surface for reels
│   └── reels/                # NEW — consumes social, never the reverse
│       ├── models/
│       │   ├── reel.interaction.model.js  # LIKE/SAVE/SHARE/VIEW
│       │   ├── reel.view.model.js
│       │   ├── reel.comment.model.js
│       │   └── reel.report.model.js
│       ├── services/
│       │   ├── reel.feed.service.js       # feed + bulk socialProof attach
│       │   ├── reel.interaction.service.js
│       │   └── reel.comment.service.js
│       ├── repositories/
│       │   └── reel.liker.repository.js  # liker reads live HERE (never in social)
│       ├── admin/                         # V1 publishing — Admin_panel only (see §15)
│       │   ├── reels.admin.service.js     # upload-url, finalize, publish state machine
│       │   ├── reels.admin.controller.js
│       │   └── reels.media.service.js     # presigned S3 → FFmpeg → 720p + thumbnail → CDN
│       ├── controllers/      # thin; existing src/controllers/reel.controller.js delegates here
│       ├── routes/
│       │   └── reels.admin.route.js  # mounted at /v1/admin/reels (webAuth), kept out of
│       │                             # admin.route.js per the dairy precedent (§15)
│       ├── validators/
│       └── workers/          # counters reconciler, processing poller (stubs)
└── docs/
    └── social-reels-hybrid-monolith.md  # this file
```

Dependency direction (enforced by code review + `modules/social/index.js` barrel):

```text
Social Module ──provides──▶ Reels Module ──▶ Food / Property / Service
(social proof)      (feed)
```

**Social must never import from Reels.** Reels imports only from
`modules/social/index.js`, never deep paths.

## 3. Why Social is separate from Reels

Contact matching must NOT live in a reels service. The same
"which Localwala users does this customer know?" question is needed for
Reels, Businesses, Products, Properties, Services, Reviews,
Recommendations, Referrals. So:

- Social answers: _which registered users are in this customer's address book?_
- Reels asks: _of the users who liked Reel X, which ones does the viewer know?_

## 4. Contact matching model

No raw address-book collection. Store only the useful relationship:

```js
// user_contact_matches
{
  userId: ObjectId,        // e.g. Charan
  matchedUserId: ObjectId, // e.g. Rahul — Charan's contacts contain Rahul's number
  source: 'PHONE_CONTACT', // enum, future: WHATSAPP, REFERRAL, …
  status: 'ACTIVE',
  createdAt, updatedAt
}
```

Indexes (see §12):

- unique `(userId, matchedUserId)`
- index `userId`
- index `matchedUserId`

Do NOT create a `contacts { userId, contactName, phoneNumber }` collection.

## 5. Phone numbers: hash-only, never plaintext address books

`users` already holds `countryCode + mobile` for registered users.
`user_contact_matches` holds only `userId + matchedUserId` — no phone numbers.

Canonical normalisation (**must be identical on Flutter and Node**):

```js
normalizePhone(raw) =
  digitsOnly(raw)              // '+91 98765 43210' -> '919876543210'
  → strip leading zeros
  → strip leading '91' handling is NOT special-cased: keep full international
    digits as-is; client and server use the same function
hash = SHA256(normalizePhone(phone))  // lowercase hex, 64 chars
```

Backend receives **hashes only**.

> Current gap (documented, not hidden): `users` has no indexed `phoneHash`
> field yet, so Phase-1 matching computes server-side hashes in batches and
> intersects in memory. Phase 2 adds `users.phoneHash` (sparse, unique) +
> backfill script, turning sync into a single indexed `$in` query. The
> service interface does not change.

## 6. Contact synchronisation (Flutter → API)

```text
"Find friends from contacts" → permission → read contacts
→ normalize → SHA-256 → POST /v1/social/contacts/sync → store matched users
```

Rules:

- First permission → initial sync → store `lastSyncAt` (in `social_privacies`).
- Refresh only when `lastSyncAt > 7 days` (tunable) or on explicit user action.
- Never sync on every app open. Never upload 1,000 raw contacts per session.
- Cap: max 2,000 hashes per request, rate-limited.
- Keep this logic in `lib/features/social/`, never inside `ReelsScreen`.

## 7. API

### 7.1 `POST /v1/social/contacts/sync` (appAuth)

Request:

```json
{ "contacts": ["<sha256hex>", "<sha256hex>"] }
```

Behaviour: validate → match hashes to registered users (excluding self) →
bulk-upsert `user_contact_matches` → update `lastSyncAt` → return matched users.

Response:

```json
{
  "matchedUsers": [{ "userId": "u123", "displayName": "Rahul", "avatarUrl": "..." }],
  "matchedCount": 1,
  "lastSyncAt": "2026-10-08T00:00:00.000Z"
}
```

### 7.2 Privacy

- `GET /v1/social/privacy` → `{ findFriendsEnabled, showActivityToContacts, lastSyncAt }`
- `PATCH /v1/social/privacy` → `{ findFriendsEnabled?, showActivityToContacts? }`

Settings UI: _Settings → Privacy → Contacts_ with:

- _Find friends from contacts_ ON/OFF (controls sync + matching visibility).
- _Show my activity to people who know me_ ON/OFF (controls whether my likes
  appear as someone else's social proof).

### 7.3 Reels (existing route, extended response)

`GET /v1/reels/feed` keeps its path. Each item gains `socialProof`:

```json
{
  "items": [
    {
      "id": "r123",
      "videoUrl": "...",
      "likesCount": 245,
      "socialProof": {
        "people": [{ "userId": "u123", "name": "Rahul", "avatarUrl": "..." }],
        "total": 2
      }
    }
  ]
}
```

Never make Flutter call per-reel social-proof endpoints (N+1). The feed
attaches it in bulk (§9).

### 7.4 Admin publishing APIs (webAuth, Admin_panel only — see §15)

| Method | Path                                       | Purpose                                          |
| ------ | ------------------------------------------ | ------------------------------------------------ |
| POST   | `/v1/admin/reels/upload-url`               | Presigned S3 URL for the raw upload              |
| POST   | `/v1/admin/reels/finalize`                 | Raw upload received → enqueue FFmpeg job         |
| POST   | `/v1/admin/reels`                          | Create reel (draft with details/target)          |
| GET    | `/v1/admin/reels`                          | List with status filter (§17)                    |
| GET    | `/v1/admin/reels/:id`                      | Detail incl. processing progress                 |
| PATCH  | `/v1/admin/reels/:id`                      | Edit draft / details                             |
| POST   | `/v1/admin/reels/:id/preview`              | READY → preview token for admin player           |
| POST   | `/v1/admin/reels/:id/publish`              | Publish now or schedule (`publishAt`)            |
| POST   | `/v1/admin/reels/:id/pause`                | PUBLISHED → PAUSED (sets `isLocked`)             |
| DELETE | `/v1/admin/reels/:id`                      | Delete (drafts; published → archive)             |
| GET    | `/v1/admin/reels/:id/analytics`            | Views, completion, CTA taps (§8)                 |
| GET    | `/v1/admin/reels/reports`                  | Moderation queue, status filter                  |
| POST   | `/v1/admin/reels/reports/:reportId/review` | Verdict: REVIEWING/DISMISS/HIDE_REEL/REMOVE_REEL |

### 7.5 Customer APIs (appAuth, Customer_app)

| Method | Path                     | Purpose              |
| ------ | ------------------------ | -------------------- |
| GET    | `/v1/reels/feed`         | Feed + `socialProof` |
| GET    | `/v1/reels/:id`          | Single reel          |
| POST   | `/v1/reels/:id/view`     | View log             |
| POST   | `/v1/reels/:id/like`     | Toggle like          |
| POST   | `/v1/reels/:id/save`     | Toggle save          |
| POST   | `/v1/reels/:id/share`    | Share                |
| POST   | `/v1/reels/:id/comments` | Comment              |
| POST   | `/v1/reels/:id/report`   | Report               |

V1 rule: customers cannot upload. The customer `POST /v1/reels/upload` route
has been **removed** (the `uploadReel` controller is kept, reserved for V2
creator uploads, §18).

## 8. Reel interaction model

New collection `reel_interactions` (alongside legacy `reelactivities`):

```js
{ reelId: ObjectId, userId: ObjectId, type: 'LIKE' | 'SAVE' | 'SHARE' | 'VIEW' }
```

- unique `(reelId, userId, type)`
- index `(reelId, type)` — "all users who liked Reel X", efficiently.

Views: `reel_views { reelId, userId?, watchedMs, completed }` for analytics
without polluting the unique interaction key. Comments: `reel_comments`
(paginated, reportable). Reports: `reel_reports` for moderation.

### Publishing fields (additive on `reels` — see §15)

```js
{
  status: 'DRAFT' | 'PROCESSING' | 'READY' | 'SCHEDULED'
        | 'PUBLISHED' | 'PAUSED' | 'REJECTED' | 'EXPIRED',
  vertical: 'FOOD' | 'DAIRY' | 'SERVICES' | 'REAL_ESTATE' | …,
  target: { type: 'RESTAURANT' | 'PRODUCT' | 'SERVICE' | 'VENDOR' | 'PROPERTY',
            refId: ObjectId },
  cta: { label: 'ORDER NOW' | 'SUBSCRIBE' | 'BOOK NOW' | 'VIEW PROPERTY' | …,
         overridden: Boolean },
  cityId: ObjectId, localityId: ObjectId,
  media: { renditions: [{ quality: '720p', url }], thumbnailUrl, durationSec },
  processing: { stage: 'UPLOADING' | 'COMPRESSING' | 'PROCESSING' | 'THUMBNAIL' | 'READY',
               progress: Number },
  publishAt: Date,   // set for SCHEDULED; worker flips to PUBLISHED
  publishedAt: Date,
}
```

`PAUSED` sets the existing `isLocked = true` so the feed (`isLocked: $ne: true`)
excludes it without data loss; unpause restores `isLocked = false`.
`SCHEDULED` is flipped to `PUBLISHED` by a due-date worker (same seam as the
counters worker). Feed visibility rule stays one line: `status: PUBLISHED`
(plus schedule due) and `isLocked != true`.

## 9. Social-proof service

`getReelSocialProof(reelId, viewerId)` conceptually:

1. Viewer's matched contacts (`user_contact_matches`).
2. Users who LIKE-d the reel (`reel_interactions` / legacy `reelactivities`).
3. Intersection.
4. Privacy gate: drop anyone with `showActivityToContacts === false`; drop
   everything if viewer has `findFriendsEnabled === false`.
5. Return max 2–3 people + `total`.

```json
{ "people": [{ "userId": "u123", "name": "Rahul", "avatarUrl": "..." }], "total": 2 }
```

Feed uses `getBulkSocialProof(reelIds, viewerId, likersByReel)`: the liker map
is built by reels (`reel.liker.repository`, one `$in` query over both
interaction tables) and injected — social adds one contacts query + one user
lookup, then an in-memory join. Never one query per reel, and social never
imports reels, so future consumers (food, property) supply their own liker
sets from their own modules.

## 10. Caching

Phase 1 (now): compute directly; traffic is small and correctness matters more.
`social-proof.service` already exposes a `Map`-based TTL cache
(`userId:reelId`, 60–300s) behind the same interface.

Phase 2: swap the Map for Redis (no `redis` dependency is added in Phase 1 —
`package.json` has none today). Social proof tolerates 1–5 min staleness.

## 11. Auth, validation, roles (repo conventions)

- `appAuth()` (Bearer JWT, `middlewares/appAuth.js`) on all `/social/*` and
  `/reels/*`. `req.user` is the full Mongoose `User` doc — use
  `req.user._id` (fallback `req.user.id`), never `req.user.uid`.
- `validate(schema)` with Joi `{ params, query, body }` shapes.
- Controllers are thin `catchAsync` wrappers; logic lives in services.
- New rights appended to the `user` role in `src/config/roles.js`:
  `social_contacts_sync`, `social_privacy_manage`, `reels_feed`,
  `reels_interact`, `reels_comment`, `reels_upload`. Routes use `appAuth()`
  (authenticated-only) in Phase 1 so a missing right string can never 403 a
  real customer; named rights are enforced incrementally.

## 12. Index + export checklist

- `user_contact_matches`: unique `(userId, matchedUserId)`; idx `userId`; idx
  `matchedUserId`.
- `social_privacies`: unique `userId`.
- `reel_interactions`: unique `(reelId, userId, type)`; idx `(reelId, type)`.
- `reel_views`: idx `(reelId, createdAt)`; idx `(userId, createdAt)`.
- `users.phoneHash`: Phase 2 sparse unique (see §5).
- `src/models/index.js`: export `UserContactMatch`, `SocialPrivacy`,
  `ReelInteraction`, `ReelView`, `ReelComment`, `ReelReport`.
- `src/routes/v1/index.js`: mount `socialRoute` at `/social`.
- `reels` publishing: idx `(status, createdAt)`; idx `(vertical, status)`;
  idx `(publishAt)` for the scheduler; new `webAuth` rights
  `reels_admin_manage`, `reels_admin_publish`, `reels_admin_analytics`.

## 13. Flutter side (Customer_app)

```text
lib/app/features/social/   # implemented in Customer_app
├── services/contacts_service.dart      # permission → read → normalize → sha256 → POST
├── services/contact_phone.dart         # canonical normalize+hash (unit-tested vs backend)
├── contact_sync_controller.dart        # lastSyncAt 7-day gate + privacy toggles
└── models/
    ├── matched_contact.dart
    └── reel_social_proof.dart          # SocialProofPerson + displayText()
```

```dart
class SocialProofPerson {
  final String userId; final String name; final String? avatarUrl;
}
class ReelSocialProof {
  final List<SocialProofPerson> people; final int total;
}
// Reel gains: video, thumbnail, caption, CTA, likes, socialProof
```

Use a maintained contacts package matching the app's Flutter version; hash
with `crypto` (`sha256`). UI stays subtle:

- 1 person: `Rahul liked this`
- 2: `Rahul and Priya liked this`
- 3+: `Rahul, Priya and 3 others liked this` (avatars + `+3`)
- Total `❤️ 245` stays separate.

## 14. What is deliberately NOT built yet

Admin publishing pipeline (§§15–19: media service, admin routes, scheduler),
`analytics/` rollups, `moderation/` queues, Redis swap, `users.phoneHash`
backfill. Stubs and TODOs mark their seams; the feed + sync + proof + privacy
path is real.

## 15. Admin publishing pipeline (V1: admin creates, customer consumes)

Same monolith, same MongoDB. Admin routes live in
`modules/reels/routes/reels.admin.route.js` mounted at `/v1/admin/reels` with
`webAuth()` rights — deliberately kept out of `admin.route.js`, exactly as the
dairy vertical did when that file hit 743 routes.

```text
ADMIN PANEL → Create New Reel → select video + enter details
  → client-side compression (admin never compresses by hand)
  → POST /v1/admin/reels/upload-url → presigned S3 URL
  → upload raw → POST /v1/admin/reels/finalize → FFmpeg job
  → 720p MP4 + thumbnail → READY → ADMIN PREVIEW
  → Publish (now/scheduled) or Save Draft → CUSTOMER REELS TAB
```

Build the S3 presigned step on the existing media storage settings
(`media.storage.setting` already abstracts S3/Azure/GCS — see `package.json`).
FFmpeg runs in a worker, never on the request path; the admin detail endpoint
exposes `processing { stage, progress }` for the progress UI.

Status machine: `DRAFT → PROCESSING → READY → SCHEDULED → PUBLISHED`,
with `PAUSED` (↔ `isLocked`, §8), `REJECTED`, `EXPIRED` as side states.
Only `PUBLISHED` (and due `SCHEDULED`) reels reach the customer feed.

## 16. Create-reel screen + vertical → target → CTA matrix

Form: video (MP4, 9:16, ≤30s) → thumbnail (auto or custom) → caption →
vertical → target → CTA (suggested, overridable) → city/locality → publish
(immediately/scheduled) → Save Draft / Preview / Publish.

Target options depend on vertical:

| Vertical    | Target types        |
| ----------- | ------------------- |
| FOOD        | Restaurant, Product |
| DAIRY       | Product             |
| SERVICES    | Service, Vendor     |
| REAL ESTATE | Property            |

CTA is auto-suggested from vertical + target, admin may override:

| Vertical + target      | Suggested CTA |
| ---------------------- | ------------- |
| FOOD + PRODUCT         | ORDER NOW     |
| DAIRY + PRODUCT        | SUBSCRIBE     |
| SERVICES + SERVICE     | BOOK NOW      |
| REAL ESTATE + PROPERTY | VIEW PROPERTY |

The CTA deep-links into the existing order/booking/property flow — reels
never reimplement checkout.

## 17. Reel management page (Admin → Reels)

Tabs: All, Drafts, Processing, Published, Scheduled, Paused, Rejected,
Expired — one `GET /v1/admin/reels?status=` filter, not eight endpoints.

Row: video thumb · vertical · target · status · views · ⋮ actions.
Actions: Preview, Edit, Pause, Publish, Duplicate, Delete, Analytics,
Reports. Reports opens the moderation queue seeded by customer
`POST /v1/reels/:id/report` (§7.5): list by OPEN/REVIEWING/RESOLVED/DISMISSED,
then verdict — DISMISS clears it, HIDE_REEL pauses reversibly, REMOVE_REEL
rejects terminally (hard delete stays a separate deliberate step).

## 18. Who may upload: V1 vs V2

```text
V1:  Admin → create/upload/publish.  Customer → watch, like, save,
     comment, share, report, tap CTA.  Customer upload: DISABLED.
V2:  Vendor / Creator upload behind moderation + approval
     (REJECTED status + admin review already exist for this).
```

Admin upload is NOT customer upload with a different button — it is a
separate pipeline (presigned S3, FFmpeg, preview, schedule) behind `webAuth`,
while customer interaction stays on `appAuth` routes.

## 19. V1 architecture (end to end)

```text
┌───────────────┐      compression      ┌────────────────┐
│  ADMIN PANEL  │ ────────────────────▶ │ OBJECT STORAGE │
│ upload · edit │   presigned upload    │  (S3 via media │
│ preview ·     │                       │   storage cfg) │
│ schedule ·    └────────┐              └───────┬────────┘
│ publish ·     │        │                      │ FFmpeg
│ analytics     │        │              ┌───────┴───────┐
└───────────────┘        │              ▼               ▼
                         │           720p MP4       Thumbnail
                         │              │               │
                         │              └───────┬───────┘
                         │                      ▼ CDN
                         │              ┌───────────────────┐
                         │              │  CUSTOMER REELS   │
                         │              │ watch · like ·    │
                         └──────────────▶ save · comment ·  │
                                        │ share · social    │
                                        │ proof · CTA       │
                                        └─────────┬─────────┘
                                                  ▼ existing Localwala
                                                  order / booking /
                                                  property / service flow
```

## 20. Build status

Done and verified: §§1–9 backend (social kernel, reels feed + interactions,
admin publishing APIs, media service, workers, rate limits, moderation
endpoints, `verify.reels.social.js` 26/26); Customer_app social sync +
`ReelSocialProof`, reels bloc + feed view + comments + privacy screen +
6th tab + router + settings entry (15/15 tests, analyzer clean); Admin_panel
reels section — list with 8 status tabs, create/edit form with presigned
upload flow, preview + analytics dialogs, reports queue, sidebar + 4-locale
i18n (`ng build` green, matrix spec 4/4).

Remaining: live-environment end-to-end run (S3-backed storage setting +
ffmpeg binary + MongoDB), Phase-2 scale items (`users.phoneHash`, Redis
swap, V2 creator uploads), designer tab icon + city/locality dropdowns
(currently ID inputs), reels chrome l10n in Customer_app.
