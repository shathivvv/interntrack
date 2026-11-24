import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import pool from "../src/db.js";
import { fakeAuth, resetDb, createUser, validApplication } from "./helpers.js";

const app = createApp({ authenticate: fakeAuth });
let alice;
let bob;

// Two users, so every test can check that one can't touch the other's data.
beforeEach(async () => {
  await resetDb();
  alice = await createUser("alice@example.com");
  bob = await createUser("bob@example.com");
});

after(() => pool.end());

// Helpers: send a request as a given user.
const as = (userId) => ({
  get: (url) => request(app).get(url).set("x-test-user-id", String(userId)),
  post: (url, body) => request(app).post(url).set("x-test-user-id", String(userId)).send(body),
  patch: (url, body) => request(app).patch(url).set("x-test-user-id", String(userId)).send(body),
  delete: (url) => request(app).delete(url).set("x-test-user-id", String(userId)),
});

test("POST creates an application owned by the caller, with defaults", async () => {
  const res = await as(alice).post("/api/applications", validApplication({ location: "  " }));

  assert.equal(res.status, 201);
  assert.equal(typeof res.body.id, "number"); // bigint ids come back as numbers, not "1"
  assert.equal(res.body.company_name, "LuuWu Solutions");
  assert.equal(res.body.status, "saved"); // DB default
  assert.equal(res.body.location, null); // blank text is stored as null
  assert.equal("user_id" in res.body, false); // never sent back

  const { rows } = await pool.query("SELECT user_id FROM applications WHERE id = $1", [res.body.id]);
  assert.equal(rows[0].user_id, alice);
});

test("POST rejects missing required fields and unknown fields with 400", async () => {
  const missing = await as(alice).post("/api/applications", { company_name: "X" });
  assert.equal(missing.status, 400);
  const paths = missing.body.details.map((d) => d.path).sort();
  assert.deepEqual(paths, ["job_description", "role"]);

  // A client trying to set the owner itself is refused, not silently ignored.
  const sneaky = await as(alice).post("/api/applications", validApplication({ user_id: bob }));
  assert.equal(sneaky.status, 400);

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM applications");
  assert.equal(rows[0].n, 0);
});

test("dates: follow-up before applied, and applied in the future, are rejected", async () => {
  const backwards = await as(alice).post(
    "/api/applications",
    validApplication({ date_applied: "2026-11-20", follow_up_date: "2026-11-10" }),
  );
  assert.equal(backwards.status, 400);
  assert.equal(backwards.body.details[0].path, "follow_up_date");

  const future = await as(alice).post("/api/applications", validApplication({ date_applied: "2099-01-01" }));
  assert.equal(future.status, 400);
  assert.equal(future.body.details[0].path, "date_applied");

  // Dates come back exactly as sent, with no timezone shift.
  const ok = await as(alice).post(
    "/api/applications",
    validApplication({ date_applied: "2026-11-20", follow_up_date: "2026-11-27" }),
  );
  assert.equal(ok.status, 201);
  assert.equal(ok.body.date_applied, "2026-11-20");
  assert.equal(ok.body.follow_up_date, "2026-11-27");
});

test("GET list and GET one only show the caller's own applications", async () => {
  const mine = await as(alice).post("/api/applications", validApplication());
  await as(bob).post("/api/applications", validApplication({ company_name: "Bob's pick" }));

  const list = await as(alice).get("/api/applications");
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, mine.body.id);

  const own = await as(alice).get(`/api/applications/${mine.body.id}`);
  assert.equal(own.status, 200);

  // Bob asking for Alice's application gets 404, the same as for an id that doesn't exist.
  const other = await as(bob).get(`/api/applications/${mine.body.id}`);
  assert.equal(other.status, 404);
  const missing = await as(bob).get("/api/applications/999999");
  assert.deepEqual(other.body, missing.body);

  const junk = await as(alice).get("/api/applications/abc");
  assert.equal(junk.status, 404);
});

test("PATCH changes only the sent fields, and can't touch someone else's row", async () => {
  const created = await as(alice).post(
    "/api/applications",
    validApplication({ date_applied: "2026-11-20", location: "Kuala Lumpur" }),
  );
  const id = created.body.id;

  const updated = await as(alice).patch(`/api/applications/${id}`, { status: "applied" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.status, "applied");
  assert.equal(updated.body.location, "Kuala Lumpur"); // untouched
  assert.ok(new Date(updated.body.updated_at) >= new Date(created.body.updated_at));

  // The date rule is checked against the stored date_applied, not just the request.
  const badDate = await as(alice).patch(`/api/applications/${id}`, { follow_up_date: "2026-11-01" });
  assert.equal(badDate.status, 400);

  const empty = await as(alice).patch(`/api/applications/${id}`, {});
  assert.equal(empty.status, 400);

  const hijack = await as(bob).patch(`/api/applications/${id}`, { status: "rejected" });
  assert.equal(hijack.status, 404);
  const after = await as(alice).get(`/api/applications/${id}`);
  assert.equal(after.body.status, "applied"); // Bob's change didn't happen
});

test("DELETE removes only the caller's own application", async () => {
  const created = await as(alice).post("/api/applications", validApplication());
  const id = created.body.id;

  const byBob = await as(bob).delete(`/api/applications/${id}`);
  assert.equal(byBob.status, 404);

  const byAlice = await as(alice).delete(`/api/applications/${id}`);
  assert.equal(byAlice.status, 204);

  const gone = await as(alice).get(`/api/applications/${id}`);
  assert.equal(gone.status, 404);
});

test("the real app refuses every applications route until auth exists", async () => {
  const realApp = createApp(); // uses requireAuth
  const res = await request(realApp).get("/api/applications").set("x-test-user-id", String(alice));
  assert.equal(res.status, 401);
});

test("a body that isn't valid JSON gets a JSON 400, not a crash", async () => {
  const res = await request(app)
    .post("/api/applications")
    .set("x-test-user-id", String(alice))
    .set("Content-Type", "application/json")
    .send("{not json");
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Request body is not valid JSON" });
});
