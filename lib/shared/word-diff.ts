export type DiffPart = { op: "same" | "add" | "del"; text: string };

// Word token = non-space run plus its trailing whitespace; leading whitespace is its own token.
const tokenize = (s: string): string[] => s.match(/\S+\s*|\s+/g) ?? [];
// Tokens match on the word itself; trailing whitespace alone never makes a word "changed".
const core = (t: string) => t.trimEnd();

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  // ponytail: O(n*m) LCS table, fine for resume text (<= ~600 chars); switch to Myers if inputs get long
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = core(a[i]) === core(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const parts: DiffPart[] = [];
  const push = (op: DiffPart["op"], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.op === op) last.text += text;
    else parts.push({ op, text });
  };
  // Buffer a changed run so every del lands before its add.
  let del = "";
  let add = "";
  const flush = () => {
    push("del", del);
    push("add", add);
    del = add = "";
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && core(a[i]) === core(b[j])) {
      flush();
      if (a[i] === b[j]) push("same", a[i]);
      else {
        // Same word, different trailing whitespace: keep the word, let the whitespace join the next changed run.
        const c = core(a[i]);
        push("same", c);
        del += a[i].slice(c.length);
        add += b[j].slice(c.length);
      }
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && dp[i + 1][j] >= dp[i][j + 1])) del += a[i++];
    else add += b[j++];
  }
  flush();
  return parts;
}
