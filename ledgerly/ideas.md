# Debtview design brief

## Direction

**Quiet Wealth / Ledger Shield** — a premium personal-finance workspace that feels calm, private, and intentional rather than noisy or corporate.

## Design movement

Editorial fintech with soft geometry: warm paper-like surfaces, deep ink panels, precise numbers, and one confident semantic accent. The interface should feel like a private financial instrument, not a spreadsheet.

## Core principles

- Make the remaining balance immediately legible.
- Keep the main view calm; reveal historical detail only when requested.
- Treat every debt and payment as a durable record.
- Use color to communicate state, never for decoration.
- Prefer generous rhythm and tactile controls over dense tables.

## Color philosophy

Ink #16202A anchors text and navigation. The canvas is warm #F7F7F3. Remaining balances use restrained rose-coral #D86B62. Paid state uses emerald #1E9A79. Estimated values use amber #C79242. Borders are cool gray-blue #D9DFE2. Charts use softened tints of those semantic colors.

## Layout paradigm

A wide editorial dashboard: a narrow header, a strong opening balance block, a compact KPI rail, a two-column analytics area, then a searchable creditor workspace. Cards have rounded 22px corners, thin outlines, and restrained shadows. On mobile, the hierarchy becomes a single column with sticky-friendly action controls.

## Signature elements

- An inline shield with a ledger line and center notch as the product mark.
- A circular progress ring with a solid numeric center.
- Slim horizontal progress tracks inside creditor cards.
- “Reconciled” as a calm trust signal near the main balance.
- Small uppercase eyebrow labels paired with large financial numbers.

## Interaction philosophy

Primary actions are obvious and direct. Forms are modal and short. Historical details expand in place. Destructive paths always confirm. Lock icons and quality badges make data state visible without making the user feel policed.

## Motion

Use 160–240ms ease-out transitions for modal entry, accordion expansion, progress fill, and button feedback. Respect reduced-motion preferences and avoid looping motion.

## Typography system

Use an offline-safe system stack: `Inter`, `ui-sans-serif`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif. Numeric values use tabular numerals and tight tracking. Labels use compact uppercase letter spacing.

## Brand essence and voice

**Private clarity.** Copy is concise, reassuring, and factual: “Current remaining”, “Locked record”, “Reconciled”, “Add payment”. Avoid forecasting, pressure, or prescriptive repayment language.

## Wordmark/logo

The wordmark is `ledgerly` in the UI, paired with the Ledger Shield symbol. The final HTML contains the symbol as inline SVG and as a data-URI favicon so it works offline.

## Signature brand color

Emerald #1E9A79 is the signature color, used sparingly for paid state, confirmations, and active controls.
