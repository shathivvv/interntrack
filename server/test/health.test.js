import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import pool from "../src/db.js";

// Close the pool's open connections, or the test process never exits.
after(() => pool.end());

test("GET /api/health reports the API and database are up", async () => {
  const res = await request(createApp()).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok", db: "ok" });
});

test("unknown routes return the spec's JSON 404", async () => {
  const res = await request(createApp()).get("/api/does-not-exist");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Not found" });
});
