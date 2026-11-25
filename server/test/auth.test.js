import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import pool from "../src/db.js";
import { resetDb, validApplication } from "./helpers.js";

// Low bcrypt cost so tests are fast. Read at hash time, so setting it here is enough.
process.env.BCRYPT_ROUNDS = "4";

// The REAL app with the real requireAuth: these tests go through actual cookies and sessions.
const app = createApp();

beforeEach(resetDb);
after(() => pool.end());

// A supertest "agent" keeps cookies between requests, like a browser does.
async function registered(email, password = "correct horse battery") {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email, password, name: "Test" });
  assert.equal(res.status, 201);
  return agent;
}

test("register creates the user, hashes the password, and logs in with an httpOnly cookie", async () => {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/register")
    .send({ email: "  Alice@Example.COM ", password: "correct horse battery", name: "Alice" });

  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 1, email: "alice@example.com", name: "Alice" }); // lowercased, no hash

  const cookie = res.headers["set-cookie"][0];
  assert.match(cookie, /^sid=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = 1");
  assert.notEqual(rows[0].password_hash, "correct horse battery");
  assert.match(rows[0].password_hash, /^\$2[aby]\$/); // a bcrypt hash

  const me = await agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.email, "alice@example.com");
});

test("register rejects a duplicate email (any case) with 409, and weak input with 400", async () => {
  await registered("alice@example.com");

  const dupe = await request(app)
    .post("/api/auth/register")
    .send({ email: "ALICE@example.com", password: "another long password" });
  assert.equal(dupe.status, 409);

  const short = await request(app).post("/api/auth/register").send({ email: "b@example.com", password: "short" });
  assert.equal(short.status, 400);

  const badEmail = await request(app).post("/api/auth/register").send({ email: "nope", password: "long enough pw" });
  assert.equal(badEmail.status, 400);
});

test("login: wrong password and unknown email get the exact same 401", async () => {
  await registered("alice@example.com", "correct horse battery");

  const wrongPassword = await request(app)
    .post("/api/auth/login")
    .send({ email: "alice@example.com", password: "wrong password!" });
  const unknownEmail = await request(app)
    .post("/api/auth/login")
    .send({ email: "nobody@example.com", password: "wrong password!" });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.deepEqual(wrongPassword.body, unknownEmail.body); // can't tell which emails exist
  assert.equal(wrongPassword.headers["set-cookie"], undefined);

  const ok = await request.agent(app)
    .post("/api/auth/login")
    .send({ email: "Alice@Example.com", password: "correct horse battery" });
  assert.equal(ok.status, 200);
  assert.match(ok.headers["set-cookie"][0], /^sid=/);
});

test("logout kills the session in the database, not just in the browser", async () => {
  const agent = request.agent(app);
  const reg = await agent
    .post("/api/auth/register")
    .send({ email: "alice@example.com", password: "correct horse battery" });
  // Keep a copy of the cookie, as an attacker who stole it would: "sid=...".
  const stolenCookie = reg.headers["set-cookie"][0].split(";")[0];

  const out = await agent.post("/api/auth/logout");
  assert.equal(out.status, 204);
  assert.equal((await agent.get("/api/auth/me")).status, 401);

  // Replaying the old cookie no longer works, because the session row is gone.
  const replay = await request(app).get("/api/auth/me").set("Cookie", stolenCookie);
  assert.equal(replay.status, 401);

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM sessions");
  assert.equal(rows[0].n, 0);
});

test("an expired session is refused", async () => {
  const agent = await registered("alice@example.com");
  await pool.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("end to end: real logins, and users only ever see their own applications", async () => {
  const alice = await registered("alice@example.com");
  const bob = await registered("bob@example.com");

  const created = await alice.post("/api/applications").send(validApplication());
  assert.equal(created.status, 201);

  assert.equal((await alice.get("/api/applications")).body.length, 1);
  assert.equal((await bob.get("/api/applications")).body.length, 0);
  assert.equal((await bob.get(`/api/applications/${created.body.id}`)).status, 404);
  assert.equal((await request(app).get("/api/applications")).status, 401);
});
