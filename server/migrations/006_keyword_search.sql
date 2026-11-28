-- Hybrid search, part 1: a Postgres full-text index over each application's text.
-- Vector search ranks by overall meaning, so a word mentioned once in a long ad (e.g. "React"
-- in a Java job's list of tools) can fall out of the top 5. Keyword search finds exact words.

-- A generated column: Postgres keeps it up to date on every insert and update.
-- to_tsvector('english', …) lowercases, drops stop words and stems ("APIs" → "api").
ALTER TABLE applications
  ADD COLUMN search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(role, '') || ' ' || coalesce(company_name, '') || ' ' || coalesce(job_description, ''))
  ) STORED;

-- GIN index: fast "which rows contain these words" lookups.
CREATE INDEX applications_search_idx ON applications USING gin (search);
