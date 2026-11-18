import type { ReactNode } from "react";
import type { Proposal } from "../../../../../lib/shared/types";
import type { CardUi } from "../lib/use-chat";
import { isResumeTarget } from "../lib/page-sync";
import { FIT } from "../lib/chat-logic";
import { Diff } from "./Diff";
import { Icon } from "./Icon";


const btn = "inline-flex items-center gap-1.5 h-7 px-2.5 text-small font-medium rounded-ctl border disabled:opacity-50 disabled:cursor-not-allowed";
const primary = `${btn} bg-accent border-accent text-accent-fg hover:bg-accent-hover hover:border-accent-hover`;
const plain = `${btn} bg-surface border-border-strong text-text hover:bg-surface-2`;
const ghost = `${btn} bg-transparent border-transparent text-text-2 hover:bg-surface-2 hover:text-text`;

function Flag({ kind, icon, children }: { kind: "warn" | "err" | "info"; icon: "warn" | "back"; children: ReactNode }) {
  const tone = { warn: "bg-warn-bg text-warn", err: "bg-err-bg text-err", info: "bg-accent-soft text-accent-text" }[kind];
  return (
    <div role={kind === "err" ? "alert" : undefined} className={`flex gap-2 items-start mx-3 mt-2.5 px-2.5 py-2 rounded-ctl text-small ${tone}`}>
      <Icon name={icon} className="mt-0.5" />
      <p className="m-0 text-text [&_b]:font-semibold">{children}</p>
    </div>
  );
}

export function ProposalCard({
  p,
  applied,
  ui,
  dismissed,
  latest,
  onApply,
  onUndo,
  onDismiss,
  onAsk,
  onDownload,
}: {
  p: Proposal;
  applied: boolean;
  ui: CardUi;
  dismissed: boolean;
  latest: boolean; // the card ⌘↵ applies
  onApply: () => void;
  onUndo: () => void;
  onDismiss: (on: boolean) => void;
  onAsk: (text: string) => void;
  onDownload: () => void;
}) {
  if (dismissed && !applied) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-small text-text-3 border border-border rounded-card">
        <span className="flex-1 min-w-0 truncate">Dismissed · {p.label}</span>
        <button type="button" onClick={() => onDismiss(false)} className="text-meta text-accent-text hover:underline">
          Restore
        </button>
      </div>
    );
  }

  const refused = !applied && !!ui.error && FIT.test(ui.error);
  const resume = isResumeTarget(p.target);
  const reason = ui.error ? (ui.error[0].toUpperCase() + ui.error.slice(1)).replace(/\.$/, "") : "";
  const state = applied ? (
    <span className="inline-flex items-center gap-1 text-meta font-medium text-ok">
      <Icon name="check" className="w-3 h-3" />
      Applied
    </span>
  ) : refused ? (
    <span className="inline-flex items-center gap-1 text-meta font-medium text-err">
      <Icon name="x" className="w-3 h-3" />
      Doesn't fit
    </span>
  ) : (
    <span className="text-meta font-medium text-text-3">Not applied</span>
  );

  return (
    <div
      className={`border rounded-card bg-surface shadow-1 overflow-hidden ${
        applied ? "border-[color-mix(in_srgb,var(--ok)_45%,var(--border))]" : "border-border-strong"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-[9px] border-b border-border bg-surface-2">
        <span className="flex-1 min-w-0 truncate text-small font-semibold">{p.label}</span>
        {state}
      </div>
      <div className={`px-3 py-2.5 ${refused ? "opacity-[.72]" : ""}`}>
        <div className="max-h-60 overflow-y-auto whitespace-pre-line leading-[1.6] text-text-2 [&_b]:text-text [&_b]:font-semibold">
          <Diff before={p.before} after={p.after} plain={!resume} />
        </div>
        {p.why && <div className="mt-2 text-small text-text-3">{p.why}</div>}
      </div>

      {p.warnings.map((w, i) => (
        <Flag key={i} kind="warn" icon="warn">
          {w}
        </Flag>
      ))}
      {reason &&
        (refused ? (
          <Flag kind="err" icon="warn">
            <b>{reason}.</b> Your resume would go over one page, so nothing was changed.
          </Flag>
        ) : (
          <Flag kind="err" icon="warn">
            {reason}.
          </Flag>
        ))}
      {ui.sync === "not-found" &&
        (resume ? (
          <Flag kind="info" icon="back">
            Resume step isn't on screen. Go back to it and press ↻ Re-attach, or{" "}
            <button type="button" onClick={onDownload} className="font-medium text-accent-text underline">
              Download PDF
            </button>
          </Flag>
        ) : p.target === "cover-letter" ? (
          <Flag kind="info" icon="back">
            The cover letter isn't on this step. Go back to it and the new letter fills in.
          </Flag>
        ) : (
          <Flag kind="info" icon="back">
            That question is on an earlier step. Go back to it and the new answer fills in.
          </Flag>
        ))}

      <div className="flex items-center gap-1.5 px-3 py-2.5">
        {applied ? (
          <>
            <span className="flex-1 text-small text-text-2">
              {resume && ui.sync === "ok" && ui.version !== undefined ? `Version ${ui.version + 1} attached to the form` : ""}
            </span>
            <button type="button" onClick={onUndo} disabled={!!ui.busy} className={ghost}>
              <Icon name="undo" />
              {ui.busy === "undo" ? "Undoing…" : "Undo"}
            </button>
          </>
        ) : (
          <>
            {refused ? (
              <button
                type="button"
                onClick={() => onAsk(`Make the ${p.label} change shorter so it fits on one page.`)}
                className={plain}
              >
                Ask for shorter
              </button>
            ) : (
              <button type="button" onClick={onApply} disabled={!!ui.busy} className={primary}>
                <Icon name="check" />
                {ui.busy === "apply" ? "Applying…" : "Apply"}
              </button>
            )}
            <button type="button" onClick={() => onDismiss(true)} disabled={!!ui.busy} className={ghost}>
              Dismiss
            </button>
            <span className="flex-1" />
            {latest && !refused && (
              <span className="text-meta text-text-3">
                <kbd>⌘</kbd>
                <kbd>↵</kbd> apply
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
