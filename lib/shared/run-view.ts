// What a run's review shows (side panel now, dashboard later), from report.json +
// state.json + the run's master text. Strings stay as stored (LaTeX); renderers convert.
import type { RunFile, RunState } from "./types";

export type KeywordStatus = "present" | "injected" | "skipped";

export type RunView = {
  title: string;
  company: string;
  version: number;
  pages: number;
  coverage: { covered: number; total: number };
  keywords: { keyword: string; status: KeywordStatus; where?: string /*label*/; reason?: string }[];
  changes: { id: string; label: string; before: string; after: string; reverted?: string }[];
  warnings: string[];
  letter: string;
  answers: { label: string; value: string }[];
};

export function buildRunView(report: RunFile, state: RunState, master: Record<string, string>): RunView {
  // Unknown ids and Claude's free-text `where` both show as "Resume", never a raw id.
  const label = (id: string) => report.labels[id] ?? "Resume";
  const { present, injected, skipped } = report.keywords;

  const keywords: RunView["keywords"] = [
    ...injected.map((k) => ({ keyword: k.keyword, status: "injected" as const, where: label(k.where) })),
    ...present.map((k) => ({ keyword: k.keyword, status: "present" as const, where: label(k.where) })),
    ...skipped.map((k) => ({ keyword: k.keyword, status: "skipped" as const, reason: k.reason })),
  ];

  // state.edits already holds the surviving tailoring edits plus chat applies.
  const tailored = new Map(report.edits.map((e) => [e.id, e]));
  const ids = [...new Set([...tailored.keys(), ...Object.keys(state.edits)])];
  const changes = ids.flatMap((id) => {
    const before = master[id] ?? tailored.get(id)?.before ?? "";
    const after = state.edits[id];
    const reverted = tailored.get(id)?.reverted;
    if (after === undefined && reverted) return [{ id, label: label(id), before, after: before, reverted }];
    if (after === undefined || after === before) return [];
    return [{ id, label: label(id), before, after }];
  });

  const covered = present.length + injected.length;
  return {
    title: report.job.title,
    company: report.job.company,
    version: state.version,
    pages: report.pages,
    coverage: { covered, total: covered + skipped.length },
    keywords,
    changes,
    // Checks prefix warnings with the part id ("r1.b2: dropped metric 40%").
    warnings: report.warnings.map((w) =>
      w.replace(/^(summary|r\d+\.b\d+|skills\.[\w-]+): /, (_, id: string) => `${label(id)}: `),
    ),
    letter: state.coverLetter,
    answers: state.questions.map((q) => ({ label: q.label, value: state.answers[q.fieldId] ?? "" })),
  };
}
