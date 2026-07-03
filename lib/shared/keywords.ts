// Shared tech-keyword vocabulary. Used by the skill's JD parser and the
// extension's keyword-gap view — one list so the two can't drift apart.
export const TECH_TERMS = [
  "rust", "go", "golang", "python", "typescript", "javascript", "java",
  "c++", "c#", "kotlin", "swift", "ruby", "scala", "sql",
  "postgresql", "postgres", "mysql", "sqlite", "redis", "mongodb",
  "docker", "kubernetes", "terraform", "ci/cd",
  "aws", "gcp", "azure",
  "graphql", "rest", "grpc", "websocket",
  "async", "concurrency", "distributed", "microservices",
  "react", "next.js", "vue", "angular", "node", "express",
  "wasm", "latex", "pgvector", "llm", "tectonic",
  "machine learning", "pytorch", "tensorflow", "nlp", "embeddings",
  "kafka", "rabbitmq", "spark", "airflow", "etl",
] as const;

// Word-boundary match for plain terms ("go" must not hit "good"); plain
// containment for terms where \b breaks (c++, c#, next.js, ci/cd).
export function extractTechKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return Array.from(
    new Set(
      TECH_TERMS.filter((t) =>
        /^[a-z0-9 ]+$/.test(t)
          ? new RegExp(`\\b${t}\\b`).test(lower)
          : lower.includes(t),
      ),
    ),
  );
}
