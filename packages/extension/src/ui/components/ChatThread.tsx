import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { RunView } from "../../../../../lib/shared/run-view";
import type { Chat, RunData } from "../lib/use-chat";
import { ProposalCard } from "./ProposalCard";

const FENCE = "```proposals";

// While streaming, the reply's proposals block is raw JSON: hide it (and a fence still arriving).
function streamedText(text: string) {
  const i = text.indexOf(FENCE);
  return i >= 0 ? { text: text.slice(0, i).trimEnd(), preparing: true } : { text: text.replace(/`{1,3}[a-z]*$/, ""), preparing: false };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function intro(view: RunView) {
  const worked = view.keywords.filter((k) => k.status === "injected").length;
  const did = [
    worked ? `worked in ${plural(worked, "keyword")}` : "",
    view.warnings.length ? `flagged ${plural(view.warnings.length, "thing")} you should be ready to talk about` : "",
  ].filter(Boolean);
  const head = `Tailored for ${view.company || "this job"}.`;
  return `${head}${did.length ? ` I ${did.join(" and ")}.` : ""} Ask about anything, or tell me what to change.`;
}

function suggestions(view: RunView) {
  const skipped = view.keywords.find((k) => k.status === "skipped");
  return [
    skipped ? `Why did you skip ${skipped.keyword}?` : "",
    "Make the summary punchier",
    view.answers.length ? "Check my form answers" : "",
  ].filter(Boolean);
}

function Claude({ children }: { children: ReactNode }) {
  return (
    <div className="text-text">
      <div className="mb-[3px] text-meta font-semibold text-text-3">Claude</div>
      {children}
    </div>
  );
}

function User({ text }: { text: string }) {
  return (
    <div className="self-end max-w-[86%] px-3 py-2 bg-surface-2 border border-border rounded-[10px_10px_3px_10px] whitespace-pre-wrap break-words">
      {text}
    </div>
  );
}

export function ChatThread({
  data,
  view,
  chat,
  onSend,
}: {
  data: RunData;
  view: RunView;
  chat: Chat;
  onSend: (text: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { streaming, cards, dismissed } = chat;

  // Bottom-most card still waiting for a decision: ⌘/Ctrl+Enter applies it.
  let latest = "";
  data.chat.forEach((m, mi) =>
    m.proposals?.forEach((_, pi) => {
      const k = `${mi}:${pi}`;
      if (!m.applied?.includes(pi) && !dismissed.includes(k) && !cards[k]?.error) latest = k;
    }),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || !latest || streaming) return;
      e.preventDefault();
      const [mi, pi] = latest.split(":").map(Number);
      void chat.apply(mi, pi);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Follow the newest content unless the user scrolled up; sending snaps back down.
  useLayoutEffect(() => {
    if (streaming && !streaming.text) stick.current = true;
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  });

  const live = streaming ? streamedText(streaming.text) : null;

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="flex-1 overflow-y-auto flex flex-col gap-3.5 px-4 pt-4 pb-2"
    >
      <Claude>{intro(view)}</Claude>
      {!data.chat.length && !streaming && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions(view).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSend(s)}
              className="px-3 py-[5px] text-small text-text-2 bg-surface border border-border rounded-full hover:border-border-strong hover:text-text"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {data.chat.map((m, mi) =>
        m.role === "user" ? (
          <User key={mi} text={m.text} />
        ) : (
          <div key={mi} className="contents">
            {m.text && (
              <Claude>
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
              </Claude>
            )}
            {m.proposals?.map((p, pi) => {
              const k = `${mi}:${pi}`;
              return (
                <ProposalCard
                  key={k}
                  p={p}
                  applied={!!m.applied?.includes(pi)}
                  ui={cards[k] ?? {}}
                  dismissed={dismissed.includes(k)}
                  latest={k === latest}
                  onApply={() => void chat.apply(mi, pi)}
                  onUndo={() => void chat.apply(mi, pi, true)}
                  onDismiss={(on) => chat.dismiss(k, on)}
                  onAsk={onSend}
                  onDownload={() => void chat.downloadResume()}
                />
              );
            })}
          </div>
        ),
      )}

      {streaming && live && (
        <>
          <User text={streaming.user} />
          <Claude>
            <div className="whitespace-pre-wrap break-words">
              {live.text}
              {!live.preparing && <span className="caret" aria-hidden="true" />}
            </div>
            {live.preparing && (
              <div aria-label="Preparing changes" className="mt-2.5 p-3 border border-border rounded-card">
                <div className="text-small text-text-3 mb-1">Preparing changes…</div>
                <div className="skeleton h-2.5 w-4/5 my-1.5" />
                <div className="skeleton h-2.5 w-3/5 my-1.5" />
              </div>
            )}
          </Claude>
        </>
      )}
    </div>
  );
}
