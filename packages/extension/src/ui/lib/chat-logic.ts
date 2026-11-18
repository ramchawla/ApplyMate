// Pure bits of the chat panel (tested in tests/extension/chat-logic.test.ts).

const FENCE = "```proposals";

// While streaming, the reply's proposals block is raw JSON: hide it (and a fence still arriving).
export function streamedText(text: string) {
  const i = text.indexOf(FENCE);
  return i >= 0
    ? { text: text.slice(0, i).trimEnd(), preparing: true }
    : { text: text.replace(/`{1,3}[a-z]*$/, ""), preparing: false };
}

// Apply refusals that are about length (bridge: "N lines too long", "spills onto page 2").
export const FIT = /too long|doesn't fit|one page|page 2/i;

// ⌘/Ctrl+Enter applies a card only from the composer or outside text fields.
export function isOtherField(target: EventTarget | null, composerId: string): boolean {
  if (!(target instanceof Element) || target.id === composerId) return false;
  return target.matches("input, textarea, select") || !!target.closest('[contenteditable]:not([contenteditable="false"])');
}

// Every `every` ms until `check` passes, the cap runs out, or `alive` turns false.
// ponytail: the cap counts sleeps, not wall time; slow fetches stretch it a little.
export async function pollUntil(
  check: () => Promise<boolean>,
  alive: () => boolean,
  every = 2000,
  cap = 180_000,
): Promise<"done" | "timeout" | "cancelled"> {
  for (let t = 0; t < cap; t += every) {
    await new Promise((r) => setTimeout(r, every));
    if (!alive()) return "cancelled";
    try {
      if (await check()) return "done";
    } catch {
      // bridge blip: try again next tick
    }
  }
  return "timeout";
}
