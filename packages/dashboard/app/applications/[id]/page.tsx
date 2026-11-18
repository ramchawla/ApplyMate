import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getApplicationDetail, getRuns } from "../../../lib/data";
import { RunReport, CoverageBar, Section, box } from "../../../components/RunReport";
import { ChatTranscript } from "../../../components/ChatTranscript";
import { Icon } from "../../../components/Icon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// report_json of a version row: tailor-job writes {runId, version: 0, ...} for v0,
// chat writes {runId, version, label}. Older rows carry no runId and match no run.
type Tag = { runId?: string; version?: number; label?: string };

// SQLite datetime('now') is UTC without a zone; run createdAt is ISO.
const toDate = (s: string) => new Date(/[TZ]/.test(s) ? s : `${s.replace(" ", "T")}Z`);
const day = (s: string) => toDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const time = (s: string) => toDate(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const when = (s: string) =>
  toDate(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const btn =
  "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-ctl border text-small font-medium transition-colors duration-150";
const plainBtn = `${btn} bg-surface border-border-strong text-text hover:bg-surface-2`;
const primaryBtn = `${btn} bg-accent border-accent text-accent-fg hover:bg-accent-hover hover:border-accent-hover`;
const row = "flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border last:border-b-0";

function Status({ status }: { status: string }) {
  const tone =
    { applied: "bg-ok-bg text-ok", interviewed: "bg-ok-bg text-ok", rejected: "bg-err-bg text-err" }[status] ??
    "bg-surface-2 text-text-2";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-small font-medium before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-current ${tone}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function Header(p: { company: string; title: string; sub: ReactNode[]; jobUrl: string; pdf?: string }) {
  return (
    <>
      <div className="mb-3.5 text-small text-text-3">
        <Link href="/applications" className="text-text-2 hover:text-text">
          Applications
        </Link>{" "}
        / {p.company}
      </div>
      <header className="grid gap-6 items-end min-[1000px]:grid-cols-[1fr_auto] pb-5 border-b border-border">
        <div>
          <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] leading-tight [text-wrap:balance]">{p.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3.5 text-text-2">{p.sub}</div>
        </div>
        <div className="flex gap-2">
          <a href={p.jobUrl} target="_blank" rel="noreferrer" className={plainBtn}>
            <Icon name="ext" />
            Job posting
          </a>
          {p.pdf && (
            <Link href={p.pdf} className={primaryBtn}>
              <Icon name="dl" />
              Resume PDF
            </Link>
          )}
        </div>
      </header>
    </>
  );
}

export default function ApplicationDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { run?: string };
}) {
  const detail = getApplicationDetail(params.id);
  if (!detail) notFound();
  const { app, versions } = detail;
  const runs = getRuns(app.id);
  const submitted = app.status === "applied";

  // Pre-run-folder application: today's version list, restyled.
  if (!runs.length) {
    return (
      <>
        <Header
          company={app.company}
          title={app.jobTitle}
          sub={[<span key="c">{app.company}</span>, <Status key="s" status={app.status} />]}
          jobUrl={app.jobUrl}
          pdf={versions[0] && `/resumes/${versions[0].id}`}
        />
        <div className="mt-6 max-w-[640px]">
          <Section title="Versions" n={versions.length}>
            <div className={box}>
              {versions.map((v) => (
                <div key={v.id} className={row}>
                  <span className="w-7 h-[22px] grid place-items-center rounded-chip bg-surface-2 text-text-2 text-meta font-semibold">
                    v{v.versionNumber}
                  </span>
                  <Link href={`/resumes/${v.id}`} className="flex-1 font-medium hover:underline">
                    Version {v.versionNumber}
                  </Link>
                  <span className="text-small text-text-3">{day(v.createdAt)}</span>
                </div>
              ))}
              {!versions.length && <p className="px-4 py-3 text-small text-text-3">No saved versions.</p>}
            </div>
          </Section>
        </div>
      </>
    );
  }

  const run = runs.find((r) => r.runId === searchParams.run) ?? runs[0];
  const { view } = run;
  const tag = (v: (typeof versions)[number]) => v.report as Tag;
  const rowsOf = (runId: string) =>
    versions.filter((v) => tag(v).runId === runId).sort((a, b) => (tag(b).version ?? 0) - (tag(a).version ?? 0));
  const runRows = rowsOf(run.runId);
  const current = runRows[0];

  return (
    <>
      <Header
        company={view.company}
        title={view.title}
        sub={[
          <span key="c">{view.company}</span>,
          <Status key="s" status={app.status} />,
          <span key="d">{day(run.createdAt)}</span>,
          <span key="v">
            Version {view.version}
            {submitted ? " submitted" : ""}
          </span>,
        ]}
        jobUrl={app.jobUrl}
        pdf={current && `/resumes/${current.id}`}
      />
      <CoverageBar view={view} />

      <div className="grid gap-8 items-start mt-6 min-[1000px]:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <RunReport view={view} submitted={submitted} />
        </div>

        <aside>
          <Section title="Versions">
            <div className={box}>
              {runRows.map((v) => {
                const t = tag(v);
                const isCurrent = v === current;
                return (
                  <div key={v.id} className={`${row} ${isCurrent ? "bg-accent-soft" : ""}`}>
                    <span
                      className={`w-7 h-[22px] grid place-items-center rounded-chip text-meta font-semibold ${
                        isCurrent ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-2"
                      }`}
                    >
                      v{t.version ?? 0}
                    </span>
                    <div className="flex-1 min-w-0">
                      <b className="block font-medium truncate">{t.version ? (t.label ?? "Chat edit") : "Tailored"}</b>
                      <span className="text-small text-text-3">
                        {t.version ? "Chat" : "⚡ run"}, {time(v.createdAt)}
                        {isCurrent ? ". Current" : ""}
                      </span>
                    </div>
                    <Link
                      href={`/resumes/${v.id}`}
                      aria-label={`Resume PDF, version ${t.version ?? 0}`}
                      className="w-7 h-7 grid place-items-center rounded-ctl border border-transparent text-text-2 hover:bg-surface-2 hover:border-border hover:text-text"
                    >
                      <Icon name="dl" />
                    </Link>
                  </div>
                );
              })}
              {!runRows.length && <p className="px-4 py-3 text-small text-text-3">No saved versions.</p>}
            </div>
          </Section>

          <Section title="Runs" n={runs.length}>
            <div className={box}>
              {runs.map((r) => {
                const n = rowsOf(r.runId).length;
                return (
                  <Link
                    key={r.runId}
                    href={`?run=${encodeURIComponent(r.runId)}`}
                    aria-current={r === run ? "true" : undefined}
                    className={`${row} hover:bg-surface-2 ${r === run ? "bg-accent-soft hover:bg-accent-soft" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <b className="block font-medium">{when(r.createdAt)}</b>
                      <span className="text-small text-text-3">
                        {n} version{n === 1 ? "" : "s"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Section>

          <Section title="Chat" n={`${run.chat.length} message${run.chat.length === 1 ? "" : "s"}`}>
            <ChatTranscript chat={run.chat} />
          </Section>
        </aside>
      </div>
    </>
  );
}
