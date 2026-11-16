import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Db } from "../../../lib/local/db";
import type { TailorRequest, TailorResult } from "../../../lib/shared/types";
import { compileLatexWithPages } from "../../../lib/local/compile-latex";
import { uniqueRunDir, writeRun } from "../../../lib/local/runs";
import { tailorResume, type TailorDeps } from "../../skill/src/tailor/run";
import { parseResume, partLabels } from "../../skill/src/tailor/resume-doc";
import { runClaude, type ClaudeRunner } from "../../skill/src/tailor/claude-cli";
import { profileName } from "../../skill/src/tailor/letter";
import { answerQuestions, type AnswerRequest } from "../../skill/src/tailor/answer";
import {
  applicationDirName,
  deterministicAppId,
  persistOutput,
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

    // Page scraping often grabs a section heading or form step as the title;
    // Claude's read of the JD is the better name, the page is the fallback.
    const title = out.job.title || req.job.title;
    const company = out.job.company || req.job.company;
    const { first, last } = profileName(files.profileYaml);
    const fileName = resumeFileName(first, last, company, title);
    const now = (opts.now ?? (() => new Date()))();

    const applicationId = opts.db
      ? persistOutput(opts.db, {
          jobUrl: req.job.url,
          company,
          jobTitle: title,
          resumeLatex: out.tex,
          coverLetter: out.coverLetter,
          rewritingReport: { overallConfidence: 1, perBullet: out.edits },
          jobDescription: req.job.description || undefined,
        }).applicationId
      : deterministicAppId(req.job.url);

    const runId = randomUUID();
    const labels = partLabels(parseResume(masterTex));
    const appsDir = join(opts.dir, "applications");
    const savedTo = uniqueRunDir(appsDir, applicationDirName(now, company, title));
    await writeRun(savedTo, {
      report: {
        applicationId,
        runId,
        createdAt: now.toISOString(),
        job: { title, company, url: req.job.url },
        fileName,
        wantCoverLetterPdf: req.wantCoverLetterPdf,
        labels,
        questions: req.fields,
        keywords: out.keywords,
        edits: out.edits,
        warnings: out.warnings,
        pages: out.pages,
      },
      state: {
        edits: Object.fromEntries(out.edits.filter((e) => !e.reverted).map((e) => [e.id, e.after])),
        order: out.order,
        coverLetter: out.coverLetter,
        answers: Object.fromEntries(out.answers.map((a) => [a.fieldId, a.value])),
        questions: req.fields,
        version: 0,
      },
      masterTex,
      resumeTex: out.tex,
      resumePdf: out.pdf,
      coverLetter: out.coverLetter,
      jd: req.job.description,
    });

    return {
      result: {
        applicationId,
        fileName,
        coverLetter: out.coverLetter,
        hasCoverLetterPdf: !!out.coverLetterPdf,
        answers: out.answers,
        keywords: out.keywords,
        edits: out.edits,
        warnings: out.warnings,
        pages: out.pages,
        savedTo,
        runId,
        labels,
        questions: req.fields,
        version: 0,
      },
      resumePdf: out.pdf,
      coverLetterPdf: out.coverLetterPdf,
    };
  };
}

export function makeAnswerJob(opts: { dir: string; runner?: ClaudeRunner }) {
  const optional = (f: string) => readFile(join(opts.dir, f), "utf8").catch(() => "");
  return async (req: AnswerRequest) =>
    answerQuestions(
      req,
      { corpusYaml: await optional("experience.yaml"), profileYaml: await optional("profile.yaml") },
      { runClaude: opts.runner ?? runClaude, claudeCwd: opts.dir },
    );
}
