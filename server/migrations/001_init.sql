-- Users and applications, as designed in SPEC.md sections 2 and 3.

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text,
  resume_text   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE applications (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Deleting a user deletes their applications (SPEC: ON DELETE CASCADE).
  user_id            bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  company_name       text NOT NULL CHECK (btrim(company_name) <> ''),
  role               text NOT NULL CHECK (btrim(role) <> ''),
  -- text + CHECK instead of an enum: adding a status later is one constraint change.
  status             text NOT NULL DEFAULT 'saved'
                     CHECK (status IN ('saved', 'applied', 'interviewing', 'offer',
                                       'accepted', 'declined', 'rejected', 'withdrawn')),
  job_description    text NOT NULL CHECK (btrim(job_description) <> ''),

  location           text,
  salary             text,
  date_applied       date,
  application_method text CHECK (application_method IN ('job_site', 'email', 'career_fair', 'referral')),
  job_url            text,
  resume_version     text,
  follow_up_date     date,
  interview_round    text CHECK (interview_round IN ('1', '2', 'final')),
  contact_name       text,
  contact_email      text,
  contact_phone      text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Set by the API on every PATCH (no trigger), so it's visible in the route code.
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Every applications query filters by user_id, so index it.
CREATE INDEX applications_user_id_idx ON applications (user_id);
