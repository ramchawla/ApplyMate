import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class TectonicMissingError extends Error {
  constructor() {
    super("tectonic not found. Install it: brew install tectonic");
    this.name = "TectonicMissingError";
  }
}

export interface CompileResult {
  pdf: Buffer;
  pages: number;
  // Natural (unshrunk) height of the last page's content and the page goal,
  // in pt. height > goal means TeX squeezed the glue to make it fit — past
  // the master's own squeeze, headings start colliding with bullets.
  height: number;
  goal: number;
}

// FontAwesome 5 codepoints for icons resume headers commonly use.
const FA_SOLID: Record<string, string> = {
  faEnvelope: "F0E0",
  faLink: "F0C1",
  faPhone: "F095",
  faMobile: "F3CD",
  faGlobe: "F0AC",
  faMapMarker: "F3C5",
};
const FA_BRANDS: Record<string, string> = {
  faLinkedin: "F08C",
  faLinkedinIn: "F0E1",
  faGithub: "F09B",
  faTwitter: "F099",
};

const FA_SHIM = [
  "\\usepackage{fontspec}",
  "\\newfontfamily\\AMfaSolid{FontAwesome5Free-Solid-900.otf}",
  "\\newfontfamily\\AMfaBrands{FontAwesome5Brands-Regular-400.otf}",
  ...Object.entries(FA_SOLID).map(
    ([name, cp]) => `\\providecommand{\\${name}}{{\\AMfaSolid\\symbol{"${cp}}}}`,
  ),
  ...Object.entries(FA_BRANDS).map(
    ([name, cp]) => `\\providecommand{\\${name}}{{\\AMfaBrands\\symbol{"${cp}}}}`,
  ),
].join("\n");

// Tectonic runs XeTeX. Resumes written for pdfLaTeX (Overleaf) use
// glyphtounicode/\pdfgentounicode (pdfTeX primitives; XeTeX emits Unicode
// text natively, so dropping them is safe) and fontawesome5, whose XeTeX path
// aborts tectonic 0.16 (exit 134). Swap in a fontspec shim loading the
// FontAwesome OTFs by filename.
export function toTectonicCompat(tex: string): string {
  return tex
    .replace(/^[ \t]*\\input\{glyphtounicode\}.*$/gm, "")
    .replace(/^[ \t]*\\pdfgentounicode\s*=\s*1.*$/gm, "")
    .replace(/\\usepackage(\[[^\]]*\])?\{fontawesome5\}/, () => FA_SHIM);
}

// XeTeX logs "Output written on x.xdv (N pages, …)". PDF bytes can't be
// counted directly: tectonic packs page objects into compressed streams.
export function parsePageCount(log: string): number {
  const m = log.match(/Output written on [^(]*\((\d+) pages?/);
  return m ? Number(m[1]) : 0;
}

const FIT_PROBE =
  "\\par\\penalty0\\typeout{AMFIT total=\\the\\pagetotal\\space goal=\\the\\pagegoal}";

function withFitProbe(tex: string): string {
  const i = tex.lastIndexOf("\\end{document}");
  return i === -1 ? tex : tex.slice(0, i) + FIT_PROBE + tex.slice(i);
}

export function parseFit(log: string): { height: number; goal: number } {
  const m = log.match(/AMFIT total=([\d.]+)pt goal=([\d.]+)pt/);
  return m ? { height: Number(m[1]), goal: Number(m[2]) } : { height: 0, goal: 0 };
}

export async function compileLatexWithPages(
  latex: string,
  binary = "tectonic",
): Promise<CompileResult> {
  const dir = await mkdtemp(join(tmpdir(), "applymate-tex-"));
  const texPath = join(dir, "resume.tex");
  try {
    await writeFile(texPath, withFitProbe(toTectonicCompat(latex)), "utf8");
    await runTectonic(binary, texPath, dir);
    const pdf = await readFile(join(dir, "resume.pdf"));
    const log = await readFile(join(dir, "resume.log"), "utf8").catch(() => "");
    return { pdf, pages: parsePageCount(log), ...parseFit(log) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function compileLatex(
  latex: string,
  binary = "tectonic",
): Promise<Buffer> {
  return (await compileLatexWithPages(latex, binary)).pdf;
}

function runTectonic(
  binary: string,
  texPath: string,
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      ["--keep-logs", texPath],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve();
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return reject(new TectonicMissingError());
        reject(
          new Error(`tectonic failed:\n${String(stderr || stdout).slice(-2000)}`),
        );
      },
    );
  });
}
