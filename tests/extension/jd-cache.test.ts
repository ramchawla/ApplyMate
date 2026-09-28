import { describe, it, expect } from "vitest";
import {
  jobKey,
  pickJD,
  rememberJD,
  RECENT_MS,
} from "../../packages/extension/src/lib/jd-cache";

const longJD = "x".repeat(250);

describe("jobKey", () => {
  it.each([
    ["https://jobs.lever.co/acme/123/apply", "jobs.lever.co/acme/123"],
    ["https://jobs.ashbyhq.com/acme/abc/application?utm=x", "jobs.ashbyhq.com/acme/abc"],
    ["https://acme.com/careers?gh_jid=42&utm_source=li", "acme.com/careers?gh_jid=42"],
    ["https://Job-Boards.greenhouse.io/acme/jobs/9/", "job-boards.greenhouse.io/acme/jobs/9"],
    ["not a url", "not a url"],
  ])("%s → %s", (url, key) => expect(jobKey(url)).toBe(key));
});

describe("pickJD", () => {
  const now = 1_000_000_000;
  const cached = rememberJD(
    {},
    { url: "https://jobs.lever.co/acme/123", title: "SRE", company: "Acme", description: longJD },
    now - 1000,
  );
  const empty = { url: "https://jobs.lever.co/acme/123/apply", title: "", company: "", description: "" };

  it("prefers a user override", () => {
    const r = pickJD(empty, { cache: cached, overrides: { "jobs.lever.co/acme/123": "pasted" } }, now);
    expect(r).toMatchObject({ source: "override", jd: { description: "pasted" } });
  });
  it("uses the page JD when long enough", () => {
    expect(pickJD({ ...empty, description: longJD }, { cache: {}, overrides: {} }, now).source).toBe(
      "page",
    );
  });
  it("uses the posting cached under the same job key", () => {
    expect(pickJD(empty, { cache: cached, overrides: {} }, now)).toMatchObject({
      source: "cached",
      jd: { title: "SRE", company: "Acme", description: longJD },
    });
  });
  it("falls back to the most recent JD within 30 minutes", () => {
    const other = { ...empty, url: "https://boards.greenhouse.io/embed/job_app?for=acme" };
    expect(pickJD(other, { cache: cached, overrides: {} }, now).source).toBe("recent");
    expect(pickJD(other, { cache: cached, overrides: {} }, now, true).source).toBe("none");
    expect(pickJD(other, { cache: cached, overrides: {} }, now + RECENT_MS).source).toBe("none");
  });
});

describe("rememberJD", () => {
  it("prunes to the newest 100 and drops week-old entries", () => {
    let cache = rememberJD({}, { url: "https://old.com/1", title: "", company: "", description: "d" }, 0);
    for (let i = 0; i < 105; i++) {
      cache = rememberJD(
        cache,
        { url: `https://x.com/${i}`, title: "", company: "", description: "d" },
        8 * 86_400_000 + i,
      );
    }
    expect(Object.keys(cache)).toHaveLength(100);
    expect(cache["old.com/1"]).toBeUndefined();
    expect(cache["x.com/104"]).toBeDefined();
  });
});
