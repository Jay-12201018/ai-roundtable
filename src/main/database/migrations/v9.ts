// R13B: budget top-ups, write-offs of unknown charges, actual period/cache pricing and conversation summaries.
// Migrations 1–8 remain unchanged. Every table here is append-only evidence; nothing rewrites a ledger row (D104–D107).
export const migration9 = `
-- D104: a Run's limit is its start amount plus every top-up; the start amount itself stays immutable (migration 7).
CREATE TABLE run_budget_topups (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  client_request_id TEXT NOT NULL,
  amount_micro INTEGER NOT NULL CHECK(typeof(amount_micro)='integer' AND amount_micro BETWEEN 1 AND 1000000000),
  created_at TEXT NOT NULL,
  UNIQUE(run_id, client_request_id)
);
CREATE INDEX idx_run_budget_topups_run ON run_budget_topups(run_id, created_at);
CREATE TRIGGER run_budget_topup_insert BEFORE INSERT ON run_budget_topups BEGIN
  SELECT CASE WHEN (SELECT limit_micro FROM run_budgets WHERE run_id=NEW.run_id) IS NULL
    OR (SELECT limit_micro FROM run_budgets WHERE run_id=NEW.run_id)
      + COALESCE((SELECT SUM(amount_micro) FROM run_budget_topups WHERE run_id=NEW.run_id),0) + NEW.amount_micro > 1000000000
  THEN RAISE(ABORT,'Invalid budget top-up') END;
END;
CREATE TRIGGER run_budget_topup_immutable BEFORE UPDATE ON run_budget_topups BEGIN
  SELECT RAISE(ABORT,'Budget top-ups are append-only');
END;
CREATE TRIGGER run_budget_topup_no_delete BEFORE DELETE ON run_budget_topups BEGIN
  SELECT RAISE(ABORT,'Budget top-ups are append-only');
END;

-- D107: a summary slot stands in for public messages 1..N once the host confirms it. Its requests have no Turn,
-- so their ledger rows live in summary_charges, which mirrors request_charges rule for rule.
CREATE TABLE context_summaries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  client_request_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  covered_json TEXT NOT NULL CHECK(json_valid(covered_json) AND json_type(covered_json)='array' AND json_array_length(covered_json) >= 1),
  based_on_summary_id TEXT REFERENCES context_summaries(id),
  created_at TEXT NOT NULL,
  UNIQUE(run_id, client_request_id)
);
CREATE INDEX idx_context_summaries_run ON context_summaries(run_id, created_at);
CREATE TRIGGER context_summary_immutable BEFORE UPDATE ON context_summaries BEGIN
  SELECT RAISE(ABORT,'Summaries are immutable');
END;
CREATE TRIGGER context_summary_no_delete BEFORE DELETE ON context_summaries BEGIN
  SELECT RAISE(ABORT,'Summaries are append-only');
END;

CREATE TABLE summary_requests (
  request_id TEXT PRIMARY KEY,
  summary_id TEXT NOT NULL REFERENCES context_summaries(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
  client_request_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('generating','completed','failed','aborted','interrupted')),
  finish_reason TEXT CHECK(finish_reason IS NULL OR (finish_reason IN ('stop','length') AND status='completed')),
  input_snapshot TEXT NOT NULL CHECK(json_valid(input_snapshot) AND json_type(input_snapshot)='object' AND json_extract(input_snapshot,'$.requestId')=request_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, client_request_id)
);
CREATE INDEX idx_summary_requests_summary ON summary_requests(summary_id, created_at);
CREATE TRIGGER summary_request_insert BEFORE INSERT ON summary_requests BEGIN
  SELECT CASE WHEN NEW.status <> 'generating'
    OR NOT EXISTS(SELECT 1 FROM context_summaries s WHERE s.id=NEW.summary_id AND s.run_id=NEW.run_id)
    OR NOT EXISTS(SELECT 1 FROM messages m JOIN message_versions v ON v.message_id=m.id
      WHERE m.id=NEW.message_id AND m.run_id=NEW.run_id AND m.sender_type='system' AND v.slot_id=NEW.summary_id)
  THEN RAISE(ABORT,'Invalid summary request identity') END;
END;
CREATE TRIGGER summary_request_identity_immutable BEFORE UPDATE OF request_id,summary_id,run_id,message_id,client_request_id,agent_id,input_snapshot,created_at ON summary_requests BEGIN
  SELECT RAISE(ABORT,'Summary request identity is immutable');
END;
CREATE TRIGGER summary_request_finish_once BEFORE UPDATE OF status,finish_reason ON summary_requests BEGIN
  SELECT CASE WHEN OLD.status <> 'generating' OR NEW.status = 'generating' THEN RAISE(ABORT,'Invalid summary request transition') END;
END;
CREATE TRIGGER summary_request_no_delete BEFORE DELETE ON summary_requests BEGIN
  SELECT RAISE(ABORT,'Summary requests are append-only');
END;

-- A generated summary version is used only after the host confirms it; a host edit is confirmed by its author.
CREATE TABLE summary_confirmations (
  message_id TEXT PRIMARY KEY REFERENCES messages(id),
  summary_id TEXT NOT NULL REFERENCES context_summaries(id),
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  client_request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TRIGGER summary_confirmation_insert BEFORE INSERT ON summary_confirmations BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM messages m JOIN message_versions v ON v.message_id=m.id
      WHERE m.id=NEW.message_id AND m.run_id=NEW.run_id AND m.sender_type='system' AND m.status='completed' AND v.slot_id=NEW.summary_id)
  THEN RAISE(ABORT,'Invalid summary confirmation') END;
END;
CREATE TRIGGER summary_confirmation_immutable BEFORE UPDATE ON summary_confirmations BEGIN
  SELECT RAISE(ABORT,'Summary confirmations are append-only');
END;
CREATE TRIGGER summary_confirmation_no_delete BEFORE DELETE ON summary_confirmations BEGIN
  SELECT RAISE(ABORT,'Summary confirmations are append-only');
END;

CREATE TABLE summary_charges (
  request_id TEXT PRIMARY KEY REFERENCES summary_requests(request_id),
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
  CHECK(currency = 'CNY' OR (input_micro_per_token = 0 AND output_micro_per_token = 0)),
  CHECK((state = 'settled') = (accounted_micro IS NOT NULL)),
  CHECK(state <> 'settled' OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL
    AND accounted_micro = input_tokens * input_micro_per_token + output_tokens * output_micro_per_token)),
  CHECK(state <> 'not_sent' OR (input_tokens IS NULL AND output_tokens IS NULL))
);
CREATE INDEX idx_summary_charges_run ON summary_charges(run_id, created_at);
CREATE TRIGGER summary_charge_identity_insert BEFORE INSERT ON summary_charges BEGIN
  SELECT CASE WHEN NEW.state <> 'reserved'
    OR NOT EXISTS(SELECT 1 FROM summary_requests r WHERE r.request_id = NEW.request_id AND r.run_id = NEW.run_id)
  THEN RAISE(ABORT,'Invalid charge identity') END;
END;
CREATE TRIGGER summary_charge_identity_immutable BEFORE UPDATE OF request_id,run_id,provider_id,model_id,currency,input_token_bound,output_token_limit,input_micro_per_token,output_micro_per_token,reserved_micro,price_evidence,price_reviewed_at,created_at ON summary_charges BEGIN
  SELECT RAISE(ABORT,'Charge identity and price are immutable');
END;
CREATE TRIGGER summary_charge_settle_once BEFORE UPDATE OF state ON summary_charges BEGIN
  SELECT CASE WHEN OLD.state <> 'reserved' OR NEW.state NOT IN ('settled','unknown','not_sent') THEN RAISE(ABORT,'Invalid charge transition') END;
END;
CREATE TRIGGER summary_charge_result_once BEFORE UPDATE OF input_tokens,output_tokens,accounted_micro ON summary_charges WHEN OLD.state <> 'reserved' BEGIN
  SELECT RAISE(ABORT,'Settled charges are immutable');
END;
CREATE TRIGGER summary_charge_no_delete BEFORE DELETE ON summary_charges BEGIN
  SELECT RAISE(ABORT,'Charges are append-only');
END;

-- D106: how a settled request was actually priced. The peak cache-miss amount in the charge row stays as evidence;
-- this row may only lower it, by the official off-peak and cache-hit rates, rounded up to a micro-CNY.
CREATE TABLE charge_pricing (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  period TEXT NOT NULL CHECK(period IN ('peak','off_peak')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  cache_hit_tokens INTEGER CHECK(cache_hit_tokens IS NULL OR (typeof(cache_hit_tokens)='integer' AND cache_hit_tokens >= 0)),
  cache_hit_micro_per_million INTEGER NOT NULL CHECK(typeof(cache_hit_micro_per_million)='integer' AND cache_hit_micro_per_million >= 0),
  cache_miss_micro_per_million INTEGER NOT NULL CHECK(typeof(cache_miss_micro_per_million)='integer' AND cache_miss_micro_per_million >= 0),
  output_micro_per_million INTEGER NOT NULL CHECK(typeof(output_micro_per_million)='integer' AND output_micro_per_million >= 0),
  amount_micro INTEGER NOT NULL CHECK(typeof(amount_micro)='integer' AND amount_micro >= 0),
  evidence TEXT NOT NULL CHECK(length(evidence) > 0),
  created_at TEXT NOT NULL
);
CREATE TRIGGER charge_pricing_insert BEFORE INSERT ON charge_pricing BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM (SELECT request_id,run_id,state,input_tokens,output_tokens,accounted_micro FROM request_charges
      UNION ALL SELECT request_id,run_id,state,input_tokens,output_tokens,accounted_micro FROM summary_charges) c
    WHERE c.request_id=NEW.request_id AND c.run_id=NEW.run_id AND c.state='settled'
      AND COALESCE(NEW.cache_hit_tokens,0) <= c.input_tokens AND NEW.amount_micro <= c.accounted_micro
      AND NEW.amount_micro * 1000000 >= COALESCE(NEW.cache_hit_tokens,0) * NEW.cache_hit_micro_per_million
        + (c.input_tokens - COALESCE(NEW.cache_hit_tokens,0)) * NEW.cache_miss_micro_per_million + c.output_tokens * NEW.output_micro_per_million
      AND NEW.amount_micro * 1000000 - (COALESCE(NEW.cache_hit_tokens,0) * NEW.cache_hit_micro_per_million
        + (c.input_tokens - COALESCE(NEW.cache_hit_tokens,0)) * NEW.cache_miss_micro_per_million + c.output_tokens * NEW.output_micro_per_million) < 1000000)
  THEN RAISE(ABORT,'Invalid charge pricing') END;
END;
CREATE TRIGGER charge_pricing_immutable BEFORE UPDATE ON charge_pricing BEGIN
  SELECT RAISE(ABORT,'Charge pricing is immutable');
END;
CREATE TRIGGER charge_pricing_no_delete BEFORE DELETE ON charge_pricing BEGIN
  SELECT RAISE(ABORT,'Charge pricing is append-only');
END;

-- D105: the host's own console reading for an unknown charge. The unknown row is never changed; the latest
-- write-off of a request is effective and every earlier one stays visible.
CREATE TABLE charge_writeoffs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  client_request_id TEXT NOT NULL,
  amount_micro INTEGER NOT NULL CHECK(typeof(amount_micro)='integer' AND amount_micro >= 0),
  basis TEXT NOT NULL CHECK(length(trim(basis)) BETWEEN 1 AND 200),
  acknowledged_uncertainty INTEGER NOT NULL CHECK(acknowledged_uncertainty = 1),
  created_at TEXT NOT NULL,
  UNIQUE(request_id, client_request_id)
);
CREATE INDEX idx_charge_writeoffs_request ON charge_writeoffs(request_id, created_at);
CREATE TRIGGER charge_writeoff_insert BEFORE INSERT ON charge_writeoffs BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM (SELECT request_id,run_id,state,currency,reserved_micro FROM request_charges
      UNION ALL SELECT request_id,run_id,state,currency,reserved_micro FROM summary_charges) c
    WHERE c.request_id=NEW.request_id AND c.run_id=NEW.run_id AND c.state='unknown' AND c.currency='CNY' AND NEW.amount_micro <= c.reserved_micro)
  THEN RAISE(ABORT,'Invalid charge write-off') END;
END;
CREATE TRIGGER charge_writeoff_immutable BEFORE UPDATE ON charge_writeoffs BEGIN
  SELECT RAISE(ABORT,'Write-offs are append-only');
END;
CREATE TRIGGER charge_writeoff_no_delete BEFORE DELETE ON charge_writeoffs BEGIN
  SELECT RAISE(ABORT,'Write-offs are append-only');
END;
`;
