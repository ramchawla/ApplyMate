import type { ApplyJobOutput } from "../../skill/src/types";

export interface StoredOutput extends ApplyJobOutput {
  jobUrl: string;
  receivedAt: string;
}

export class OutputStore {
  private latest: StoredOutput | null = null;

  set(output: ApplyJobOutput & { jobUrl: string }): void {
    this.latest = {
      ...output,
      receivedAt: new Date().toISOString(),
    };
  }

  getLatest(): StoredOutput | null {
    return this.latest;
  }

  clear(): void {
    this.latest = null;
  }
}
