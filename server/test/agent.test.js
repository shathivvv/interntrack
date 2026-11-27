import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import pool from "../src/db.js";
import { MAX_STEPS } from "../src/ai/agent/loop.js";
import { fakeAuth, resetDb, createUser, validApplication } from "./helpers.js";

// A scripted fake model: each call returns the next scripted response, and records what it was sent.
// Steps may be functions of the conversation, to react to tool results like the real model would.
let script;
let calls;
async function fakeModel(messages) {
  calls.push(structuredClone(messages));
  const step = script.shift();
  if (!step) throw new Error("fake model: no more scripted steps");
  return typeof step === "function" ? step(messages) : step;
}
const say = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
let n = 0;
const use = (...tools) => ({
  stop_reason: "tool_use",
  content: tools.map(([name, input]) => ({ type: "tool_use", id: `toolu_${++n}`, name, input })),
});
const lastToolResults = (messages) => messages.at(-1).content;

const app = createApp({ authenticate: fakeAuth, analyzer: null, embedder: null, answerer: null, agentModel: fakeModel });
let alice;
let bob;
const as = (id) => ({
  start: (message) => request(app).post("/api/agent/runs").set("x-test-user-id", String(id)).send({ message }),
  decide: (runId, decisions) => request(app).post(`/api/agent/runs/${runId}/decide`).set("x-test-user-id", String(id)).send({ decisions }),
  get: (runId) => request(app).get(`/api/agent/runs/${runId}`).set("x-test-user-id", String(id)),
});
const statusOf = async (appId) => (await pool.query("SELECT status FROM applications WHERE id = $1", [appId])).rows[0].status;

beforeEach(async () => {
  await resetDb();
  script = [];
  calls = [];
  alice = await createUser("alice@example.com");
  bob = await createUser("bob@example.com");
});
after(() => pool.end());

async function job(userId, overrides) {
  return (await request(app).post("/api/applications").set("x-test-user-id", String(userId)).send(validApplication(overrides))).body;
}

test("read tools run immediately and only ever see the caller's applications", async () => {
  const mine = await job(alice, { company_name: "WebCo" });
  const bobs = await job(bob, { company_name: "BobSecret" });
  script = [
    use(["search_applications", { query: "", status: "any" }], ["get_application", { id: bobs.id }]),
    (messages) => {
      const [search, get] = lastToolResults(messages);
      assert.match(search.content, /WebCo/);
      assert.doesNotMatch(search.content, /BobSecret/);
      assert.match(get.content, /No application with id/); // Bob's id finds nothing for Alice
      return say("You have one application: WebCo.");
    },
  ];
  const res = await as(alice).start("What have I applied to?");
  assert.equal(res.status, 201);
  assert.equal(res.body.status, "done");
  assert.equal(res.body.reply, "You have one application: WebCo.");
  assert.equal(res.body.steps, 2);
  assert.equal(mine.status, "saved");
});

test("a write waits for approval; nothing changes until approved", async () => {
  const a = await job(alice, { company_name: "Tyrell" });
  script = [
    use(["update_status", { id: a.id, status: "rejected" }]),
    (messages) => {
      assert.match(lastToolResults(messages)[0].content, /Done/);
      return say("Marked Tyrell as rejected.");
    },
  ];
  const started = await as(alice).start("Mark Tyrell as rejected");
  assert.equal(started.body.status, "awaiting_approval");
  assert.equal(started.body.pending.length, 1);
  assert.match(started.body.pending[0].summary, /Tyrell .* saved → rejected/);
  assert.equal(await statusOf(a.id), "saved"); // not changed yet

  const done = await as(alice).decide(started.body.id, [{ tool_use_id: started.body.pending[0].tool_use_id, approve: true }]);
  assert.equal(done.body.status, "done");
  assert.equal(await statusOf(a.id), "rejected");
  assert.equal(done.body.log.at(-1).approved, true);
});

test("a rejected write never happens, and the model is told so", async () => {
  const a = await job(alice);
  script = [
    use(["update_status", { id: a.id, status: "withdrawn" }]),
    (messages) => {
      assert.match(lastToolResults(messages)[0].content, /rejected this action/);
      return say("Okay, I left it unchanged.");
    },
  ];
  const started = await as(alice).start("Withdraw it");
  const done = await as(alice).decide(started.body.id, [{ tool_use_id: started.body.pending[0].tool_use_id, approve: false }]);
  assert.equal(done.body.status, "done");
  assert.equal(await statusOf(a.id), "saved");
});

test("writes to someone else's application are refused before any approval is asked", async () => {
  const bobs = await job(bob);
  script = [
    use(["update_status", { id: bobs.id, status: "rejected" }]),
    (messages) => {
      const [r] = lastToolResults(messages);
      assert.equal(r.is_error, true);
      return say("I couldn't find that application.");
    },
  ];
  const res = await as(alice).start("Reject application " + bobs.id);
  assert.equal(res.body.status, "done");
  assert.equal(res.body.pending.length, 0);
  assert.equal(await statusOf(bobs.id), "saved");
});

test("invalid tool input is returned to the model as an error, not executed", async () => {
  const a = await job(alice);
  script = [
    use(["set_follow_up_date", { id: a.id, date: "next tuesday" }]),
    (messages) => {
      assert.equal(lastToolResults(messages)[0].is_error, true);
      return say("Please give me a date like 2026-12-05.");
    },
  ];
  const res = await as(alice).start("Follow up next tuesday");
  assert.equal(res.body.status, "done");
  assert.equal(res.body.pending.length, 0);
});

test("the step limit stops a model that never finishes", async () => {
  script = Array.from({ length: MAX_STEPS + 2 }, () => use(["search_applications", { query: "", status: "any" }]));
  const res = await as(alice).start("Loop forever please");
  assert.equal(res.body.status, "failed");
  assert.equal(res.body.steps, MAX_STEPS);
  assert.match(res.body.error, /Stopped after/);
});

test("runs are private, decisions must cover every pending action, and finished runs can't be re-decided", async () => {
  const a = await job(alice);
  script = [use(["update_status", { id: a.id, status: "applied" }], ["set_follow_up_date", { id: a.id, date: "2099-01-01" }])];
  const started = await as(alice).start("Mark applied and follow up later");
  // The follow-up date is fine (no date_applied), so both writes wait.
  assert.equal(started.body.pending.length, 2);

  assert.equal((await as(bob).get(started.body.id)).status, 404);
  assert.equal((await as(bob).decide(started.body.id, [{ tool_use_id: "x", approve: true }])).status, 404);

  const partial = await as(alice).decide(started.body.id, [{ tool_use_id: started.body.pending[0].tool_use_id, approve: true }]);
  assert.equal(partial.status, 400); // must decide both

  script = [say("Done.")];
  const decisions = started.body.pending.map((p) => ({ tool_use_id: p.tool_use_id, approve: true }));
  assert.equal((await as(alice).decide(started.body.id, decisions)).body.status, "done");
  assert.equal((await as(alice).decide(started.body.id, decisions)).status, 409);
});
