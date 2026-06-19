import { extractJDContent, ExtractedContent } from "./jd";

export type { ExtractedContent } from "./jd";

export function extractJD(html: string, _board: string): ExtractedContent {
  // Board-specific extractors can override; generic path used for all boards
  // in Phase 1. _board reserved for board-specific selectors in later phases.
  return extractJDContent(html);
}
