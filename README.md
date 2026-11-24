# ApplyMate

One click on a job application page fills every standard field, then attaches a
one-page resume tailored to that job, a cover letter, and answers to the
custom questions. A side panel shows exactly what was changed and why, and lets
you chat with Claude to fix anything before you apply.

Everything runs on your machine. Generation goes through the **Claude Code CLI
on your own Claude subscription** (`claude -p`), so there is no API key and no
per-call cost beyond your plan's usage limits.

**It never submits.** ApplyMate fills and attaches; you review the page and click
the site's Submit yourself. It never signs in for you, never ticks consent
boxes, and never invents employers, titles, dates or metrics.

## How it runs without an API key

ApplyMate never calls Anthropic itself. Its local bridge runs the `claude`
command (Claude Code) on your computer, and Claude Code uses whichever Claude
account is logged in there. Your usage counts against your own plan; no API key
is involved.

1. **Have a paid Claude plan.** Pro or Max both include Claude Code; the free plan doesn't.
2. **Install Claude Code and log in once:**
   ```bash
   npm install -g @anthropic-ai/claude-code   # or the installer from claude.com/claude-code
   claude                                      # then /login and sign in with your Claude account
   claude -p "reply with ok"                   # prints ok = ApplyMate will work
   ```
3. **Make sure `ANTHROPIC_API_KEY` is not set** in your shell. If it is, Claude
   Code bills that key instead of your plan. (ApplyMate never uses `--bare`, the
   one Claude Code flag that would force API-key mode.)

## What you get

- **⚡ One-click fill** on Greenhouse, Lever, Ashby, Workday, LinkedIn Easy Apply,
  company career pages and embedded ATS forms. Multi-step wizards are filled step
  by step and stopped on the review page.
- **Tailored resume**: Claude rewrites your summary, bullets and skills toward the
  job description using only what your master resume and experience notes
  support, keeps it to one page, and compiles a PDF that is attached to the form.
- **Cover letter and custom answers** drafted per job ("Why this company?" answers
  tie the company to your own `motivations`).
- **Review & chat** side panel: which job keywords are covered, worked in or
  skipped (and why), word-by-word diffs against your master, warnings, the letter
  and answers. Ask Claude for changes; nothing changes until you click **Apply**,
  and every change can be undone. Applied changes are pushed back into the open
  form.
- **Dashboard** (local Next.js app): every application with its runs, resume
  versions (PDF each), report and chat transcript.

## Requirements

| | |
|---|---|
| OS | macOS (tested). Linux/Windows should work with `pnpm bridge` in a terminal instead of the launchd agent, but are untested. |
| Node.js | **22.13 or newer** (uses the built-in `node:sqlite`) |
| pnpm | 9 (`corepack enable` gives you the pinned version) |
| Claude Code CLI | installed and **logged in with a Claude Pro or Max subscription** |
| Tectonic | LaTeX engine for the PDFs (`brew install tectonic`) |
| Google Chrome | or another Chromium browser that loads unpacked extensions |

Check Claude works on your subscription before you start:

```bash
claude -p "reply with ok"        # should print ok without asking for an API key
```

> If `ANTHROPIC_API_KEY` is set in your shell, Claude Code bills that key
> instead of your subscription. Unset it before running `pnpm bridge` or
> `pnpm bridge:install`.

## Setup

### 1. Install

```bash
git clone https://github.com/ramchawla/ApplyMate.git
cd ApplyMate
corepack enable
pnpm install
brew install tectonic
```

### 2. Add your files to `~/.applymate/`

ApplyMate reads everything about you from this folder (override it with
`APPLYMATE_DIR`). Nothing here is ever committed to the repo.

```bash
mkdir -p ~/.applymate
```

**`resume-master.tex` (required).** Your full one-page resume in LaTeX, in the
widely used "Jake's Resume" style. ApplyMate only edits the parts it can
address, so the file needs:

- a `\section{Summary}` (or `Profile` / `Objective`) with the summary paragraph;
- bullets as `\resumeItem{...}` inside `\resumeItemListStart … \resumeItemListEnd`,
  under `\resumeSubheading`, `\resumeOrgHeading` or `\resumeProjectHeading`;
- skills lines as `\textbf{Languages}{: Python, Go, ...}` in a skills section.

`tests/skill/fixtures/resume-master.tex` is a complete working example; copy it
and replace the content with yours. Overleaf (pdfLaTeX) resumes compile as-is.
Your name, contact details, companies, titles, dates and education are never
shown to Claude for editing.

**`experience.yaml` (strongly recommended).** The ground truth Claude tailors
from. Anything you want it to be able to say about you belongs here or in the
master resume; it will not claim work that isn't in either. Free-form YAML;
`profile.name` and `profile.email` are used to seed your profile.

```yaml
profile:
  name: Jane Dev
  email: jane@example.com
experiences:
  - company: Acme
    title: Software Engineer
    dates: 2023 - present
    highlights:
      - Built the CI platform used by 15 services; cut deploy time from 2h to 5 min
      - Led the migration from Jenkins to GitHub Actions
    skills: [TypeScript, Kubernetes, GitHub Actions]
projects:
  - name: Side project
    highlights:
      - What you built, real numbers only
```

**`generation-directives.md` (optional).** Notes on how to pitch yourself to
different audiences (startups, big tech, AI labs...). Plain text.

### 3. Create your autofill profile

```bash
pnpm profile:init     # writes ~/.applymate/profile.yaml (never overwrites an existing one)
pnpm profile:sync     # Claude fills work / education / skills / languages from your resume
```

Open `~/.applymate/profile.yaml` and fill in what can't be inferred: phone,
address, work authorization, sponsorship, salary, links. Two sections are worth
adding:

```yaml
motivations: |
  What you actually care about in a job: the problems, team stage, products,
  location. Used to write specific "why this company?" answers.

answers:                          # fixed answers for repeat questions
  - match: how (did )?you (hear|find|learn)   # case-insensitive regex on the question
    answer: LinkedIn
```

### 4. Check tailoring end to end

```bash
pnpm tailor:smoke                 # sample job description
pnpm tailor:smoke path/to/jd.txt  # or a real one
```

This runs Claude and Tectonic on your files and prints the result. Fix any
"Master resume not found" or LaTeX errors here before going further.

### 5. Start the bridge

The bridge is a small local server (127.0.0.1:4179 only) that the extension
talks to; it runs Claude and Tectonic for it.

```bash
pnpm bridge:install   # macOS: starts now and at every login (launchd)
# or
pnpm bridge           # any OS: run in a terminal you keep open

curl -s http://127.0.0.1:4179/health   # {"ok":true}
```

Run `bridge:install` from the same shell where `which claude` and
`which tectonic` work: the agent keeps that `PATH`. Logs go to
`~/.applymate/bridge.log`.

### 6. Load the extension

```bash
pnpm build:extension
```

In Chrome open `chrome://extensions`, turn on **Developer mode**, click
**Load unpacked** and pick `packages/extension/dist`. The extension pairs with
the bridge automatically the first time it connects. If you reinstall the
extension and it can't connect, run `pnpm bridge:unpair` and reload it.

## Using it

1. Open a job's application form (sign in to the site yourself if it needs it).
2. Click **⚡** in the ApplyMate card. Standard fields fill at once; about a
   minute later the tailored resume is attached and custom questions are
   answered. If the page shows no job description, paste it in the side panel's
   "Job description and bridge" section first, or add keywords in the card.
3. Click **Review & chat →** to open the side panel. Check the keywords, the
   changes and the answers. Ask for anything ("make the summary punchier",
   "why did you skip Rust?"); proposed changes appear as cards with **Apply** /
   **Dismiss**. Applied resume changes are rebuilt (still one page) and
   re-attached; applied answers are refilled. If the form has moved on, use
   **Fill again** once you're back on that step.
4. Review the page and click the site's **Submit** yourself. ApplyMate notices
   and marks the application as applied.

On multi-step wizards (Workday, LinkedIn Easy Apply...) one ⚡ fills each step,
presses Next, and stops at the review page. It pauses on anything it can't fill
or that the site rejects; fix it and press ⚡ again to continue.

### Dashboard

```bash
pnpm dev:dashboard    # http://localhost:3000
```

Applications, each run's report, resume versions (PDF per version) and the chat
transcript. Data lives in `~/.applymate/app.db` and `~/.applymate/applications/`.

## Configuration

Set these in the environment the bridge runs in (re-run `pnpm bridge:install`
after changing them for the launchd agent).

| Variable | Default | |
|---|---|---|
| `APPLYMATE_MODEL` | `sonnet` | Claude model for tailoring, answers and chat |
| `APPLYMATE_EFFORT` | `low` | Reasoning effort (`low` takes ~50 s per tailoring) |
| `APPLYMATE_DIR` | `~/.applymate` | Where your files and output live |
| `APPLYMATE_CLAUDE_BIN` | `claude` | Path to the Claude Code CLI |

Each tailored application uses one Claude call (plus a short one per wizard
step and one per chat message), counted against your subscription's usage
limits.

## Updating

```bash
git pull && pnpm install
pnpm build:extension                                  # then ↻ the extension in chrome://extensions
launchctl kickstart -k gui/$(id -u)/com.applymate.bridge   # restart the bridge (or restart `pnpm bridge`)
```

## Troubleshooting

| Problem | Fix |
|---|---|
| No ApplyMate card on the page | Reload the tab. The card appears on pages with an application form; if a site isn't detected, open an issue with the URL. |
| Card says the bridge is offline | `curl -s http://127.0.0.1:4179/health`. Not running: `pnpm bridge:install` again; then check `~/.applymate/bridge.log`. |
| `claude` or `tectonic` not found in the log | Re-run `pnpm bridge:install` from a shell where both are on `PATH`. |
| Claude asks for an API key / bills an API key | Unset `ANTHROPIC_API_KEY`, log in with `claude` (`/login`), re-install the bridge. |
| "Master resume not found" | Put your resume at `~/.applymate/resume-master.tex` (or set `APPLYMATE_DIR`). |
| Edits keep getting reverted or refused | The resume must stay one page. Ask for a shorter version, or trim your master. |
| Extension can't pair after a reinstall | `pnpm bridge:unpair`, then reload the extension. |

## Privacy

Your resume, notes, profile and outputs stay in `~/.applymate/` on your machine.
The job description, your resume text and your notes are sent to Claude through
your own Claude Code login, the same as typing them into Claude yourself. The
bridge only listens on 127.0.0.1 and requires a token that only the paired
extension has. Job pages are treated as untrusted text, never as instructions.

## Development

```bash
pnpm test && pnpm test:skill && pnpm test:bridge     # extension / engine / bridge
(cd packages/dashboard && npx vitest run)            # dashboard
pnpm type-check && pnpm type-check:skill && pnpm type-check:bridge
```

Architecture, key files and project constraints are in [CLAUDE.md](CLAUDE.md);
design specs and plans in [docs/superpowers/](docs/superpowers/); the visual
system in [DESIGN.md](DESIGN.md).
