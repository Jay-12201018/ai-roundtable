// D133: the cost feature is gone. Token usage moves to request_usage; every price, reservation, budget, top-up, write-off
// and controlled-trial table is dropped (the verified backup taken before this migration still holds them). Migrations
// 1–13 remain unchanged. A Run the old budget stopped gets a plain stop reason in place of one naming amounts.
export const migration14 = `
CREATE TABLE request_usage (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  agent_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('turn','summary','artifact')),
  state TEXT NOT NULL CHECK(state IN ('in_flight','reported','unknown','not_sent')),
  input_tokens INTEGER CHECK(input_tokens IS NULL OR (typeof(input_tokens)='integer' AND input_tokens >= 0)),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR (typeof(output_tokens)='integer' AND output_tokens >= 0)),
  cache_hit_tokens INTEGER CHECK(cache_hit_tokens IS NULL OR (typeof(cache_hit_tokens)='integer' AND cache_hit_tokens >= 0 AND input_tokens IS NOT NULL AND cache_hit_tokens <= input_tokens)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(state <> 'reported' OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL)),
  CHECK(state <> 'not_sent' OR (input_tokens IS NULL AND output_tokens IS NULL))
);
CREATE INDEX idx_request_usage_run ON request_usage(run_id, created_at);
CREATE INDEX idx_request_usage_created ON request_usage(created_at);

INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,input_tokens,output_tokens,cache_hit_tokens,created_at,updated_at)
  SELECT c.request_id,c.run_id,t.agent_id,c.provider_id,c.model_id,'turn',
    CASE c.state WHEN 'reserved' THEN 'in_flight' WHEN 'settled' THEN 'reported' ELSE c.state END,
    c.input_tokens,c.output_tokens,p.cache_hit_tokens,c.created_at,c.updated_at
  FROM request_charges c JOIN request_attempts a ON a.request_id=c.request_id JOIN turns t ON t.id=a.turn_id
    LEFT JOIN charge_pricing p ON p.request_id=c.request_id;
INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,input_tokens,output_tokens,cache_hit_tokens,created_at,updated_at)
  SELECT c.request_id,c.run_id,r.agent_id,c.provider_id,c.model_id,'summary',
    CASE c.state WHEN 'reserved' THEN 'in_flight' WHEN 'settled' THEN 'reported' ELSE c.state END,
    c.input_tokens,c.output_tokens,p.cache_hit_tokens,c.created_at,c.updated_at
  FROM summary_charges c JOIN summary_requests r ON r.request_id=c.request_id
    LEFT JOIN charge_pricing p ON p.request_id=c.request_id;
INSERT INTO request_usage(request_id,run_id,agent_id,provider_id,model_id,kind,state,input_tokens,output_tokens,cache_hit_tokens,created_at,updated_at)
  SELECT c.request_id,c.run_id,r.agent_id,c.provider_id,c.model_id,'artifact',
    CASE c.state WHEN 'reserved' THEN 'in_flight' WHEN 'settled' THEN 'reported' ELSE c.state END,
    c.input_tokens,c.output_tokens,p.cache_hit_tokens,c.created_at,c.updated_at
  FROM artifact_charges c JOIN artifact_requests r ON r.request_id=c.request_id
    LEFT JOIN charge_pricing p ON p.request_id=c.request_id;

-- The copy above is complete before these rules exist; from here a row starts open and is closed exactly once.
CREATE TRIGGER request_usage_insert BEFORE INSERT ON request_usage BEGIN
  SELECT CASE WHEN NEW.state <> 'in_flight'
    OR (NEW.kind='turn' AND NOT EXISTS(SELECT 1 FROM request_attempts a JOIN turns t ON t.id=a.turn_id WHERE a.request_id=NEW.request_id AND a.run_id=NEW.run_id AND t.agent_id=NEW.agent_id))
    OR (NEW.kind='summary' AND NOT EXISTS(SELECT 1 FROM summary_requests r WHERE r.request_id=NEW.request_id AND r.run_id=NEW.run_id AND r.agent_id=NEW.agent_id))
    OR (NEW.kind='artifact' AND NOT EXISTS(SELECT 1 FROM artifact_requests r WHERE r.request_id=NEW.request_id AND r.run_id=NEW.run_id AND r.agent_id=NEW.agent_id))
  THEN RAISE(ABORT,'Invalid usage identity') END;
END;
CREATE TRIGGER request_usage_identity_immutable BEFORE UPDATE OF request_id,run_id,agent_id,provider_id,model_id,kind,created_at ON request_usage BEGIN
  SELECT RAISE(ABORT,'Usage identity is immutable');
END;
CREATE TRIGGER request_usage_close_once BEFORE UPDATE OF state ON request_usage BEGIN
  SELECT CASE WHEN OLD.state <> 'in_flight' OR NEW.state NOT IN ('reported','unknown','not_sent') THEN RAISE(ABORT,'Invalid usage transition') END;
END;
CREATE TRIGGER request_usage_result_once BEFORE UPDATE OF input_tokens,output_tokens,cache_hit_tokens ON request_usage WHEN OLD.state <> 'in_flight' BEGIN
  SELECT RAISE(ABORT,'Closed usage is immutable');
END;
CREATE TRIGGER request_usage_no_delete BEFORE DELETE ON request_usage BEGIN
  SELECT RAISE(ABORT,'Usage is append-only');
END;

UPDATE workflow_runs SET last_error='这场讨论是旧版本按预算限制停下的，已有发言都保留。现在不再设预算，可以接着讨论。'
  WHERE id IN (SELECT run_id FROM run_budgets WHERE blocked_json IS NOT NULL) AND status='error';

DROP TABLE charge_writeoffs;
DROP TABLE charge_pricing;
DROP TABLE artifact_charges;
DROP TABLE summary_charges;
DROP TABLE request_charges;
DROP TABLE run_budget_topups;
DROP TABLE run_budgets;
DROP TABLE controlled_trial_reconciliations;
DROP TABLE controlled_trials;
`;
