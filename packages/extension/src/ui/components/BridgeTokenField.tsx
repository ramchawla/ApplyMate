import { useEffect, useState } from "react";
import { getBridgeToken, saveBridgeToken } from "../../utils/bridge";

export function BridgeTokenField() {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getBridgeToken().then(setToken);
  }, []);

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">Bridge Token</h3>
      <p className="text-xs text-gray-500">
        Printed when you run <code>pnpm bridge</code> (also in
        ~/.applymate/bridge-token). Required to load results.
      </p>
      <div className="flex gap-1">
        <input
          type="password"
          placeholder="paste bridge token"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setSaved(false);
          }}
          className="flex-1 border rounded px-2 py-1 text-xs"
        />
        <button
          onClick={async () => {
            await saveBridgeToken(token);
            setSaved(true);
          }}
          className="bg-gray-700 text-white px-2 rounded text-xs"
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}
