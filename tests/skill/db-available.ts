import { connect } from "../../packages/skill/src/db/pgvector";
import type pg from "pg";

// The pgvector-backed tests are integration tests against the optional local
// Postgres container (`pnpm skill:db:up`). Without it they skip rather than
// fail — the in-memory retrieval path keeps the pipeline fully covered.
export async function tryConnect(): Promise<pg.Client | null> {
  try {
    return await connect();
  } catch {
    return null;
  }
}
