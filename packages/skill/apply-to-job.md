---
name: apply-to-job
description: Tailor a resume and cover letter to a job description using anchor-validated rewriting. Use when the user provides a job description plus their experience corpus and wants a tailored resume.
---

# /apply-to-job

Hybrid pipeline. You (Claude) supply linguistic judgment; the TypeScript
modules in `packages/skill/src` supply deterministic machinery and the
non-negotiable validation. Never bypass the validator.

## Inputs
- Job description, job title, company, job URL.
- Detected form fields (from the extension).
- Optional manual context from the user.
- Experience corpus at `~/.applymate/experience.yaml` (anchors + `not_done`
  honesty guardrails — never claim anything listed under `not_done`).
- Resume template at `~/.applymate/resume-template.tex` (carries the
  `%%BULLETS%%` marker; full source of truth at `~/.applymate/resume-master.tex`).
- Audience directives at `~/.applymate/generation-directives.md` — detect the
  target audience (FAANG / startup / enterprise-finance / AI-ML / platform) from
  the company + JD and bias arc ordering, metric framing, and tone accordingly.

## Flow

1. **Stage 1 — Parse JD (code, then augment).**
   Call `parseJD(jobDescription)`. Read its output, then add any domain
   keywords it missed from your own reading. Keep keywords lowercased.

2. **Stage 2 — Retrieve (code).**
   Load the corpus (`loadCorpus`). If the local Postgres+pgvector container is
   running, embed with `upsertAnchors` and call
   `retrieve(client, parsedJD, anchors, k=8)`. If it is not (the common case),
   call `retrieveInMemory(parsedJD, anchors, k=8)` — same local embeddings,
   same ranking, no database needed. These ranked experiences are your
   evidence base.

3. **Stage 3 — Rewrite (you propose, code validates).**
   For each resume bullet, propose a `RewriteCandidate`: the revised text,
   the keywords you added, and why. ONLY add a keyword if a retrieved
   experience supports it. Preserve every original metric verbatim. Pass each
   candidate to `validateRewrite(candidate, anchors, parsedJD)`. If
   `invariantChecksPassed` is false, either revise your candidate or drop the
   keyword — do not override the validator. Collect all `BulletRewrite`s.

4. **Stage 4 — Assemble LaTeX (code).**
   Call `assembleLatex(template, rewrites)`.

5. **Stage 5 — Cover letter (you write, code assembles).**
   Write 2–3 grounded body paragraphs (no invented facts). Pass them to
   `assembleCoverLetter(...)`.

6. **Compose.** Call `composeOutput(...)` and return the `ApplyJobOutput`.
   Surface `rewritingReport` to the user — especially any bullet with
   `plausibilityScore < 0.7` or `invariantChecksPassed === false` — and ask
   for approval before the resume is used. Never auto-submit.

7. **Publish to the extension (bridge).**
   Add the `jobUrl` field to the output and POST it to the local bridge so the
   side panel can pick it up. The bridge requires the bearer token it printed
   on startup (also at `~/.applymate/bridge-token`):

   ```bash
   TOKEN=$(cat ~/.applymate/bridge-token)
   curl -s -X POST http://127.0.0.1:4179/output \
     -H 'content-type: application/json' \
     -H "authorization: Bearer $TOKEN" \
     -d @output.json
   ```

   The POSTed JSON must include `jobUrl`, `company`, `jobTitle`, and
   `jobDescription` in addition to the `ApplyJobOutput` fields, so the bridge
   can persist a full application + JD archive row to SQLite.

   If the POST fails, tell the user to start the bridge with `pnpm bridge`,
   then retry. Never block on this — the report and LaTeX are already produced.

## Hard rules
- No invented skills, metrics, employers, or dates.
- Every added keyword maps to a corpus anchor; the validator enforces this.
- Low-confidence bullets (< 0.7) require explicit user handling.
