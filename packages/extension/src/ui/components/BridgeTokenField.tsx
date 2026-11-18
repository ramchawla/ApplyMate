import { useEffect, useState } from "react";
import { getBridgeToken, saveBridgeToken } from "../../utils/bridge";

export function BridgeTokenField() {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getBridgeToken().then(setToken);
  }, []);

  return (
    <div className="grid gap-1">
      <span className="text-small text-text-2">Bridge token</span>
      <p className="text-meta text-text-3">
        Pairing is automatic. Only paste the token (~/.applymate/bridge-token) if
        auto-pairing fails.
      </p>
      <div className="flex gap-1.5">
        <input
          type="password"
          placeholder="paste bridge token"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setSaved(false);
          }}
          className="flex-1 min-w-0 h-7 px-2 text-small bg-surface text-text border border-border-strong rounded-ctl"
        />
        <button
          onClick={async () => {
            await saveBridgeToken(token);
            setSaved(true);
          }}
          className="h-7 px-2.5 text-small font-medium bg-surface text-text border border-border-strong rounded-ctl hover:bg-surface-2"
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}
