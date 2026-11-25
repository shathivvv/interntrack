-- B2: login sessions stored in the database (SPEC decision: DB sessions, not JWT).

CREATE TABLE sessions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Deleting a user logs them out everywhere.
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 of the cookie's token, never the token itself: if this table leaks,
  -- the hashes can't be pasted into a cookie to log in as someone.
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Emails are stored lowercase, so Alice@Example.com and alice@example.com
-- can't become two accounts. The API lowercases; this makes the database enforce it.
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
