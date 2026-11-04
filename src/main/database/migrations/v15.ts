// D147: images the host attaches. The bytes stay in files named by their hash, outside the database; these tables say what
// each file is and which goal or message uses it. No earlier object is touched, and existing rows mean what they meant.
// A use is append-only: history keeps its images, so an image in use can never be removed (the foreign keys hold that too).
export const migration15 = `
CREATE TABLE attachments (
  sha256 TEXT PRIMARY KEY CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  media_type TEXT NOT NULL CHECK(media_type IN ('image/png','image/jpeg','image/webp')),
  byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 1 AND 10485760),
  created_at TEXT NOT NULL
);
CREATE TRIGGER attachment_immutable BEFORE UPDATE ON attachments BEGIN
  SELECT RAISE(ABORT,'Attachments are immutable');
END;

CREATE TABLE message_attachments (
  message_id TEXT NOT NULL REFERENCES messages(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 3),
  sha256 TEXT NOT NULL REFERENCES attachments(sha256),
  PRIMARY KEY(message_id, position),
  UNIQUE(message_id, sha256)
);
CREATE INDEX idx_message_attachments_file ON message_attachments(sha256);
CREATE TRIGGER message_attachment_immutable BEFORE UPDATE ON message_attachments BEGIN
  SELECT RAISE(ABORT,'Message attachments are append-only');
END;
CREATE TRIGGER message_attachment_no_delete BEFORE DELETE ON message_attachments BEGIN
  SELECT RAISE(ABORT,'Message attachments are append-only');
END;

CREATE TABLE run_task_attachments (
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 3),
  sha256 TEXT NOT NULL REFERENCES attachments(sha256),
  PRIMARY KEY(run_id, position),
  UNIQUE(run_id, sha256)
);
CREATE INDEX idx_run_task_attachments_file ON run_task_attachments(sha256);
CREATE TRIGGER run_task_attachment_immutable BEFORE UPDATE ON run_task_attachments BEGIN
  SELECT RAISE(ABORT,'Goal attachments are append-only');
END;
CREATE TRIGGER run_task_attachment_no_delete BEFORE DELETE ON run_task_attachments BEGIN
  SELECT RAISE(ABORT,'Goal attachments are append-only');
END;
`;
