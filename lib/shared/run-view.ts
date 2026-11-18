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
  // reverted: after = master and `attempted` is what tailoring tried.
  // reordered: the plain-text line to show ("Bullet 3 moved to the front.").
  changes: {
    id: string;
    label: string;
    before: string;
    after: string;
    reverted?: string;
    attempted?: string;
    reordered?: string;
  }[];
  warnings: string[];
  letter: string;
  answers: { label: string; value: string }[];
};

const ROLE = /^r\d+$/;
const items = (s: string) => s.split(",").map((x) => x.trim()).sort().join("\n");

export function buildRunView(report: RunFile, state: RunState, master: Record<string, string>): RunView {
  // Unknown ids and Claude's free-text `where` both show as "Resume", never a raw id.
  const label = (id: string) => report.labels[id] ?? "Resume";
  const bulletsOf = (role: string) => Object.keys(master).filter((id) => id.startsWith(`${role}.b`));
  const roleName = (role: string): string | undefined => {
    if (report.labels[role]) return report.labels[role];
    const b = Object.keys(report.labels).find((id) => id.startsWith(`${role}.b`));
    return b ? report.labels[b].replace(/ · bullet \d+$/, "") : undefined;
  };
  const { present, injected, skipped } = report.keywords;

  const keywords: RunView["keywords"] = [
    ...injected.map((k) => ({ keyword: k.keyword, status: "injected" as const, where: label(k.where) })),
    ...present.map((k) => ({ keyword: k.keyword, status: "present" as const, where: label(k.where) })),
    ...skipped.map((k) => ({ keyword: k.keyword, status: "skipped" as const, reason: k.reason })),
  ];

  // state.edits already holds the surviving tailoring edits plus chat applies.
  const tailored = new Map(report.edits.map((e) => [e.id, e]));
  const ids = [...new Set([...tailored.keys(), ...Object.keys(state.edits)])];
  const changes: RunView["changes"] = ids.flatMap((id) => {
    const before = master[id] ?? tailored.get(id)?.before ?? "";
    const after = state.edits[id];
    const t = tailored.get(id);
    if (after === undefined && t?.reverted)
      return [{ id, label: label(id), before, after: before, reverted: t.reverted, attempted: t.after }];
    if (after === undefined || after === before) return [];
    if (id.startsWith("skills.") && items(before) === items(after))
      return [{ id, label: label(id), before, after, reordered: "Nothing added or removed." }];
    return [{ id, label: label(id), before, after }];
  });

  for (const [role, order] of Object.entries(state.order)) {
    const was = bulletsOf(role);
    if (order.join() === was.join()) continue;
    const n = (id: string) => was.indexOf(id) + 1;
    const toFront = [order[0], ...was.filter((id) => id !== order[0])].join() === order.join();
    changes.push({
      id: role,
      label: `${roleName(role) ?? "Resume"} · bullet order`,
      before: "",
      after: "",
      reordered: toFront
        ? `Bullet ${n(order[0])} moved to the front.`
        : `New order: bullets ${order.map(n).join(", ")}.`,
    });
  }

  // Document order; a role's order change sits just before its bullets.
  const keys = Object.keys(master);
  const pos = (id: string) => {
    const i = keys.indexOf(ROLE.test(id) ? (bulletsOf(id)[0] ?? "") : id);
    return i < 0 ? keys.length : i - (ROLE.test(id) ? 0.5 : 0);
  };
  changes.sort((a, b) => pos(a.id) - pos(b.id));

  // Checks and run.ts embed ids in warnings ("r1.b2: dropped metric", "unknown role r3").
  const named = (w: string) => {
    const s = w.replace(/\b(r\d+(?:\.b\d+)?|summary|skills\.[\w-]+)\b/g, (id: string) =>
      ROLE.test(id) ? (roleName(id) ?? "a role") : (report.labels[id] ?? "a resume part"),
    );
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const covered = present.length + injected.length;
  return {
    title: report.job.title,
    company: report.job.company,
    version: state.version,
    pages: report.pages,
    coverage: { covered, total: covered + skipped.length },
    keywords,
    changes,
    warnings: report.warnings.map(named),
    letter: state.coverLetter,
    answers: state.questions.map((q) => ({ label: q.label, value: state.answers[q.fieldId] ?? "" })),
  };
}
