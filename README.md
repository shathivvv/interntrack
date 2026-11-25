# InternTrack

**A job application tracker I'm building to run my own internship search.** It keeps every application and follow-up in one place, and it's growing an AI layer that scores how well a role fits my resume.

**Live:** [interntrack-psi.vercel.app](https://interntrack-psi.vercel.app) (create an account to try it; your data is visible only to you) · **Status:** in active development (see [Roadmap](#roadmap))

![CI](https://github.com/shathivvv/interntrack/actions/workflows/ci.yml/badge.svg)

---

## What works today

- **Web app:** sign up, then add, edit and delete applications from the browser. The list flags follow-ups that are due or overdue, and applications with no reply after 30 days. Refreshing the page keeps you logged in.
- **Accounts:** register, log in, log out. Passwords hashed with bcrypt; sessions stored in PostgreSQL and sent as an `httpOnly`, `Secure`, `SameSite=Lax` cookie.
- **Applications API:** create, list, view, update (partial `PATCH`) and delete job applications.
- **Ownership on every query:** each user only ever sees their own rows. Requests for someone else's application return `404`, the same as a missing one, so nothing leaks.
- **Validation:** every request body is checked with Zod (required fields, allowed statuses, real dates, URL/email formats, unknown keys rejected), plus date rules: no future application date, no follow-up before applying.
- **Tested and deployed on every change:** 16 API tests run in GitHub Actions against a fresh PostgreSQL on every pull request; `main` only accepts changes that pass.

## Architecture

```
Browser ──► Vercel (React, Vite)
              │  /api/* rewritten to ▼   (same origin → first-party cookie, no CORS)
            Render (Node.js, Express) ──► Neon (PostgreSQL, Singapore)
```

- **React** runs in the browser and holds no secrets.
- **Express** holds every key and is the only thing that talks to the database (and, from B4, to the LLM).
- **Vercel rewrites `/api/*` to Render**, so the browser sees a single site. The session cookie stays first-party, which browsers that block third-party cookies still accept.

## Design decisions

| Decision | Why |
|---|---|
| **Sessions in the database, not JWT** | Logging out deletes the session row, so a copied cookie stops working immediately. A JWT stays valid until it expires. |
| **Session tokens stored as SHA-256 hashes** | If the sessions table leaked, the hashes couldn't be used as cookies. |
| **bcrypt for passwords, SHA-256 for tokens** | Passwords can be guessed, so the hash is deliberately slow. A 32-byte random token can't be guessed, so a fast hash is enough. |
| **Same response for "wrong password" and "no such email"** | Login doesn't reveal which emails have accounts (it even runs a dummy bcrypt compare to keep timing equal). |
| **Plain SQL with numbered migrations** | Every query is visible and parameterized (`$1, $2`); each migration runs once, inside a transaction. |
| **`status` as `text` + `CHECK`, not an enum** | Adding a status later is a one-line constraint change. |
| **"Ghosted" is derived, not stored** | Calculated from `status = 'applied'` and an application date over 30 days old, so it can never go stale. |

The full spec, written before any code, is in [SPEC.md](SPEC.md).

## Roadmap

- [x] Spec, data model and API design
- [x] Deployed skeleton: React + Express + PostgreSQL, CI on every pull request
- [x] Applications CRUD API with validation and ownership tests
- [x] Authentication with database sessions
- [x] React UI: login, protected routes, applications list, create/edit/delete
- [ ] Search, filters and a detail view
- [ ] `/analyze`: LLM job-fit scoring with schema-validated JSON output, measured with an eval set
- [ ] "Ask your applications": retrieval over stored job descriptions (pgvector) with cited sources
- [ ] An agent that drafts follow-ups and updates statuses, **only after I approve each change**

## Tech

**Frontend:** React 19, React Router, Tailwind CSS, Vite · **Backend:** Node.js 24, Express 5, Zod, bcryptjs · **Database:** PostgreSQL on Neon · **Testing / CI:** `node:test`, supertest, GitHub Actions · **Hosting:** Vercel, Render

## Run it locally

Needs Node.js 24 and a PostgreSQL connection string (I use a Neon branch).

```bash
# API
cd server
cp .env.example .env        # then fill in DATABASE_URL
npm install
npm run migrate
npm run dev                 # http://localhost:3000

# Web (second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173, proxies /api to :3000
```

Tests use their own database (`server/.env.test`), because they empty the tables:

```bash
cd server && npm test
```
