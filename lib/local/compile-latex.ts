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

export async function compileLatex(
  latex: string,
  binary = "tectonic",
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "applymate-tex-"));
  const texPath = join(dir, "resume.tex");
  const pdfPath = join(dir, "resume.pdf");
  try {
    await writeFile(texPath, latex, "utf8");
    await runTectonic(binary, texPath, dir);
    return await readFile(pdfPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runTectonic(
  binary: string,
  texPath: string,
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      [texPath],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return reject(new TectonicMissingError());
        reject(new Error(`tectonic failed:\n${String(stderr).slice(-2000)}`));
      },
    );
  });
}
