import type { ChatMessage } from "../../../lib/shared/types";
import { Diff } from "./BulletDiff";
import { Icon } from "./Icon";
import { box } from "./RunReport";

// Letters and answers diff as plain text; resume parts as rendered LaTeX (same rule as the panel).
const isResumeTarget = (target: string) => target !== "cover-letter" && !target.startsWith("answer:");

// Read-only. Dismissing is side-panel-only state, so a proposal is either in effect
// (`applied`, which chat keeps to the one proposal per target now applied) or not.
export function ChatTranscript({ chat }: { chat: ChatMessage[] }) {
  return (
    <div className={box}>
      <div className="flex flex-col gap-3 p-3.5 max-h-[560px] overflow-auto">
        {!chat.length && <p className="text-small text-text-3">No chat for this run.</p>}
        {chat.map((m, mi) => (
          <div key={mi} className="contents">
            {m.role === "user" ? (
              <div className="self-end max-w-[88%] px-3 py-2 bg-surface-2 border border-border rounded-[10px_10px_3px_10px] text-small whitespace-pre-line">
                {m.text}
              </div>
            ) : (
              m.text && (
                <div className="text-small text-text-2 whitespace-pre-line">
                  <div className="mb-0.5 text-meta font-semibold text-text-3">Claude</div>
                  {m.text}
                </div>
              )
            )}
            {m.proposals?.map((p, pi) => {
              const applied = m.applied?.includes(pi);
              return (
                <div key={pi} className="px-2.5 py-2 border border-border rounded-ctl text-small">
                  <div className="flex justify-between gap-2 mb-1">
                    <b className="font-semibold">{p.label}</b>
                    <span className={`text-meta font-medium whitespace-nowrap ${applied ? "text-ok" : "text-text-3"}`}>
                      {applied ? "Applied" : "Not applied"}
                    </span>
                  </div>
                  <div className="text-text-2 whitespace-pre-line leading-[1.65] [&_b]:text-text [&_b]:font-semibold">
                    <Diff before={p.before} after={p.after} plain={!isResumeTarget(p.target)} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-t border-border text-small text-text-3">
        <Icon name="lock" className="w-3 h-3" />
        Read-only. Continue the conversation in the side panel.
      </div>
    </div>
  );
}
