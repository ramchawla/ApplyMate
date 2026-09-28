import { randomUUID } from "node:crypto";

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job<R> {
  id: string;
  status: JobStatus;
  result?: R;
  error?: string;
}

const MAX_JOBS = 50;

// ponytail: one global FIFO — Claude runs are serialized. Add workers if
// throughput ever matters more than subscription rate limits.
export class JobQueue<I, R> {
  private readonly jobs = new Map<string, Job<R>>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly work: (input: I) => Promise<R>) {}

  enqueue(input: I): string {
    const job: Job<R> = { id: randomUUID(), status: "queued" };
    this.jobs.set(job.id, job);
    if (this.jobs.size > MAX_JOBS) this.jobs.delete(this.jobs.keys().next().value!);
    this.tail = this.tail.then(async () => {
      job.status = "running";
      try {
        job.result = await this.work(input);
        job.status = "done";
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err);
        job.status = "error";
      }
    });
    return job.id;
  }

  get(id: string): Job<R> | undefined {
    return this.jobs.get(id);
  }

  idle(): Promise<void> {
    return this.tail;
  }
}
