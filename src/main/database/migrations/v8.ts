// Pre-merge quality: a completed request records why the Provider stopped. `length` means the reply reached the
// single-output limit and is kept as complete-but-truncated (D102). Migrations 1–7 remain unchanged.
export const migration8 = `
-- The value domain is enforced here; "only on a completed request" is checked by database validation (v8).
ALTER TABLE request_attempts ADD COLUMN finish_reason TEXT CHECK(finish_reason IS NULL OR finish_reason IN ('stop','length'));
CREATE TRIGGER request_attempt_finish_once BEFORE UPDATE OF finish_reason ON request_attempts
  WHEN OLD.finish_reason IS NOT NULL AND NEW.finish_reason IS NOT OLD.finish_reason BEGIN
  SELECT RAISE(ABORT,'Attempt finish reason is immutable');
END;
`;
