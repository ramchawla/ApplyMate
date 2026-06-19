export interface ExtractedContent {
  jobDescription: string;
  jobTitle: string;
  company: string;
}

export function extractJDContent(html: string): ExtractedContent {
  return {
    jobDescription: extractTextContent(html),
    jobTitle: extractHeading(html),
    company: extractCompany(html),
  };
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
  return headingMatch ? headingMatch[1].trim() : "Job Title (Not Found)";
}

function extractCompany(html: string): string {
  const companyMatch = html.match(/[Cc]ompany[\s:]*([^<\n]+)/);
  return companyMatch ? companyMatch[1].trim() : "Company (Not Found)";
}
