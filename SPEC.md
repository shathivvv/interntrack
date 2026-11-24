# InternTrack — Spec

## 1. Problem
InternTrack is a job application tracker that keeps every application and
follow-up organized, and uses AI to score how well a role matches my resume.

## 2. Data

### Application (one row)
| Field | Type | Required | Notes |
|---|---|---|---|
| company_name | text | ✅ | |
| role | text | ✅ | job title |
| status | text + CHECK | ✅ | see Statuses |
| job_description | text | ✅ | needed by /analyze and RAG |
| location | text | | city + remote / hybrid / on-site |
| salary | text | | range as written in the ad |
| date_applied | date | | when I actually sent it |
| application_method | text + CHECK | | job_site · email · career_fair · referral |
| job_url | text | | |
| resume_version | text | | e.g. "v6" |
| follow_up_date | date | | drives the dashboard badges |
| interview_round | text | | empty / 1 / 2 / final |
| contact_name | text | | |
| contact_email | text | | |
| contact_phone | text | | |
| analysis_result | (added in B4) | | saved /analyze output |
| fit_score | (added in B4) | | |

System fields (set by the database, never typed by the user): `id`, `user_id`, `created_at`, `updated_at`.

> Trade-off: job_description is required, so a job can't be saved without pasting it.
> That's fine — a job without a description can't be analysed.

### Statuses
`saved` → `applied` → `interviewing` → `offer` → `accepted` / `declined`
Also: `rejected` (they said no), `withdrawn` (I pulled out before an offer).

- `offer` = offered, not decided yet (the one status with a reply deadline)
- `declined` = I said no to their offer · `rejected` = they said no to me
- **Transitions:** any status can change to any other (simplest; no enforced order).
- **Ghosted is derived, not stored:** `status = 'applied'` and `date_applied` is more
  than 30 days ago. Using date_applied (not updated_at) means small edits like fixing
  a typo don't reset the 30-day clock.
- Dates (Zod): date_applied can't be in the future; follow_up_date can't be before date_applied.

### Why text + CHECK, not a Postgres enum
Adding or renaming a status later is a one-line constraint change, where enums are
harder to alter.

## 3. Tables
**users**: id, email (UNIQUE), password_hash, name (optional), resume_text, created_at
**applications**: id, user_id → users.id (foreign key, ON DELETE CASCADE), all fields above, created_at, updated_at

Relationship: one user has many applications; each application belongs to one user.
Added later: embeddings (B4), agent actions (B5).

## 4. API routes
### Auth
- `POST /api/auth/register`: create an account
- `POST /api/auth/login`: log in and set an httpOnly cookie
- `POST /api/auth/logout` 🔒: clear the cookie
- `GET /api/auth/me` 🔒: return the logged-in user. React calls it on page load,
  because it can't read the httpOnly cookie itself.

### Applications (all 🔒)
- `GET /api/applications`: list my applications
- `POST /api/applications`: create one, linked to me
- `GET /api/applications/:id`: one application's full details
- `PATCH /api/applications/:id`: update only the fields sent
- `DELETE /api/applications/:id`: delete one

### Security rules
- `user_id` always comes from the login session, **never** from the request.
- Every query filters by it: `WHERE id = $1 AND user_id = $2`.
- Someone else's application → **404**, not 403 (403 would confirm it exists).

### Errors
Every error returns `{ "error": "message" }`.
Validation errors (400) also include details:
`{ "error": "Validation failed", "details": [{ "path": "role", "message": "..." }] }` 

### Added later
- B3: `GET /api/applications?status=...` (filters as query parameters)
- B4: `POST /api/applications/:id/analyze`. The result is stored on the application row,
  so Claude runs once per job, not on every page load, and evals have a saved
  baseline. **Editing job_description clears analysis_result.**
- B5: ask (RAG) and agent routes

## 5. Architecture
React on **Vercel** → calls Express on **Render** → which talks to Postgres on **Neon** (AWS Singapore).
Claude and Voyage are called from **Express only**.
React runs in the visitor's browser, so any key there could be read with DevTools.
Express runs on the server, so its keys never leave it.

### Decided in B1: same-origin API
vercel.json rewrites /api/* to Render, so the session cookie stays first-party (live since B1).
### Known limitation
If Render's free plan sleeps the service when idle, the first request after a quiet
period can be slow. That's not a bug.

## 6. Decisions
- **LLM: Claude Haiku.** It has the three things InternTrack needs: structured
  JSON output (/analyze), tool calling (the agent) and a JS SDK (Express).
  I'm paying instead of using a free tier so rate limits can't interrupt my
  eval runs. At about USD 0.0005 per call, with a $5 spend limit, the cost doesn't matter.
- **Embeddings: Voyage AI** (voyage-4 family, free tier). Changing the embedding
  model later means re-embedding every row.
- **Database: Neon.** It has pgvector built in, so relational data and RAG
  embeddings live in one database, and it has a serverless free tier.
  Not Render Postgres (we already chose Neon; Render's free database expires).
- **Express on a Render Web Service:** it's a running program that handles
  requests and talks to Neon and Claude, and it holds the secret keys,
  which must stay on the server.
- **/analyze uses the current resume_text**, not the resume version that was
  actually sent.

## 7. Cut list (NOT building this week)
- **Separate contacts table:** name, email and phone as 3 columns avoids extra
  joins and a multi-step form; fine at single-user scale.
- **Separate vector database:** Neon's pgvector keeps relational data and
  embeddings in one database.
- **Automated email reminders:** follow-up badges on the dashboard solve it
  visually without a third-party email service.
- **Resume upload / file storage:** saves days of setup; /analyze reads resume
  text pasted into users.resume_text.
- **Neon extras (Better Auth, AI gateway, object storage, functions, realtime):**
  auth is built by hand (that's the skill); Claude is called directly with the SDK.