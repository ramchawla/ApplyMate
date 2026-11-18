import type { ReactNode } from "react";
import type { KeywordStatus, RunView } from "../../../lib/shared/run-view";
import { Diff } from "./BulletDiff";
import { Icon } from "./Icon";

// Read-only run report: same sections as the side panel, laid out per
// docs/superpowers/mockups/review-chat/dashboard.html.

export const box = "bg-surface border border-border rounded-card";
const tick: Record<KeywordStatus, string> = {
  injected: "bg-kw-injected",
  present: "bg-kw-present",
  skipped: "bg-kw-skipped",
};
const FIT_REASON = "reverted to keep the resume on one page";
const MORE_AFTER = 8;

export function Section({ title, n, children }: { title: string; n?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="flex items-baseline gap-2 mb-2.5 text-title font-semibold tracking-[-0.01em]">
        {title}
        {n !== undefined && <span className="text-small font-normal text-text-3">{n}</span>}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-3 text-small text-text-3">{children}</p>;

export function CoverageBar({ view }: { view: RunView }) {
  const { covered, total } = view.coverage;
  if (!total) return null;
  const count = (s: KeywordStatus) => view.keywords.filter((k) => k.status === s).length;
  return (
    <div className="flex flex-wrap items-center gap-4 pt-4 pb-1">
      <div className="text-title font-semibold whitespace-nowrap">
        {covered} of {total}
        <span className="ml-1 text-small font-normal text-text-3">job keywords</span>
      </div>
      <div className="flex-1 flex gap-[3px] h-2.5 max-w-[520px] min-w-[120px]" aria-hidden="true">
        {view.keywords.map((k, i) => (
          <i key={i} title={k.keyword} className={`flex-1 rounded-[2px] ${tick[k.status]}`} />
        ))}
      </div>
      <div className="flex gap-3.5 text-small text-text-3">
        {(
          [
            ["injected", "Worked in"],
            ["present", "Already there"],
            ["skipped", "Skipped"],
          ] as const
        ).map(([s, name]) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <i className={`inline-block w-2 h-2 rounded-[2px] ${tick[s]}`} />
            {name} {count(s)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Keyword({ k }: { k: RunView["keywords"][number] }) {
  return (
    <div className="py-[5px]">
      <b className="block font-medium">{k.keyword}</b>
      <span className="text-small text-text-3">{k.status === "skipped" ? k.reason : k.where}</span>
    </div>
  );
}

function Keywords({ view }: { view: RunView }) {
  const cols: [KeywordStatus, string][] = [
    ["injected", "Worked in"],
    ["present", "Already on your resume"],
    ["skipped", "Skipped"],
  ];
  return (
    <div className={`${box} grid min-[1000px]:grid-cols-3`}>
      {cols.map(([status, title]) => {
        const rows = view.keywords.filter((k) => k.status === status);
        return (
          <div
            key={status}
            className="px-4 py-3.5 border-b border-border last:border-b-0 min-[1000px]:border-b-0 min-[1000px]:border-r min-[1000px]:last:border-r-0"
          >
            <h3 className="flex items-center gap-1.5 mb-2.5 text-small font-semibold text-text-2">
              <i className={`inline-block w-2 h-2 rounded-[2px] ${tick[status]}`} />
              {title}
            </h3>
            {rows.length ? (
              rows.slice(0, MORE_AFTER).map((k, i) => <Keyword key={i} k={k} />)
            ) : (
              <span className="text-small text-text-3">None</span>
            )}
            {rows.length > MORE_AFTER && (
              <details>
                <summary className="py-[5px] text-small text-text-3 cursor-pointer">
                  and {rows.length - MORE_AFTER} more
                </summary>
                {rows.slice(MORE_AFTER).map((k, i) => (
                  <Keyword key={i} k={k} />
                ))}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Change({ c }: { c: RunView["changes"][number] }) {
  // Reverted: what tailoring tried, struck back to master. Reordered skills: plain text.
  const from = c.reverted ? (c.attempted ?? c.before) : c.reordered ? c.after : c.before;
  return (
    <div className="grid gap-1.5 min-[1000px]:grid-cols-[200px_1fr] min-[1000px]:gap-4 px-4 py-3.5 border-b border-border last:border-b-0">
      <div className="font-medium">
        {c.label}
        <br />
        <span
          className={`inline-block mt-1 px-2 py-0.5 rounded-chip text-meta font-medium ${
            c.reverted ? "bg-warn-bg text-warn" : "bg-surface-2 text-text-2"
          }`}
        >
          {c.reverted ? "Reverted" : c.reordered ? "Reordered" : "Rewritten"}
        </span>
      </div>
      <div className="max-w-[72ch] text-text-2 leading-[1.65] [&_b]:text-text [&_b]:font-semibold">
        {c.after && <Diff before={from} after={c.after} />}
        {c.reordered && <div className={c.after ? "mt-1.5 text-small text-text-3" : ""}>{c.reordered}</div>}
        {c.reverted && (
          <div className="mt-1.5 text-small text-text-3">
            Undone automatically: {c.reverted === FIT_REASON ? "it pushed the resume past one page" : c.reverted}.
          </div>
        )}
      </div>
    </div>
  );
}

export function RunReport({ view, submitted }: { view: RunView; submitted: boolean }) {
  return (
    <>
      <Section title="Keywords" n={`${view.keywords.length} from the job description`}>
        {view.keywords.length ? <Keywords view={view} /> : <div className={box}><Empty>No job keywords for this run.</Empty></div>}
      </Section>

      <Section
        title="Changes from your master resume"
        n={`${submitted ? "as submitted in" : "as of"} version ${view.version}`}
      >
        <div className={box}>
          {view.changes.length ? (
            view.changes.map((c) => <Change key={c.id} c={c} />)
          ) : (
            <Empty>No changes. Your master resume went out as is.</Empty>
          )}
        </div>
      </Section>

      <div className="grid gap-6 min-[1000px]:grid-cols-2">
        <Section title="Cover letter">
          <div className={box}>
            {view.letter ? (
              <div className="p-4 max-h-[300px] overflow-auto text-text-2 whitespace-pre-line leading-[1.65]">
                {view.letter}
              </div>
            ) : (
              <Empty>No cover letter for this run.</Empty>
            )}
          </div>
        </Section>
        <Section title="Answers" n={`${view.answers.length} question${view.answers.length === 1 ? "" : "s"}`}>
          <div className={box}>
            {view.answers.length ? (
              view.answers.map((a, i) => (
                <div key={i} className="px-4 py-3 border-b border-border last:border-b-0">
                  <div className="mb-[3px] text-small text-text-3">{a.label}</div>
                  {a.value ? (
                    <div className="whitespace-pre-line">{a.value}</div>
                  ) : (
                    <div className="italic text-text-3">Left blank.</div>
                  )}
                </div>
              ))
            ) : (
              <Empty>No custom questions on this form.</Empty>
            )}
          </div>
        </Section>
      </div>

      <Section title="Warnings" n={view.warnings.length}>
        <div className={box}>
          {view.warnings.length ? (
            view.warnings.map((w, i) => (
              <div key={i} className="flex gap-2.5 px-4 py-3 border-b border-border last:border-b-0">
                <Icon name="warn" className="mt-[3px] text-warn" />
                <div className="flex-1 min-w-0">{w}</div>
              </div>
            ))
          ) : (
            <Empty>No warnings.</Empty>
          )}
        </div>
      </Section>
    </>
  );
}
