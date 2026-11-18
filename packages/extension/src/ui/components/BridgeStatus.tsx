import { useEffect, useState } from "react";
import { isBridgeUp } from "../../utils/bridge";

// Polls /health every 3s; null until the first answer.
export function useBridgeUp(): boolean | null {
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const ok = await isBridgeUp();
      if (active) setUp(ok);
    };
    void check();
    const id = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return up;
}

export function BridgeDot({ up, on, off }: { up: boolean | null; on: string; off: string }) {
  if (up === null) return null;
  const c = up ? "var(--ok)" : "var(--err)";
  return (
    <span className="inline-flex items-center gap-1.5 text-meta text-text-3">
      <span
        className="w-[7px] h-[7px] rounded-full"
        style={{ background: c, boxShadow: `0 0 0 3px color-mix(in srgb, ${c} 18%, transparent)` }}
      />
      {up ? on : off}
    </span>
  );
}
