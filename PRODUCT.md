# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the developer-owner, a software engineer job-hunting. They use the
side panel mid-application, open beside a job form they are about to submit,
so speed and trust beat looks. They use the dashboard afterwards to look back
over applications. (Confirmed 2026-11-18.)

## Product Purpose

ApplyMate maximizes interview rate. One click on a job application page fills
the standard fields, then attaches a Claude-tailored one-page resume, a cover
letter and drafted answers. The review & chat surfaces exist because tailoring
was a black box: the user must be able to see what the job description asked
for, what went into the resume, what was skipped and why, and fix any of it by
talking to Claude before they press the site's Submit themselves.

## Positioning

Local and zero-API-cost: generation runs through `claude -p` on the user's own
subscription, and files live in `~/.applymate/`. Tailoring is judgment-led but
evidence-checked: every claim must trace to the user's experience corpus, and
checks warn instead of silently rewriting.

## Operating Context

- Chrome MV3 extension: on-page widget (shadow DOM), side panel (~360–400px,
  React + Tailwind), background service worker.
- Localhost bridge (127.0.0.1:4179) streams chat replies; first words arrive in
  about 1–6s and the full reply in about 5–9s.
- Next.js + Tailwind dashboard on localhost for history: applications, runs,
  versions, chat transcripts.
- The ATS page (Workday, Greenhouse, Lever, Ashby…) is the main stage; the panel
  sits beside it.

## Capabilities and Constraints

- Never submits. Never signs in. Never auto-checks consent boxes.
- Names, contact details, companies, titles, dates and education are never
  editable by Claude. Only the summary, bullets and skills are.
- Nothing changes without an explicit Apply. Every change can be undone, and a
  resume change that breaks the one-page fit is refused with a reason.
- The UI never shows raw part ids (`r1.b2`), only human locations
  ("RBC — Software Engineer · bullet 2").
- Light and dark themes, from one shared token set across the panel and the
  dashboard.

## Brand Commitments

- Name: ApplyMate. The ⚡ button is the one-click action.
- Reference feel (user's pick): Linear / Raycast. Crisp, quiet, keyboard-first
  developer tool.
- Feels wrong if too dense or IDE-like: walls of monospace and raw diffs that
  are tiring to scan.

## Evidence on Hand

- Real saved run:
  `~/.applymate/applications/2026-11-13-company-staff-ai-engineer-agentic-systems/`
  (report.json, jd.md, cover letter).
- No testimonials, users or metrics exist. Never fabricate any.

## Product Principles

1. Show the evidence. Every summary links to the exact change behind it.
2. Nothing silent. Proposals wait for Apply; refusals say why.
3. The page is the stage. The panel must never slow the application down.
4. Calm density. Scannable at a glance, with detail on demand.
