# Ledgerly Canonical Data Specification — Schema 4

## Core rule
The dashboard is a view of one canonical ledger. It never stores separate dashboard totals. Every displayed total is derived from creditor transactions.

## Currency
Ledgerly 3.0 is SAR-only. All financial amounts are integers in **halalas** (`1 SAR = 100 halalas`). `2620.66 SAR` is stored as `262066`.

## Creditor
A creditor is an identity, not a balance. The stable `creditor.id` never changes when the name changes. Aliases, tags and contact details are metadata and do not affect balances.

## Transaction types
- `debt`: increases liability.
- `payment`: actual cash paid; decreases liability.
- `adjustment`: creates a new increase or decrease without rewriting old history.
- `waiver`: creditor-forgiven amount; decreases liability but is not cash paid.
- `reversal`: creates the opposite financial effect of a referenced payment, waiver or adjustment.

## Void
A voided transaction remains in history but has zero financial effect. A reason and timestamp are stored. Ledgerly does not silently delete financial history.

## Dates
- `effectiveDate`: date the financial event actually happened (`YYYY-MM-DD`, timezone-independent calendar date).
- `createdAt`: timestamp when the record was entered.
- `updatedAt`: timestamp of the latest correction.

## Payments / allocations
Payments and waivers can allocate amounts to one or more debt transaction IDs. Default strategy is oldest-first. A transaction cannot allocate to a debt belonging to another creditor.

## Balance
For each creditor:
`liability = debt + net adjustments`
`reductions = payments + waivers - active reversals of those reductions`
`remaining = max(0, liability - reductions)`

## Quality
- Confirmed
- Estimated
- Disputed
Optional `verificationSource` and `verifiedAt` document how/when the amount was verified.

## Planning
Plan fields (`plan.amountHalalas`, frequency, target date) never affect actual balances.

## Audit
New audit entries are hash-linked. Imported legacy audit entries are preserved and explicitly marked as legacy/unhashed.

## Revision control
Every persisted ledger state has one monotonically increasing local `revision`. A stale tab cannot overwrite a newer revision.

## Schema compatibility
A Ledgerly version must refuse to write a schema version newer than it understands. Migration is versioned and must occur before normal writes.
