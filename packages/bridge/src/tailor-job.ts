import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../../../lib/local/db";
import type { TailorRequest, TailorResult } from "../../../lib/shared/types";
import { compileLatexWithPages } from "../../../lib/local/compile-latex";
import { tailorResume, type TailorDeps } from "../../skill/src/tailor/run";
import { runClaude, type ClaudeRunner } from "../../skill/src/tailor/claude-cli";
import { profileName } from "../../skill/src/tailor/letter";
import {
  applicationDirName,
  deterministicAppId,
  persistOutput,
  saveApplicationFiles,
} from "./persist";

export interface TailorJobResult {
  result: TailorResult;
  resumePdf: Buffer;
  coverLetterPdf?: Buffer;
}

export function resumeFileName(
  first: string,
  last: string,
  company: string,
  title: string,
): string {
  const part = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const name = [first, last, company, title].map(part).filter(Boolean).join("_").slice(0, 100);
  return `${name || "resume"}.pdf`;
}

export function makeTailorJob(opts: {
  dir: string;
  db?: Db;
  runner?: ClaudeRunner;
  compile?: TailorDeps["compile"];
  now?: () => Date;
}) {
  const read = (f: string) => readFile(join(opts.dir, f), "utf8");
  const optional = (f: string) => read(f).catch(() => "");

  return async (req: TailorRequest): Promise<TailorJobResult> => {
    const masterTex = await read("resume-master.tex").catch(() => {
      throw new Error(`Master resume not found at ${join(opts.dir, "resume-master.tex")}`);
    });
    const files = {
      masterTex,
      corpusYaml: await optional("experience.yaml"),
      directives: await optional("generation-directives.md"),
      profileYaml: await optional("profile.yaml"),
    };

    const out = await tailorResume(req, files, {
      runClaude: opts.runner ?? runClaude,
      compile: opts.compile ?? ((latex) => compileLatexWithPages(latex)),
      claudeCwd: opts.dir,
    });

    const { first, last } = profileName(files.profileYaml);
    const savedTo = join(
      opts.dir,
      "applications",
      applicationDirName((opts.now ?? (() => new Date()))(), req.job.company, req.job.title),
    );
    const report = {
      keywords: out.keywords,
      edits: out.edits,
      warnings: out.warnings,
      answers: out.answers,
      pages: out.pages,
    };
    await saveApplicationFiles(savedTo, {
      resumeTex: out.tex,
      resumePdf: out.pdf,
      coverLetter: out.coverLetter,
      report,
      jd: req.job.description,
    });

    const applicationId = opts.db
      ? persistOutput(opts.db, {
          jobUrl: req.job.url,
          company: req.job.company,
          jobTitle: req.job.title,
          resumeLatex: out.tex,
          coverLetter: out.coverLetter,
          rewritingReport: { overallConfidence: 1, perBullet: out.edits },
          jobDescription: req.job.description || undefined,
        }).applicationId
      : deterministicAppId(req.job.url);

    return {
      result: {
        applicationId,
        fileName: resumeFileName(first, last, req.job.company, req.job.title),
        coverLetter: out.coverLetter,
        hasCoverLetterPdf: !!out.coverLetterPdf,
        answers: out.answers,
        keywords: out.keywords,
        edits: out.edits,
        warnings: out.warnings,
        pages: out.pages,
        savedTo,
      },
      resumePdf: out.pdf,
      coverLetterPdf: out.coverLetterPdf,
    };
  };
}
