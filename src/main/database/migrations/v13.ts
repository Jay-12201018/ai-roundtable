// R15 (D126–D131): writing an adopted code candidate into a folder the host chose. Migrations 1–12 remain unchanged and
// no earlier object is touched. A write records which version went to which folder and what happened to each of its
// files — never the file contents.
export const migration13 = `
-- One host-confirmed write of one effective code version into one folder (the folder's real path when it was chosen).
CREATE TABLE code_exports (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  client_request_id TEXT NOT NULL,
  root_path TEXT NOT NULL CHECK(length(root_path) BETWEEN 1 AND 4096),
  created_at TEXT NOT NULL,
  UNIQUE(run_id, client_request_id)
);
CREATE INDEX idx_code_exports_version ON code_exports(version_id, created_at);
CREATE TRIGGER code_export_insert BEFORE INSERT ON code_exports BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id
      WHERE v.id=NEW.version_id AND v.run_id=NEW.run_id AND a.kind='code' AND v.validation='valid'
        AND (v.origin='edit' OR EXISTS(SELECT 1 FROM artifact_adoptions d WHERE d.version_id=v.id)))
  THEN RAISE(ABORT,'Invalid code export') END;
END;
CREATE TRIGGER code_export_immutable BEFORE UPDATE ON code_exports BEGIN
  SELECT RAISE(ABORT,'Code exports are append-only');
END;
CREATE TRIGGER code_export_no_delete BEFORE DELETE ON code_exports BEGIN
  SELECT RAISE(ABORT,'Code exports are append-only');
END;

-- What happened to each file of the version in that write: written, skipped (not selected, unchanged) or failed, with
-- a reason code. The hash and size are of the candidate content, so a record can be matched to a file on disk.
CREATE TABLE code_export_files (
  export_id TEXT NOT NULL REFERENCES code_exports(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 19),
  path TEXT NOT NULL CHECK(length(path) BETWEEN 1 AND 260),
  action TEXT NOT NULL CHECK(action IN ('create','overwrite','none')),
  outcome TEXT NOT NULL CHECK(outcome IN ('written','skipped','failed')),
  reason TEXT CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 40),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  byte_count INTEGER NOT NULL CHECK(byte_count >= 0),
  PRIMARY KEY(export_id, position),
  UNIQUE(export_id, path),
  CHECK((outcome = 'written') = (reason IS NULL)),
  CHECK(outcome <> 'written' OR action IN ('create','overwrite'))
);
CREATE TRIGGER code_export_file_immutable BEFORE UPDATE ON code_export_files BEGIN
  SELECT RAISE(ABORT,'Code export files are append-only');
END;
CREATE TRIGGER code_export_file_no_delete BEFORE DELETE ON code_export_files BEGIN
  SELECT RAISE(ABORT,'Code export files are append-only');
END;
`;
