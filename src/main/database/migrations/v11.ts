// D113 (R16 D1-B): a confirmed request target is remembered across launches. Migrations 1–10 remain unchanged.
export const migration11 = `
-- One row per Provider: the host confirmed that the Key at key_revision may be sent to base_url as this kind.
-- Main uses it only while kind, target and the Provider's current key_revision all still match; a new Key or a
-- changed target gives the Provider a new key_revision, so the row then no longer authorizes anything.
CREATE TABLE provider_target_approvals (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('openai','openai-compatible','anthropic','gemini')),
  base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 1 AND 2048),
  key_revision TEXT NOT NULL CHECK(typeof(key_revision)='text' AND length(key_revision) > 0),
  confirmed_at TEXT NOT NULL
);
`;
