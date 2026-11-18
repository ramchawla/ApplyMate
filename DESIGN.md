---
name: ApplyMate
description: A quiet review desk for one-click job applications. See what the job asked for, what was sent, and approve every change.
colors:
  accent: "#3657d6"
  accent-hover: "#2b49bf"
  accent-fg: "#ffffff"
  accent-soft: "#eaeefc"
  accent-text: "#2a47b5"
  bg: "#f7f8fa"
  surface: "#ffffff"
  surface-2: "#f1f2f5"
  border: "#e3e5ea"
  border-strong: "#cfd3da"
  text: "#16181d"
  text-2: "#4c515b"
  text-3: "#686e7b"
  add-bg: "#ddf3e4"
  add-text: "#135c36"
  del-bg: "#fbe4e4"
  del-text: "#9e2328"
  ok: "#1d8348"
  ok-bg: "#e4f5ea"
  warn: "#9a5b00"
  warn-bg: "#fff2d6"
  err: "#b8282d"
  err-bg: "#fdeaea"
  kw-present: "#8a94b8"
  kw-injected: "#3657d6"
  kw-skipped: "#cfd3da"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"tnum\""
  small:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "12.75px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  chip: "4px"
  ctl: "6px"
  card: "10px"
  full: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.small}"
    rounded: "{rounded.ctl}"
    padding: "0 10px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-fg}"
  button-plain:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.small}"
    rounded: "{rounded.ctl}"
    padding: "0 10px"
    height: "28px"
  button-plain-hover:
    backgroundColor: "{colors.surface-2}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.small}"
    rounded: "{rounded.ctl}"
    padding: "0 10px"
    height: "28px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
  pill-neutral:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "1px 8px"
  pill-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  status-pill-ok:
    backgroundColor: "{colors.ok-bg}"
    textColor: "{colors.ok}"
    typography: "{typography.small}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  flag-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.text}"
    typography: "{typography.small}"
    rounded: "{rounded.ctl}"
    padding: "8px 10px"
  flag-err:
    backgroundColor: "{colors.err-bg}"
    textColor: "{colors.text}"
    typography: "{typography.small}"
    rounded: "{rounded.ctl}"
    padding: "8px 10px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
  proposal-card-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.small}"
    padding: "9px 12px"
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "8px 8px 8px 12px"
  user-turn:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.small}"
    padding: "8px 12px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.small}"
    rounded: "{rounded.ctl}"
    padding: "6px 10px"
  nav-link-active:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
  kbd:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    height: "16px"
---

# Design System: ApplyMate

## Overview

**Creative North Star: "The Review Desk"**

ApplyMate's two surfaces, the Chrome side panel and the localhost dashboard, are one quiet tool UI in the Linear/Raycast family. The panel is a review desk, not a chatbot. Evidence sits on top, conversation sits below, and every change arrives as a card the user approves. The dashboard's application page is the record of one run: what the job asked for, what was sent, and how it got there. Both surfaces share one token set (`lib/ui/tailwind-preset.cjs`, mirrored from the approved `docs/superpowers/mockups/review-chat/tokens.css`).

Density is calm. Body text is 13.5px system sans on a 4px grid, separated by hairline borders and tonal steps rather than heavy chrome. Color is held back: neutrals carry the structure, a single cobalt accent marks action and "worked in", and green and red appear only in word diffs and outcomes. The user rejected two failure modes. One is the support-widget bubble stream. The other is the IDE diff wall: too dense, monospace, raw LaTeX. Diffs render as proportional prose with bold kept.

Light and dark both follow the OS through `prefers-color-scheme`, and `data-theme="light|dark"` on the root pins one. Tokens are CSS custom properties, so components never use `dark:` variants.

**Key Characteristics:**
- System UI sans at 13.5px, with tabular numerals on the body. No monospace anywhere, including `<kbd>`.
- One cobalt accent. Everything else is neutral, plus status and diff hues.
- Hairline 1px borders and tonal surfaces (`surface` / `surface-2`). Almost no shadow.
- Three radii: chip 4, control 6, card 10, plus fully rounded pills.
- Every change is a card with explicit Apply / Dismiss / Undo. Nothing changes silently.

## Colors

A cool, near-white neutral field with one cobalt voice. Status and diff hues each come as a tinted background plus a deep text tone.

### Primary
- **Cobalt** (accent): primary buttons (Apply, Send, Resume PDF), the brand mark, the streaming caret, focus rings, and "worked in" keyword ticks (`kw-injected` equals the accent). Dark theme lifts it to a brighter periwinkle (see sidecar).
- **Cobalt Deep** (accent-hover): hover on primary buttons.
- **Cobalt Wash** (accent-soft) with **Cobalt Ink** (accent-text): the accent version pill, info flags ("go back to an earlier step"), and inline text links such as Restore and Download PDF.

### Neutral
- **Desk Grey** (bg): the dashboard page background. The side panel body sits on `surface` instead.
- **Paper** (surface): panels, cards, boxes, nav bar, composer.
- **Fog** (surface-2): card headers, user chat turns, neutral pills, hover fills, active nav and tab state, `<kbd>`.
- **Hairline** (border) and **Firm Hairline** (border-strong): Hairline divides rows and sections. Firm Hairline outlines interactive edges: plain buttons, the composer, unapplied proposal cards, and the skipped keyword tick.
- **Ink** (text), **Slate** (text-2), **Pewter** (text-3): primary text, secondary text and body prose in diffs, and meta lines and placeholders.

### Status and diff
- **Added** (add-bg / add-text) and **Removed** (del-bg / del-text): only on `<ins>` / `<del>` word diffs.
- **Ok** (ok / ok-bg): the Applied state, the bridge-connected dot, applied/interviewed status pills, and the green-tinted border of an applied card.
- **Warn** (warn / warn-bg): checker warnings and warning flags.
- **Err** (err / err-bg): refusals ("Doesn't fit"), errors, the offline bridge dot, rejected status.
- **Keyword ticks**: kw-present (muted lavender-grey, "already on your resume"), kw-injected (accent, "worked in"), kw-skipped (Firm Hairline grey).

### Named Rules
**The One Cobalt Rule.** The accent marks only primary actions, the current version, and worked-in keywords. When the accent appears on decoration or as a second emphasis, the hierarchy collapses.

**The Green-Means-Outcome Rule.** Green and red appear only in word diffs and in outcomes (applied, refused, error, bridge state). They never act as decoration or category color.

## Typography

**Body Font:** System UI sans (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`), followed by the emoji fonts.
**Display / Mono:** none. One family carries every role.

**Character:** Native, compact, and unbranded, so the tool feels like part of the OS. Hierarchy comes from weight (400 / 500 / 600) and three small size steps, never from a second face.

### Hierarchy
- **Headline** (600, 22px, 1.25, -0.02em): the dashboard application title only, balanced wrapping.
- **Title** (600, 15px, 1.3, -0.01em): the panel job title and dashboard section headings, with an optional Pewter count beside them in Small.
- **Body** (400, 13.5px, 1.5, tabular numerals): default UI text and chat replies. Long prose (diffs, letters, answers) opens up to a 1.6–1.65 line height in Slate, with `<b>` lifted to Ink 600.
- **Small** (400–600, 12.75px, 1.5): the workhorse, and the most-used size. Buttons, tabs, nav links, meta lines, flags, card headers.
- **Label** (500–600, 12px, 1.5): pills, the "Claude" speaker label, card state ("Applied", "Not applied"), keyboard hints, legends.

### Named Rules
**The No-Mono Rule.** No monospace in the UI. Word diffs are proportional prose, `<kbd>` keys use the sans face, and LaTeX or raw part IDs never reach the screen.

**The Sentence-Case Rule.** Every label, heading and button is in sentence case at normal tracking. The system has no uppercase tracked labels.

## Layout

A 4px spacing grid (4 / 8 / 12 / 16 / 24 / 32). Rows breathe at 12px vertical padding inside a 16px gutter.

- **Side panel** (~360–400px, full height, flex column): a top zone with the job title and company left, and the bridge dot plus version and page pills right. Under it, the **coverage strip** (one 8px-tall tick per JD keyword, 2px gaps, colored by keyword state, ticks grow 1.6x on hover). Under that, a tab row (Keywords, Changes, Letter, Answers, Warnings). The tab body is capped at 268px and scrolls, and clicking the active tab collapses it. The chat thread fills the rest. The composer is pinned at the bottom behind a hairline.
- **Dashboard** (max width 1240px, 24px gutters, 24px top / 64px bottom): a sticky 48px nav, breadcrumb, then a header grid (title block left, PDF actions right) with a hairline below. The coverage bar follows. The body is a two-column grid at 1000px and wider: the report column (`minmax(0, 1fr)`) and a 380px aside for versions, runs and the chat transcript, with a 32px gap. Below 1000px it stacks. Keywords lay out in three columns at 1000px and wider.
- Sections are spaced 32px apart, with their heading 10px above the content.

**The Evidence-First Rule.** On both surfaces, the evidence (what the job asked for and what was done) comes before conversation or history. The coverage strip always sits directly under the title.

## Elevation & Depth

The system is flat and uses tonal layering. Depth comes from `surface` over `bg`, `surface-2` headers inside cards, and 1px hairlines. The only shadow in the built UI is the soft **shadow-1** on proposal cards, which lifts the actionable card slightly above the thread. A larger **shadow-2** exists in the token set but no built component uses it. The focus ring is a two-layer box-shadow (a 2px surface gap, then a 2px cobalt ring at 55%) and applies globally to `:focus-visible`.

**The Flat-Desk Rule.** Surfaces rest flat. Only the thing waiting on the user's decision, the proposal card, gets lift.

**The No-Nesting Rule.** No cards inside cards. Dashboard sections are single hairline boxes with internal row dividers.

## Shapes

Three corner steps, by role. **Chip** (4px) for small tags, skeleton bars, `<kbd>` keys, and version numbers. **Control** (6px) for buttons, inputs, flags, nav links, and the global focus ring. **Card** (10px) for cards, boxes, and the composer. Pills and status badges are fully rounded. Coverage ticks and legend swatches use a 2px micro-radius, and `<ins>`/`<del>` highlights use 3px with `box-decoration-break: clone` so wrapped lines keep their caps. The user chat turn is the single asymmetric shape: 10px corners with a 3px bottom-right "tail" corner. Icons are inline line SVGs (Lucide-style geometry, 1.75 stroke, 14px default, round caps).

## Components

### Buttons
Compact and quiet. Three variants share one 28px-tall shell.
- **Shape:** control radius (6px), 28px tall, 10px horizontal padding, Small 500, 6px icon gap, 1px border.
- **Primary:** cobalt fill and border, white text. Hover deepens to Cobalt Deep. Used for Apply, Send and Resume PDF, at most one per decision.
- **Plain:** Paper fill, Firm Hairline border, Ink text. Hover goes to Fog. Used for Job posting and Ask for shorter.
- **Ghost:** no fill or border, Slate text. Hover goes to Fog with Ink text. Used for Dismiss and Undo.
- **Icon button:** 28px square, control radius, the same three treatments (Send is primary, Stop is Fog with a Firm Hairline).
- **Disabled:** 50% opacity, not-allowed cursor. Busy states swap the label ("Applying…", "Undoing…").

### Pills and status
- **Neutral pill:** Fog fill, Hairline border, Slate Label text, fully rounded. Used for the page count.
- **Accent pill:** Cobalt Wash with Cobalt Ink, no border. Used for the current version.
- **Status pill (dashboard):** tinted status background with matching text, fully rounded, a 6px currentColor dot before the text, Small 500.

### Proposal card (signature)
The unit of change. Paper, card radius, shadow-1, and a Firm Hairline border that turns ok-tinted (45% ok mixed into the border) once applied. The header is a Fog strip with the location label (Small 600, truncated) and the state at right: "Not applied" in Pewter, "Applied" in ok with a check icon, or "Doesn't fit" in err with an x icon. The body is a word diff (max 240px, scrolls, 1.6 line height) and a Pewter "why" line. **Flags** sit between body and footer: control-radius tinted strips (warn-bg, err-bg, or accent-soft for info) with an icon and Ink text. The footer holds Apply + Dismiss with a `⌘ ↵ apply` hint at right, or a Version note + Undo once applied. A refused card dims its body to 72% and offers "Ask for shorter". A dismissed card collapses to a one-line Pewter row with Restore.

### Word diff
`<del>` is the Removed tint with a 1px strike. `<ins>` is the Added tint with no underline. Both use proportional text, 3px radius, and 2px side padding. This is shared by the panel's Changes tab, the proposal cards, and the dashboard's bullet diff.

### Chat thread
- **User turn:** right-aligned Fog block with a Hairline border, max 86–88% width, tail-corner shape, 8px / 12px padding.
- **Claude turn:** plain text with no bubble and no avatar, under a Label-size "Claude" speaker line in Pewter 600. While streaming, a 7x15px cobalt **caret** blinks at the end.
- **Loading:** shimmer skeleton bars (Fog to Hairline gradient, 1.4s linear, chip radius).

### Composer
A card-radius box with a Firm Hairline. On focus the border turns cobalt and gains the focus ring. The auto-growing textarea (22–120px) sits next to a 28px Send icon button, which becomes Stop while streaming. Under it is a Label-size hint row in Pewter, `<kbd>` keys on the left and "Changes only apply when you click Apply" on the right.

### Tabs
A horizontal tab row, 32px tall, Small 500 text, 2px bottom border that marks the active tab, and a 2px gap between tabs. The panel below is bordered on top and capped at 268px.

### Navigation (dashboard)
A sticky 48px Paper bar with a Hairline bottom border. Brand: a 22px cobalt control-radius square with a zap icon, plus "ApplyMate" in 600 at -0.01em. Links are Small 500 Slate, padded 6px / 10px with control radius. Hover and `aria-current` both get a Fog fill with Ink text.

### Keyboard keys
`<kbd>`: 16px tall, at least 16px wide, Fog fill, Hairline border, chip radius, Label-size sans in Slate.

## Do's and Don'ts

### Do:
- **Do** take every color, size, radius and shadow from the shared preset (`lib/ui/tailwind-preset.cjs`) through its custom properties, so light and dark stay in lockstep.
- **Do** keep the accent to primary actions, the current version, and worked-in keywords (The One Cobalt Rule).
- **Do** render every resume, letter or answer change as a proposal card with explicit Apply, and keep Undo reachable after applying.
- **Do** show diffs as proportional prose with `<ins>`/`<del>` tints and bold preserved.
- **Do** use Small (12.75px) for controls and meta, and Body (13.5px) for reading.
- **Do** give every interactive element the global `:focus-visible` ring, and honor `prefers-reduced-motion` (all animation and transitions off).

### Don't:
- **Don't** use monospace, LaTeX, or raw part IDs (`r1.b2`) anywhere in the UI.
- **Don't** build chat as a bubble stream with avatars. Claude's turns are plain text under a label.
- **Don't** nest cards in cards, or lay out the dashboard as stat tiles.
- **Don't** use green or red outside diffs and outcomes, or introduce a second accent hue.
- **Don't** use stock Tailwind palette classes (`gray-*`, `blue-*`) or `font-bold` headings. Those belong to pre-restyle dashboard pages and are not part of this system.
- **Don't** add uppercase tracked labels or eyebrow text above headings.
