CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS experiences (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  skills        TEXT[] NOT NULL DEFAULT '{}',
  metrics       TEXT[] NOT NULL DEFAULT '{}',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  claim_anchor  TEXT NOT NULL,
  embedding     vector(384) NOT NULL
);

CREATE INDEX IF NOT EXISTS experiences_embedding_idx
  ON experiences USING hnsw (embedding vector_cosine_ops);
