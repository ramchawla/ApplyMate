// Addressable view of the master resume: only the parts Claude may edit
// (summary, bullets, skills lines), with exact offsets so edits splice back
// into the untouched source. Preamble, header, headings, companies, titles,
// dates and education are never exposed, so they can't change.

export interface ResumePart {
  id: string;
  kind: "summary" | "bullet" | "skills";
  start: number;
  end: number;
  text: string;
}

export interface ResumeGroup {
  id: string;
  heading: string;
  bulletIds: string[];
}

export interface ResumeDoc {
  tex: string;
  parts: ResumePart[];
  groups: ResumeGroup[];
}

// Index of the "}" matching the "{" at openIdx. A backslash escapes the next
// char, so \{ \} \% never count.
export function matchBrace(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error(`Unbalanced brace at offset ${openIdx}`);
}

function isCommented(s: string, idx: number): boolean {
  const lineStart = s.lastIndexOf("\n", idx - 1) + 1;
  return /(^|[^\\])%/.test(s.slice(lineStart, idx));
}

interface Section {
  name: string;
  start: number;
  end: number;
}

function sections(tex: string): Section[] {
  const found = [...tex.matchAll(/\\section\{([^}]*)\}/g)].filter(
    (m) => !isCommented(tex, m.index!),
  );
  const docEnd = tex.indexOf("\\end{document}");
  return found.map((m, i) => ({
    name: m[1],
    start: m.index!,
    end:
      i + 1 < found.length
        ? found[i + 1].index!
        : docEnd === -1
          ? tex.length
          : docEnd,
  }));
}

function readableHeading(src: string): string {
  return src
    .replace(/%.*$/gm, "")
    .replace(/\\(resumeSubHeadingListStart|resumeSubHeadingListEnd|vspace\{[^}]*\})/g, " ")
    .replace(/\}\s*\{/g, " | ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}$]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function parseResume(tex: string): ResumeDoc {
  const parts: ResumePart[] = [];
  const groups: ResumeGroup[] = [];
  const push = (id: string, kind: ResumePart["kind"], start: number, end: number) =>
    parts.push({ id, kind, start, end, text: tex.slice(start, end) });

  let lastTop = "";
  for (const sec of sections(tex)) {
    const name = sec.name.toLowerCase();

    if (/summary|profile|objective/.test(name)) {
      const k = tex.indexOf("\\small{", sec.start);
      if (k !== -1 && k < sec.end) {
        const open = k + "\\small".length;
        push("summary", "summary", open + 1, matchBrace(tex, open));
      }
      continue;
    }

    if (/skill/.test(name)) {
      const body = tex.slice(sec.start, sec.end);
      for (const m of body.matchAll(/\\textbf\{([^{}]+)\}\{/g)) {
        const open = sec.start + m.index! + m[0].length - 1;
        if (isCommented(tex, open)) continue;
        const close = matchBrace(tex, open);
        const lead = tex.slice(open + 1, close).match(/^:\s*/)?.[0].length ?? 0;
        push(`skills.${slug(m[1])}`, "skills", open + 1 + lead, close);
      }
      continue;
    }

    if (/education/.test(name)) continue;

    let cursor = sec.start + `\\section{${sec.name}}`.length;
    const listRe = /\\resumeItemListStart/g;
    listRe.lastIndex = cursor;
    let m: RegExpExecArray | null;
    while ((m = listRe.exec(tex)) && m.index < sec.end) {
      if (isCommented(tex, m.index)) continue;
      const listEnd = tex.indexOf("\\resumeItemListEnd", m.index);
      if (listEnd === -1 || listEnd > sec.end) break;

      const headSrc = tex.slice(cursor, m.index);
      let heading = readableHeading(headSrc);
      if (/\\resume(OrgHeading|Subheading|ProjectHeading)\b/.test(headSrc)) {
        lastTop = heading;
      } else if (lastTop) {
        heading = `${lastTop.split(" | ")[0]} — ${heading}`;
      }

      const group: ResumeGroup = { id: `r${groups.length}`, heading, bulletIds: [] };
      const itemRe = /\\resumeItem\{/g;
      itemRe.lastIndex = m.index;
      let it: RegExpExecArray | null;
      while ((it = itemRe.exec(tex)) && it.index < listEnd) {
        if (isCommented(tex, it.index)) continue;
        const open = it.index + it[0].length - 1;
        const close = matchBrace(tex, open);
        const id = `${group.id}.b${group.bulletIds.length}`;
        push(id, "bullet", open + 1, close);
        group.bulletIds.push(id);
        itemRe.lastIndex = close;
      }
      if (group.bulletIds.length > 0) groups.push(group);

      cursor = listEnd + "\\resumeItemListEnd".length;
      listRe.lastIndex = cursor;
    }
  }

  return { tex, parts, groups };
}

export function isPermutation(a: string[], b: string[]): boolean {
  return (
    a.length === b.length &&
    new Set(a).size === a.length &&
    [...a].sort().join("\n") === [...b].sort().join("\n")
  );
}

export function renderResume(
  doc: ResumeDoc,
  edits: Record<string, string> = {},
  order: Record<string, string[]> = {},
): string {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const content = (id: string) => edits[id] ?? byId.get(id)!.text;

  const replacement = new Map<string, string>();
  for (const p of doc.parts) replacement.set(p.id, content(p.id));
  for (const g of doc.groups) {
    const ids = order[g.id];
    if (!ids || !isPermutation(ids, g.bulletIds)) continue;
    g.bulletIds.forEach((slot, i) => replacement.set(slot, content(ids[i])));
  }

  let out = doc.tex;
  for (const p of [...doc.parts].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, p.start) + replacement.get(p.id)! + out.slice(p.end);
  }
  return out;
}

// Human-readable name per part id, so UI never shows raw ids (r1.b2).
export function partLabels(doc: ResumeDoc): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const g of doc.groups) {
    const name = g.heading.split(" | ")[0];
    g.bulletIds.forEach((id, i) => (labels[id] = `${name} · bullet ${i + 1}`));
  }
  for (const p of doc.parts) {
    if (p.kind === "summary") labels[p.id] = "Summary";
    else if (p.kind === "skills") {
      const name = doc.tex.slice(0, p.start).match(/\\textbf\{([^{}]+)\}\{[:\s]*$/)?.[1];
      labels[p.id] = `Skills · ${name ?? p.id.replace("skills.", "")}`;
    }
  }
  return labels;
}
