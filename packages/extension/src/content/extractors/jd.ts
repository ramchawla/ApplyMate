export interface ExtractedContent {
  jobDescription: string;
  jobTitle: string;
  company: string;
}

export function extractJDContent(html: string): ExtractedContent {
  // Most career pages (any ATS that wants Google Jobs indexing) embed a
  // schema.org JobPosting in JSON-LD — the highest-fidelity source on
  // boards we have no dedicated extractor for.
  const posting = extractJsonLdJobPosting(html);
  if (posting) return posting;

  return {
    jobDescription: extractTextContent(html),
    jobTitle: extractHeading(html) || extractMetaTitle(html),
    company: extractCompany(html) || extractMetaSiteName(html),
  };
}

export function extractJsonLdJobPosting(
  html: string,
): ExtractedContent | null {
  const scripts = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    const node = findJobPosting(safeParse(match[1]));
    if (!node) continue;

    const title = str(node.title);
    const org = node.hiringOrganization as
      | Record<string, unknown>
      | string
      | undefined;
    const company =
      typeof org === "string" ? org.trim() : str(org?.name ?? org?.legalName);
    const description = stripTags(str(node.description)).substring(0, 5000);

    if (title || company || description) {
      return { jobTitle: title, company, jobDescription: description };
    }
  }
  return null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

// JSON-LD may be a single node, an array, or wrapped in @graph.
function findJobPosting(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj["@type"] === "JobPosting") return obj;
    if (obj["@graph"]) return findJobPosting(obj["@graph"]);
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextContent(html: string): string {
  let text = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    " ",
  );
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.substring(0, 5000);
}

function extractHeading(html: string): string {
  const headingMatch = html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/i);
  return headingMatch ? headingMatch[1].trim() : "";
}

function extractMetaTitle(html: string): string {
  const og = html.match(
    /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  );
  if (og) return og[1].trim();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return title ? title[1].trim() : "Job Title (Not Found)";
}

function extractCompany(html: string): string {
  const companyMatch = html.match(/[Cc]ompany[\s:]*([^<\n]+)/);
  return companyMatch ? companyMatch[1].trim() : "";
}

function extractMetaSiteName(html: string): string {
  const og = html.match(
    /<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i,
  );
  return og ? og[1].trim() : "Company (Not Found)";
}
