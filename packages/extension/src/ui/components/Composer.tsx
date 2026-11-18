import { useEffect, useLayoutEffect, useRef } from "react";
import { Icon } from "./Icon";

export const COMPOSER_ID = "composer";

// Enter sends, Shift+Enter is a newline, Esc stops a streaming reply.
// ⌘/Ctrl+Enter is left to bubble: it applies the latest card.
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  error,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  error: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  // The textarea is disabled while streaming, so Esc is caught on the window.
  useEffect(() => {
    if (!streaming) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onStop();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streaming, onStop]);

  // Back to the box once a reply ends (or was stopped and the text restored).
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !streaming) ref.current?.focus();
    was.current = streaming;
  }, [streaming]);

  return (
    <div className="flex-none px-3 pt-2.5 pb-3 border-t border-border">
      <div className="flex items-end gap-2 pl-3 pr-2 py-2 bg-surface border border-border-strong rounded-card focus-within:border-accent focus-within:[box-shadow:var(--focus)]">
        <textarea
          id={COMPOSER_ID}
          ref={ref}
          rows={1}
          value={value}
          disabled={streaming}
          aria-label="Message Claude"
          placeholder={streaming ? "Claude is replying…" : "Ask about this application or suggest a change"}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            onSend();
          }}
          className="flex-1 min-h-[22px] max-h-[120px] py-0.5 resize-none bg-transparent text-text border-0 outline-none placeholder:text-text-3 focus-visible:shadow-none disabled:cursor-not-allowed"
        />
        {streaming ? (
          <button
            type="button"
            aria-label="Stop reply"
            onClick={onStop}
            className="flex-none grid place-items-center w-7 h-7 rounded-ctl bg-surface-2 text-text border border-border-strong"
          >
            <Icon name="stop" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            onClick={onSend}
            disabled={!value.trim()}
            className="flex-none grid place-items-center w-7 h-7 rounded-ctl bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="up" />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-small text-err">
          {error}
        </p>
      )}
      <div className="flex justify-between gap-2 mt-1.5 text-meta text-text-3">
        {streaming ? (
          <>
            <span>
              <kbd>Esc</kbd> stop
            </span>
            <span>First words in a few seconds</span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <kbd>↵</kbd> send <kbd>⇧</kbd>
              <kbd>↵</kbd> new line
            </span>
            <span>Changes only apply when you click Apply</span>
          </>
        )}
      </div>
    </div>
  );
}
