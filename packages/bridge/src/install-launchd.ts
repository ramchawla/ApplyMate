import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "com.applymate.bridge";
const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// launchd starts agents with a bare PATH (/usr/bin:/bin:…) — the bridge needs
// the caller's PATH to find `claude` and `tectonic` in /opt/homebrew/bin.
export function plistXml(o: {
  node: string;
  bridgeDir: string;
  home: string;
  path: string;
}): string {
  const str = (v: string) => `<string>${xml(v)}</string>`;
  const log = `${o.home}/.applymate/bridge.log`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${str(LABEL)}
<key>ProgramArguments</key><array>${[o.node, "--import", "tsx", "src/start.ts"].map(str).join("")}</array>
<key>WorkingDirectory</key>${str(o.bridgeDir)}
<key>EnvironmentVariables</key><dict><key>PATH</key>${str(o.path)}<key>HOME</key>${str(o.home)}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key>${str(log)}
<key>StandardErrorPath</key>${str(log)}
</dict></plist>
`;
}

if (process.argv[1]?.endsWith("install-launchd.ts")) {
  const home = homedir();
  const plistPath = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const bridgeDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(join(home, ".applymate"), { recursive: true });
  writeFileSync(
    plistPath,
    plistXml({
      node: process.execPath,
      bridgeDir,
      home,
      path: process.env.PATH ?? "/usr/bin:/bin",
    }),
  );
  const domain = `gui/${userInfo().uid}`;
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" });
  } catch {
    /* not loaded yet */
  }
  execFileSync("launchctl", ["bootstrap", domain, plistPath]);
  console.log(
    `Installed ${plistPath}; bridge starts at login and restarts on crash. Logs: ~/.applymate/bridge.log`,
  );
}
