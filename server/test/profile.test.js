import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import pool from "../src/db.js";
import { fakeAuth, resetDb, createUser } from "./helpers.js";

const app = createApp({ authenticate: fakeAuth });
let alice;
let bob;

beforeEach(async () => {
  await resetDb();
  alice = await createUser("alice@example.com");
  bob = await createUser("bob@example.com");
});
after(() => pool.end());

const as = (id) => ({
  get: () => request(app).get("/api/profile").set("x-test-user-id", String(id)),
  patch: (body) => request(app).patch("/api/profile").set("x-test-user-id", String(id)).send(body),
});

test("PATCH saves the resume and name; GET returns them, never the password hash", async () => {
  const saved = await as(alice).patch({ name: " Alice ", resume_text: "Python, React, SQL" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.name, "Alice");

  const me = await as(alice).get();
  assert.deepEqual(me.body, { id: alice, email: "alice@example.com", name: "Alice", resume_text: "Python, React, SQL" });
  assert.equal("password_hash" in me.body, false);

  // Bob's profile is untouched.
  assert.equal((await as(bob).get()).body.resume_text, null);
});

test("PATCH only changes what's sent, clears with blank text, and rejects other fields", async () => {
  await as(alice).patch({ name: "Alice", resume_text: "v1" });
  assert.equal((await as(alice).patch({ resume_text: "v2" })).body.name, "Alice");
  assert.equal((await as(alice).patch({ resume_text: "   " })).body.resume_text, null);

  for (const body of [{}, { email: "evil@example.com" }, { password_hash: "x" }, { resume_text: "x".repeat(20001) }]) {
    assert.equal((await as(alice).patch(body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await as(alice).get()).body.email, "alice@example.com");
});
