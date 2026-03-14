# Visual Hierarchy & Layering (Non-negotiable)

## Goal
Ensure the UI has clear “layers” and contrast so a first-time admin can answer in 3 seconds:
1) Where do I start?
2) What’s the primary action?
3) What am I looking at right now?

## The 5-Layer Model (must be visible everywhere)

### L0 — Page Canvas
- Background is not pure white or pure black; use subtle texture/gradient.
- Purpose: make L1 surfaces pop.

### L1 — Section Surface
- Sections have a distinct container (Card / Panel) with border and subtle shadow.
- Purpose: group related controls and content.

### L2 — Interactive Surface
- Buttons/inputs/pills have stronger contrast than L1.
- Purpose: “this is clickable” is obvious without hover.

### L3 — Focus/Selection
- Selected row/tab/filter has a clear state:
  - border + ring + background shift (not just color text)
- Purpose: show “current context.”

### L4 — Primary CTA
- One (1) dominant CTA per page, always in the same location pattern:
  - top-right of header OR bottom sticky action bar
- Purpose: immediate next action is unmistakable.

## Contrast and “Volume” Rules
- No two adjacent surfaces may share the same background tone.
- Cards are not allowed to be flat white/flat black.
- Borders must exist on all cards and tables (1px), using the border token.
- Interactive elements must have:
  - default, hover, active, disabled, focus-visible states
  - focus ring visible on keyboard nav
- Minimum contrast target: WCAG AA (4.5:1 for text).

## Interaction Rules (avoid Pixelmingo mistakes)
- Pills/badges: distinguish “filter chips” vs “status badges” visually:
  - Filters: outlined + subtle fill on selected
  - Status: solid muted fill + icon optional
- Tables: selected row is a full-row background + left accent indicator.
- Always show hover affordance on clickable rows (`cursor-pointer` + hover surface).

## Density & Layout
- Grid-first layout:
  - Header (title + scope + primary CTA)
  - KPI row (3–4 cards)
  - Main content (table/detail)
- Use consistent vertical rhythm: 24px section spacing; 12–16px intra-card spacing.

## Tokens (do not hardcode)
- background, foreground, card, muted, border, ring, primary, secondary, destructive
- A single accent system:
  - Primary accent for main CTA
  - Secondary accent for highlights
  - Callout accent for “insight banners” only

## QA Checklist per page
- Can a new user find the primary CTA in <3 seconds?
- Are there distinct surfaces (L0-L4) visible?
- Does the selected state look different without color alone?
- Can you tell clickable rows from non-clickable content?
- Are loading/empty/error states styled as L1 surfaces?
