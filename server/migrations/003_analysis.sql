-- B4: the saved result of /analyze (SPEC: stored on the row, so Claude runs once per job).

ALTER TABLE applications
  -- The validated JSON from the model: { fit_score, matched_skills, missing_skills, summary }.
  ADD COLUMN analysis_result jsonb,
  -- Copied out of the JSON into its own column so the list can sort and filter by it.
  ADD COLUMN fit_score integer CHECK (fit_score BETWEEN 0 AND 100),
  ADD COLUMN analyzed_at timestamptz,
  -- Which model produced it, so an old analysis can be told apart after a model change.
  ADD COLUMN analysis_model text;
