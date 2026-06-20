import { useEffect, useState } from "react";
import { isBridgeUp } from "../../utils/bridge";

export function BridgeStatus() {
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

  if (up === null) return null;

  return (
    <div
      className={`text-xs px-2 py-1 rounded ${
        up ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
      }`}
    >
      {up ? "● Bridge connected" : "● Bridge offline — run `pnpm bridge`"}
    </div>
  );
}
