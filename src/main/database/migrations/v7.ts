// R13A Run budgets and the per-request charge ledger. Migrations 1–6 remain unchanged; existing Runs get the ¥1 default.
export const migration7 = `
CREATE TABLE run_budgets (
  run_id TEXT PRIMARY KEY REFERENCES workflow_runs(id),
  currency TEXT NOT NULL CHECK(currency = 'CNY'),
  limit_micro INTEGER NOT NULL CHECK(typeof(limit_micro)='integer' AND limit_micro BETWEEN 1 AND 1000000000),
  blocked_json TEXT CHECK(blocked_json IS NULL OR (json_valid(blocked_json) AND json_type(blocked_json)='object')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER run_budget_limit_immutable BEFORE UPDATE OF run_id,currency,limit_micro,created_at ON run_budgets BEGIN
  SELECT RAISE(ABORT,'Run budget limit is immutable');
END;
CREATE TRIGGER run_budget_no_delete BEFORE DELETE ON run_budgets BEGIN
  SELECT RAISE(ABORT,'Run budgets are append-only');
END;

CREATE TABLE request_charges (
  request_id TEXT PRIMARY KEY REFERENCES request_attempts(request_id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('CNY','USD')),
  state TEXT NOT NULL CHECK(state IN ('reserved','settled','unknown','not_sent')),
  input_token_bound INTEGER NOT NULL CHECK(typeof(input_token_bound)='integer' AND input_token_bound >= 0),
  output_token_limit INTEGER NOT NULL CHECK(typeof(output_token_limit)='integer' AND output_token_limit >= 0),
  input_micro_per_token INTEGER NOT NULL CHECK(typeof(input_micro_per_token)='integer' AND input_micro_per_token >= 0),
  output_micro_per_token INTEGER NOT NULL CHECK(typeof(output_micro_per_token)='integer' AND output_micro_per_token >= 0),
  reserved_micro INTEGER NOT NULL CHECK(typeof(reserved_micro)='integer' AND reserved_micro = input_token_bound * input_micro_per_token + output_token_limit * output_micro_per_token),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR (typeof(input_tokens)='integer' AND input_tokens >= 0)),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR (typeof(output_tokens)='integer' AND output_tokens >= 0)),
  accounted_micro INTEGER CHECK(accounted_micro IS NULL OR typeof(accounted_micro)='integer'),
  price_evidence TEXT NOT NULL CHECK(length(price_evidence) > 0),
  price_reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- A non-CNY price is only ledgered when it is exactly zero; the CNY budget never converts currencies.
  CHECK(currency = 'CNY' OR (input_micro_per_token = 0 AND output_micro_per_token = 0)),
  -- Settled charges carry provider usage at the frozen rates; nothing else may hold an accounted amount.
  CHECK((state = 'settled') = (accounted_micro IS NOT NULL)),
  CHECK(state <> 'settled' OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL
    AND accounted_micro = input_tokens * input_micro_per_token + output_tokens * output_micro_per_token)),
  CHECK(state <> 'not_sent' OR (input_tokens IS NULL AND output_tokens IS NULL))
);
CREATE INDEX idx_request_charges_run ON request_charges(run_id, created_at);
CREATE TRIGGER request_charge_identity_insert BEFORE INSERT ON request_charges BEGIN
  SELECT CASE WHEN NEW.state <> 'reserved'
    OR NOT EXISTS(SELECT 1 FROM request_attempts a WHERE a.request_id = NEW.request_id AND a.run_id = NEW.run_id)
  THEN RAISE(ABORT,'Invalid charge identity') END;
END;
CREATE TRIGGER request_charge_identity_immutable BEFORE UPDATE OF request_id,run_id,provider_id,model_id,currency,input_token_bound,output_token_limit,input_micro_per_token,output_micro_per_token,reserved_micro,price_evidence,price_reviewed_at,created_at ON request_charges BEGIN
  SELECT RAISE(ABORT,'Charge identity and price are immutable');
END;
CREATE TRIGGER request_charge_settle_once BEFORE UPDATE OF state ON request_charges BEGIN
  SELECT CASE WHEN OLD.state <> 'reserved' OR NEW.state NOT IN ('settled','unknown','not_sent') THEN RAISE(ABORT,'Invalid charge transition') END;
END;
CREATE TRIGGER request_charge_result_once BEFORE UPDATE OF input_tokens,output_tokens,accounted_micro ON request_charges WHEN OLD.state <> 'reserved' BEGIN
  SELECT RAISE(ABORT,'Settled charges are immutable');
END;
CREATE TRIGGER request_charge_no_delete BEFORE DELETE ON request_charges BEGIN
  SELECT RAISE(ABORT,'Charges are append-only');
END;

INSERT INTO run_budgets(run_id,currency,limit_micro,blocked_json,created_at,updated_at)
  SELECT id,'CNY',1000000,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM workflow_runs;
`;
