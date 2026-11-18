import { useState, type ReactNode } from "react";
import type { KeywordStatus, RunView } from "../../../../../lib/shared/run-view";
import { Diff } from "./Diff";
import { Icon } from "./Icon";

type Tab = "keywords" | "changes" | "letter" | "answers" | "warnings";

const tick: Record<KeywordStatus, string> = {
  injected: "bg-kw-injected",
  present: "bg-kw-present",
  skipped: "bg-kw-skipped",
};

const FIT_REASON = "reverted to keep the resume on one page";

// Hover/focus-revealed; the parent row needs `group relative`.
function Ask({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute right-3 top-1.5 h-6 px-2 text-meta text-text-2 bg-surface border border-border-strong rounded-ctl opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-text"
    >
      Ask
    </button>
  );
}

function Group({ title, n }: { title: string; n: number }) {
  return (
    <div className="flex justify-between px-4 pt-2.5 pb-1 text-meta font-semibold text-text-3">
      <span>{title}</span>
      <span>{n}</span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-small text-text-3">{children}</p>;
}

function Keywords({ view, onAsk }: { view: RunView; onAsk: (text: string) => void }) {
  if (!view.keywords.length) return <Empty>No job keywords for this run.</Empty>;
  const groups: [KeywordStatus, string, "plus" | "circle" | "dot", string][] = [
    ["injected", "Worked in", "plus", "text-accent"],
    ["skipped", "Skipped", "circle", "text-text-3"],
    ["present", "Already on your resume", "dot", "text-kw-present"],
  ];
  return (
    <>
      {groups.map(([status, title, icon, color]) => {
        const rows = view.keywords.filter((k) => k.status === status);
        if (!rows.length) return null;
        return (
          <div key={status}>
            <Group title={title} n={rows.length} />
            {rows.map((k, i) => (
              <div key={i} className="group relative flex gap-2.5 items-start px-4 py-[7px] hover:bg-surface-2">
                <Icon name={icon} className={`mt-[3px] ${color}`} />
                <div className="flex-1 min-w-0 pr-10">
                  <div className="font-medium">{k.keyword}</div>
                  <div className="text-small text-text-3">
                    {k.status === "skipped" ? (
                      k.reason
                    ) : (
                      <>
                        in <span className="text-text-2">{k.where}</span>
                      </>
                    )}
                  </div>
                </div>
                <Ask
                  label={`Ask about ${k.keyword}`}
                  onClick={() =>
                    onAsk(k.status === "skipped" ? `Why did you skip ${k.keyword}?` : `Why ${k.keyword} in ${k.where}?`)
                  }
                />
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function Change({ c, onAsk }: { c: RunView["changes"][number]; onAsk: (text: string) => void }) {
  const [all, setAll] = useState(false);
  // Reverted: what tailoring tried, struck back to master. Reordered skills: plain text.
  const from = c.reverted ? (c.attempted ?? c.before) : c.reordered ? c.after : c.before;
  // ponytail: length heuristic for "Show all"; measure overflow if it misfires.
  const long = c.after.length + from.length > 480;
  return (
    <div className="group relative px-4 py-3 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 mb-1.5 pr-12">
        <span className="flex-1 font-medium">{c.label}</span>
        <span
          className={`text-meta font-medium px-2 py-0.5 rounded-chip ${
            c.reverted ? "bg-warn-bg text-warn" : "bg-surface-2 text-text-2"
          }`}
        >
          {c.reverted ? "Reverted" : c.reordered ? "Reordered" : "Rewritten"}
        </span>
      </div>
      {c.after && (
        <div className={`text-text-2 leading-[1.6] [&_b]:text-text [&_b]:font-semibold ${long && !all ? "line-clamp-4" : ""}`}>
          <Diff before={from} after={c.after} />
        </div>
      )}
      {long && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-small text-accent-text">
          {all ? "Show less" : "Show all"}
        </button>
      )}
      {c.reordered && (
        <div className={c.after ? "mt-1.5 text-small text-text-3" : "text-text-2"}>{c.reordered}</div>
      )}
      {c.reverted && (
        <div className="mt-1.5 text-small text-text-3">
          Undone automatically: {c.reverted === FIT_REASON ? "it pushed the resume past one page" : c.reverted}.
        </div>
      )}
      <Ask label={`Ask about ${c.label}`} onClick={() => onAsk(`About ${c.label}: `)} />
    </div>
  );
}

export function ReportPanel({
  view,
  letterPdf,
  onAsk,
}: {
  view: RunView;
  letterPdf: boolean;
  onAsk: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab | "">("keywords");
  const { covered, total } = view.coverage;
  const tabs: [Tab, string, number | null][] = [
    ["keywords", "Keywords", view.keywords.length],
    ["changes", "Changes", view.changes.length],
    ["letter", "Letter", null],
    ["answers", "Answers", view.answers.length],
    ["warnings", "Warnings", view.warnings.length || null],
  ];

  return (
    <>
      {total > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-small text-text-2">
              <b className="text-body font-semibold text-text">
                {covered} of {total}
              </b>{" "}
              job keywords on your resume
            </span>
            <span className="flex gap-2.5 text-meta text-text-3">
              {(["injected", "present", "skipped"] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <i className={`inline-block w-[7px] h-[7px] rounded-[2px] ${tick[s]}`} />
                  {{ injected: "Worked in", present: "Already there", skipped: "Skipped" }[s]}
                </span>
              ))}
            </span>
          </div>
          <div className="flex gap-0.5 h-2" aria-hidden="true">
            {view.keywords.map((k, i) => (
              <i
                key={i}
                title={k.keyword}
                className={`flex-1 rounded-[2px] transition-transform duration-150 ease-out hover:scale-y-[1.6] ${tick[k.status]}`}
              />
            ))}
          </div>
        </div>
      )}

      <div role="tablist" className="flex gap-0.5 px-2.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map(([id, name, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(tab === id ? "" : id)}
            className={`inline-flex items-center gap-[5px] h-8 px-2 text-small font-medium whitespace-nowrap border-b-2 hover:text-text ${
              tab === id ? "text-text border-accent" : "text-text-2 border-transparent"
            }`}
          >
            {name}
            {n !== null && (
              <span className={`text-meta font-medium ${id === "warnings" ? "text-warn" : "text-text-3"}`}>{n}</span>
            )}
          </button>
        ))}
      </div>

      {tab && (
        <div role="tabpanel" className="max-h-[268px] overflow-y-auto border-t border-border bg-surface">
          {tab === "keywords" && <Keywords view={view} onAsk={onAsk} />}

          {tab === "changes" &&
            (view.changes.length ? (
              view.changes.map((c) => <Change key={c.id} c={c} onAsk={onAsk} />)
            ) : (
              <Empty>No changes. Your master resume went out as is.</Empty>
            ))}

          {tab === "letter" &&
            (view.letter ? (
              <>
                <div className="flex items-center gap-1.5 px-4 py-2.5 text-small text-text-2 border-b border-border">
                  <Icon name="file" />
                  {letterPdf
                    ? "Attached to the form as a PDF."
                    : "Fills the cover-letter box on the page. No PDF needed for this form."}
                </div>
                <div className="px-4 py-3.5 text-text-2 whitespace-pre-line leading-[1.6]">{view.letter}</div>
              </>
            ) : (
              <Empty>No cover letter for this run.</Empty>
            ))}

          {tab === "answers" &&
            (view.answers.length ? (
              view.answers.map((a, i) => (
                <div key={i} className="px-4 py-3 border-b border-border last:border-b-0">
                  <div className="text-small text-text-3 mb-[3px]">{a.label}</div>
                  {a.value ? (
                    <>
                      <div className="text-text whitespace-pre-line">{a.value}</div>
                      <span className="inline-block mt-1.5 text-meta text-text-3">Drafted by Claude</span>
                    </>
                  ) : (
                    <div className="text-text-3 italic">
                      Left blank. Fill this in yourself or tell Claude what to put.
                    </div>
                  )}
                </div>
              ))
            ) : (
              <Empty>No custom questions on this form.</Empty>
            ))}

          {tab === "warnings" &&
            (view.warnings.length ? (
              view.warnings.map((w, i) => (
                <div key={i} className="flex gap-2.5 px-4 py-3 border-b border-border last:border-b-0">
                  <Icon name="warn" className="mt-[3px] text-warn" />
                  <div className="flex-1 min-w-0">{w}</div>
                </div>
              ))
            ) : (
              <Empty>No warnings.</Empty>
            ))}
        </div>
      )}
    </>
  );
}
