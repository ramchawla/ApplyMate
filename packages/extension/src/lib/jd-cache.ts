export interface PageJD {
  url: string;
  title: string;
  company: string;
  description: string;
}

export interface CachedJD extends PageJD {
  key: string;
  seenAt: number;
}

export type JDSource = "override" | "page" | "cached" | "recent" | "none";

export const RECENT_MS = 30 * 60_000;
const MIN_PAGE_JD = 200;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_ENTRIES = 100;
// Query params that identify the job (Greenhouse embeds: for=<board>&token=<job>).
const KEEP_QUERY = new Set(["gh_jid", "jobid", "jid", "id", "job", "jk", "currentjobid", "for", "token"]);

// Posting and application pages of the same job share a key: Lever/Ashby
// apply pages drop the JD, so the form page looks up the posting's JD by key.
export function jobKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/(apply|application)(\/.*)?$/i, "").replace(/\/+$/, "");
    const query = [...u.searchParams]
      .filter(([k]) => KEEP_QUERY.has(k.toLowerCase()))
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
    return `${u.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return url;
  }
}

export function rememberJD(
  cache: Record<string, CachedJD>,
  jd: PageJD,
  now: number,
): Record<string, CachedJD> {
  const key = jobKey(jd.url);
  const next = { ...cache, [key]: { ...jd, key, seenAt: now } };
  const kept = Object.values(next)
    .filter((c) => now - c.seenAt < MAX_AGE_MS)
    .sort((a, b) => b.seenAt - a.seenAt)
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept.map((c) => [c.key, c]));
}

export function pickJD(
  page: PageJD,
  store: { cache: Record<string, CachedJD>; overrides: Record<string, string> },
  now: number,
  ignoreRecent = false,
  tabKey?: string, // top-level page's key: an iframe form inherits its tab's pasted JD
): { jd: PageJD; source: JDSource } {
  const key = jobKey(page.url);
  const merge = (from: PageJD): PageJD => ({
    url: page.url,
    title: page.title || from.title,
    company: page.company || from.company,
    description: from.description,
  });

  const override = store.overrides[key] ?? (tabKey ? store.overrides[tabKey] : undefined);
  if (override) return { jd: { ...page, description: override }, source: "override" };
  if (page.description.length >= MIN_PAGE_JD) return { jd: page, source: "page" };
  const cached = store.cache[key];
  if (cached) return { jd: merge(cached), source: "cached" };
  if (!ignoreRecent) {
    const recent = Object.values(store.cache)
      .filter((c) => now - c.seenAt < RECENT_MS)
      .sort((a, b) => b.seenAt - a.seenAt)[0];
    if (recent) return { jd: merge(recent), source: "recent" };
  }
  return { jd: { ...page, description: "" }, source: "none" };
}
