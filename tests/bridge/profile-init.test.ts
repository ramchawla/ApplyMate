import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildProfile } from "../../packages/bridge/src/profile-init";
import { plistXml } from "../../packages/bridge/src/install-launchd";

const tex = readFileSync(
  fileURLToPath(new URL("../skill/fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const corpus = `profile:
  name: Jane Q Dev
  current_title: Senior Software Engineer
  org: Acme Corp — Platform
  email: jane@example.com
`;

describe("buildProfile", () => {
  const p = buildProfile(corpus, tex) as Record<string, any>;
  it("splits the name and copies contact info", () => {
    expect(p.name).toEqual({ first: "Jane", last: "Q Dev", preferred: "Jane" });
    expect(p.email).toBe("jane@example.com");
  });
  it("pulls links from the resume header", () => {
    expect(p.links.github).toBe("https://github.com/janedev");
    expect(p.links.portfolio).toBe("https://example.com");
  });
  it("fills current role and education", () => {
    expect(p.current).toEqual({ company: "Acme Corp", title: "Senior Software Engineer" });
    expect(p.education.school).toBe("State University");
    expect(p.education.start).toBe("2014");
    expect(p.education.end).toBe("2018");
    expect(p.education.major).toBe("Computer Science");
  });
  it("defaults EEO answers to decline and seeds answer rules", () => {
    expect(p.eeo.gender).toBe("Decline to self-identify");
    expect(p.answers[0].match).toMatch(/hear/);
  });
});

describe("plistXml", () => {
  it("runs the bridge with node + tsx and a usable PATH, escaping XML", () => {
    const x = plistXml({
      node: "/usr/bin/node",
      bridgeDir: "/a&b/bridge",
      home: "/Users/me",
      path: "/opt/homebrew/bin:/usr/bin",
    });
    expect(x).toContain("<string>com.applymate.bridge</string>");
    expect(x).toContain("<string>/a&amp;b/bridge</string>");
    expect(x).toContain("<string>--import</string>");
    expect(x).toContain("<string>/opt/homebrew/bin:/usr/bin</string>");
    expect(x).toContain("<key>KeepAlive</key><true/>");
  });
});
