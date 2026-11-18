import type { ChatMessage, RunState } from "../../../../lib/shared/types";
import { UNTRUSTED_LINE, questionLines } from "./prompt";
import type { ResumeDoc } from "./resume-doc";

export const CHAT_HISTORY_LIMIT = 20;

export const CHAT_SYSTEM = `You are the candidate's application coach inside ApplyMate. You discuss one job application: the tailored resume, cover letter and form answers below.

${UNTRUSTED_LINE}

Talk first: answer in plain prose, short (2-6 sentences), direct, honest. Push back when the user asks for something the corpus doesn't support. In your prose, refer to resume parts and questions by their label, never by the [id] or answer:<id>.

Then, ONLY if you are proposing concrete changes, end your message with exactly one fenced block:
\`\`\`proposals
[{"target": "<resume part id | cover-letter | answer:<fieldId>>", "after": "<full new text>", "why": "<one line>"}]
\`\`\`
Rules:
- Resume targets are ids from "Current resume parts"; "after" is LaTeX, at most the max length shown. Keep the existing \\textbf{} emphasis style; escape % & $ # _ as \\% \\& \\$ \\# \\_; keep braces balanced; no new macros or environments.
- Never invent metrics, employers, titles, dates, degrees, certifications or projects. Every claim must be supported by the part itself or the experience corpus.
- cover-letter "after" is the full new letter, plain text.
- Form answer targets are answer:<fieldId> from "Form answers". Answers for questions with options must be one option copied verbatim.
- No block when you are only talking.`;

export interface ChatContext {
  jd: string;
  doc: ResumeDoc;
  labels: Record<string, string>;
  state: RunState;
  corpusYaml: string;
  profileYaml: string;
  history: ChatMessage[];
  message: string;
}

const orNone = (s: string) => s.trim() || "(none)";

export function buildChatPrompt(c: ChatContext): string {
  const parts = c.doc.parts.map(
    (p) =>
      `[${p.id}] ${c.labels[p.id] ?? p.id} (max ${p.text.length} chars) ${c.state.edits[p.id] ?? p.text}`,
  );
  const answers = questionLines(c.state.questions).map((l, i) => {
    const q = c.state.questions[i];
    return `[answer:${q.fieldId}]${l.slice(q.fieldId.length + 2)} -> ${c.state.answers[q.fieldId] || "(empty)"}`;
  });
  const convo = [...c.history.slice(-CHAT_HISTORY_LIMIT), { role: "user", text: c.message }]
    .map((m) => `## ${m.role === "user" ? "User" : "You (coach)"}\n${m.text}`)
    .join("\n\n");
  return [
    "# Job description",
    orNone(c.jd),
    "# Current resume parts",
    parts.join("\n"),
    "# Cover letter",
    orNone(c.state.coverLetter),
    "# Form answers",
    answers.length ? answers.join("\n") : "(none)",
    "# Experience corpus",
    orNone(c.corpusYaml),
    "# Candidate profile",
    orNone(c.profileYaml),
    "# Conversation so far",
    convo,
  ].join("\n\n");
}

const FENCE = "```proposals";

// Splits a streamed reply into prose + the trailing proposals block. Last fence wins;
// a cut-off (unclosed) or non-array block is a parseError and never leaks into the prose.
export function splitReply(text: string): { reply: string; raw: unknown[] | null; parseError?: string } {
  const start = text.lastIndexOf(FENCE);
  if (start < 0) return { reply: text.trim(), raw: null };
  const bodyStart = start + FENCE.length;
  const end = text.indexOf("```", bodyStart);
  if (end < 0) {
    return { reply: text.slice(0, start).trim(), raw: null, parseError: "proposals block not closed" };
  }
  const reply = (text.slice(0, start) + text.slice(end + 3)).trim();
  try {
    const raw: unknown = JSON.parse(text.slice(bodyStart, end));
    if (!Array.isArray(raw)) return { reply, raw: null, parseError: "proposals block is not an array" };
    return { reply, raw };
  } catch (e) {
    return { reply, raw: null, parseError: (e as Error).message };
  }
}
