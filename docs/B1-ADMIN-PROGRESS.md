## B1 — COMPLETE

All eight admin route files built. **65 endpoints** live at `/jhatka/admin`,
authorised with `webAuth('jhatka_*')` — deliberately NOT `jhatkaAuth`, because admin is
cross-outlet and `jhatkaAuth` exists to confine a request to ONE outlet.

| File | Endpoints | Covers |
|---|---|---|
| `admin.taxonomy` | 8 | categories, products, variants |
| `admin.outlets` | 9 | outlets, partners, franchises |
| `admin.suppliers` | 7 | suppliers + compliance documents |
| `admin.inventory` | 11 | batches, stock, quarantine/release, recalls, movements, wastage |
| `admin.operations` | 10 | variance, refunds, recurring orders, subscriptions, cancellations, yield specs |
| `admin.settlements` | 10 | settlements, finalise/dispute, payouts, payables, commission rules |
| `admin.orders` | 6 | order search, forensics, variable-weight console, reviews, complaints |
| `admin.compliance` | 4 | overview, records, expiring, recalls + close |

Plus the 7 GET-only consoles the plan named separately are folded into these files:
recalls + wastage (inventory), refunds + recurring-orders + cancellations +
variance (operations), variable-weight (orders), movement ledger (inventory).

## Reference

`docs/JHATKA-ADMIN-SCHEMA-SURVEY.md` — generated from the live Mongoose schemas:
required fields, exact enum members and moneyField paths for all 40 admin models.
**Regenerate rather than guess.**

## The rule this work produced

**Any field a route writes must appear in the survey first.**

Five separate defects in this vertical were "wrote a field the schema does not
define", and every one failed SILENTLY — Mongoose drops unknown paths without error:

| Where | Invented fields | Effect if shipped |
|---|---|---|
| `JhatkaOperatorPayout` (cron) | `netPayablePaise`, `grossEarningsPaise`, `driver` | every payout saved as zeros; riders owed nothing, permanently |
| `JhatkaRecall` (admin) | `affectedOrderCount`, `affectedCustomerCount`, `notes` | recall carries **no customer set** — §11's entire purpose |
| `JhatkaOutletVarianceFlag` (admin) | `reviewedAt`, `reviewedBy`, `reviewNote` | operator decision recorded with no record of who made it |
| `JhatkaCommissionRule` (admin) | `commissionPct` in the editable list | referenced a field that does not exist |
| `JhatkaBatchAllocation` (reservation) | — | needed `business`, which is required |

A silent zero looks like a computed number. It is not an error, so nothing catches it.

## Shadowing — the same trap three times

```
/suppliers/expiring-documents   shadowed by /suppliers/:supplier
/settlements/payouts            shadowed by /settlements/:settlement
/orders/reviews                 shadowed by /orders/:order
```

Express matches in registration order, so a literal declared after `:param` is
**unreachable**. In all three cases the code read correctly and only
`verify.jhatka.vertical.js` found it.

**Rule: in a router mixing `:param` with literals, literals go first.** The vertical
suite is the only thing that catches a violation.

## Guards added beyond CRUD

- Outlet activation **refused** without an unexpired FSSAI licence.
- Outlet/supplier status moves go through transition maps — `closed -> active` impossible.
- New outlets/partners/commission-rules created in a pending state, never active.
- Compliance `status` is **DERIVED from the expiry**, never asserted by an admin. Only
  `pending` is honoured verbatim, as the manual stop.
- Finalising a settlement **refused** if stored margin drifts >0.5pp from recomputation.
- Dispute requires a ≥10-char reason; `finalised -> disputed` impossible (§10.7).
- Approving a **rolled-forward** payout refused — that is what §10.3 exists to prevent.
- Approving a payout with no IFSC/UPI refused.
- An `active` commission rule is **immutable**; two active rules per model refused.
- Closing a recall with unacknowledged customers requires `force:true` + a reason.
- Review moderation to hidden/flagged requires `moderationReason`.
- Supplier document rejection requires `rejectedReason`; documents default `isBlocking`.
- Recall `advisory` deliberately does **not** freeze; `withdraw`/`recall` do, and write
  a `RECALL_FREEZE` movement so the freeze is provable.

## Note on one deviation

`JhatkaInventoryItem` still has **no `variant`** — the receipt service sets `product`
and `batch` only, so allocation joins at product granularity rather than SKU. B6 works,
and §11 recall unions correctly across a split, but a "Chicken Curry Cut" batch could in
principle be allocated to a "Chicken Whole" line. Closing that means changing the receipt
path and the item model, which is a design decision rather than a bug fix.