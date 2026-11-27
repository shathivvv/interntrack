-- B5: the assistant agent. A "run" is one task you give it. Its conversation is stored here
-- because a run can PAUSE: when the agent wants to change data, it waits (possibly for
-- minutes) for you to approve, and a later HTTP request has to continue exactly where it left off.

CREATE TABLE agent_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('running', 'awaiting_approval', 'done', 'failed')),
  -- The full conversation sent to the model, replayed unchanged on every step.
  messages      jsonb NOT NULL,
  -- Write actions waiting for your decision, and the read results to send alongside them.
  pending       jsonb NOT NULL DEFAULT '[]',
  ready_results jsonb NOT NULL DEFAULT '[]',
  -- A readable record of what the agent did (shown in the UI, and an audit trail).
  log           jsonb NOT NULL DEFAULT '[]',
  steps         integer NOT NULL DEFAULT 0,
  reply         text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_runs_user_id_idx ON agent_runs (user_id);
