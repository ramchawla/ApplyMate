export function textOf(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return "";
}

export function attrOf(
  doc: Document,
  selector: string,
  attr: string,
): string {
  return doc.querySelector(selector)?.getAttribute(attr)?.trim() ?? "";
}
