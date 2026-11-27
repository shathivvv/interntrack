import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import pool from "../src/db.js";
import { AnalysisSchema, AnalyzeError, createClaudeAnalyzer } from "../src/ai/analyzer.js";
import { fakeAuth, resetDb, createUser, validApplication } from "./helpers.js";

// A fake analyzer: no network, no API key, no cost. It records what it was asked.
const calls = [];
const RESULT = { fit_score: 72, matched_skills: ["React", "SQL"], missing_skills: ["Docker"], summary: "Good fit; lacks Docker." };
async function fakeAnalyzer(input) {
  calls.push(input);
  return { result: RESULT, model: "fake-model" };
}

const app = createApp({ authenticate: fakeAuth, analyzer: fakeAnalyzer });
let alice;
let bob;

beforeEach(async () => {
  await resetDb();
  calls.length = 0;
  alice = await createUser("alice@example.com");
  bob = await createUser("bob@example.com");
  await pool.query("UPDATE users SET resume_text = 'React, SQL, Python' WHERE id = $1", [alice]);
});
after(() => pool.end());

const as = (id) => ({
  post: (url, body) => request(app).post(url).set("x-test-user-id", String(id)).send(body),
  patch: (url, body) => request(app).patch(url).set("x-test-user-id", String(id)).send(body),
  get: (url) => request(app).get(url).set("x-test-user-id", String(id)),
});

async function aliceJob(overrides) {
  return (await as(alice).post("/api/applications", validApplication(overrides))).body;
}

test("analyze sends the job and resume to the analyzer, then saves and returns the result", async () => {
  const job = await aliceJob({ job_description: "Need React and Docker." });
  const res = await as(alice).post(`/api/applications/${job.id}/analyze`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.analysis_result, RESULT);
  assert.equal(res.body.fit_score, 72);
  assert.equal(res.body.analysis_model, "fake-model");
  assert.ok(res.body.analyzed_at);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].jobDescription, "Need React and Docker.");
  assert.equal(calls[0].resume, "React, SQL, Python");

  // Saved, not just returned.
  assert.equal((await as(alice).get(`/api/applications/${job.id}`)).body.fit_score, 72);
});

test("no resume → 400; someone else's job → 404; neither calls the (paid) analyzer", async () => {
  const job = await aliceJob();
  const bobJob = (await as(bob).post("/api/applications", validApplication())).body;

  assert.equal((await as(bob).post(`/api/applications/${bobJob.id}/analyze`)).status, 400); // Bob has no resume
  assert.equal((await as(bob).post(`/api/applications/${job.id}/analyze`)).status, 404); // Alice's job
  assert.equal(calls.length, 0);
});

test("an analyzer failure becomes a clean error, and nothing is saved", async () => {
  const failing = createApp({
    authenticate: fakeAuth,
    analyzer: async () => {
      throw new AnalyzeError("The AI service is unavailable right now. Please try again.");
    },
  });
  const job = await aliceJob();
  const res = await request(failing).post(`/api/applications/${job.id}/analyze`).set("x-test-user-id", String(alice));
  assert.equal(res.status, 502);
  assert.match(res.body.error, /unavailable/);
  assert.equal((await as(alice).get(`/api/applications/${job.id}`)).body.analysis_result, null);
});

test("without an API key the route says 503 instead of crashing", async () => {
  const unconfigured = createApp({ authenticate: fakeAuth, analyzer: null });
  const job = await aliceJob();
  const res = await request(unconfigured).post(`/api/applications/${job.id}/analyze`).set("x-test-user-id", String(alice));
  assert.equal(res.status, 503);
});

test("editing the job description clears the analysis; other edits keep it", async () => {
  const job = await aliceJob({ job_description: "Need React." });
  await as(alice).post(`/api/applications/${job.id}/analyze`);

  const statusOnly = await as(alice).patch(`/api/applications/${job.id}`, { status: "applied" });
  assert.equal(statusOnly.body.fit_score, 72);

  const sameText = await as(alice).patch(`/api/applications/${job.id}`, { job_description: "Need React." });
  assert.equal(sameText.body.fit_score, 72); // identical text: still valid

  const newText = await as(alice).patch(`/api/applications/${job.id}`, { job_description: "Need Rust." });
  assert.equal(newText.body.fit_score, null);
  assert.equal(newText.body.analysis_result, null);
});

test("model output is validated: out-of-range scores and extra keys are rejected; duplicates removed", () => {
  assert.equal(AnalysisSchema.safeParse({ ...RESULT, fit_score: 140 }).success, false);
  assert.equal(AnalysisSchema.safeParse({ ...RESULT, fit_score: 7.5 }).success, false);
  assert.equal(AnalysisSchema.safeParse({ ...RESULT, hidden: "x" }).success, false);
  assert.equal(AnalysisSchema.safeParse(null).success, false); // the SDK gives null if parsing failed

  const deduped = AnalysisSchema.parse({ ...RESULT, matched_skills: ["React", "react", " SQL "] });
  assert.deepEqual(deduped.matched_skills, ["React", "SQL"]); // first spelling kept, whitespace trimmed
});

test("the real analyzer handles a refusal and an invalid response without saving garbage", async () => {
  // A stand-in for the Anthropic client, so no request leaves the machine.
  const clientReturning = (response) => ({ messages: { parse: async () => response } });
  const usage = { input_tokens: 10, output_tokens: 5 };
  // Realistic text, because the guardrails drop any skill that isn't in the JD and the resume.
  const input = { company: "X", role: "Y", jobDescription: "Need React, SQL and Docker.", resume: "Projects using React and SQL." };

  const refusing = createClaudeAnalyzer({ client: clientReturning({ stop_reason: "refusal", usage, parsed_output: null }) });
  await assert.rejects(refusing(input), AnalyzeError);

  const invalid = createClaudeAnalyzer({ client: clientReturning({ stop_reason: "end_turn", usage, parsed_output: { ...RESULT, fit_score: 500 } }) });
  await assert.rejects(invalid(input), AnalyzeError);

  const ok = createClaudeAnalyzer({ client: clientReturning({ stop_reason: "end_turn", usage, parsed_output: RESULT, model: "m" }) });
  assert.deepEqual((await ok(input)).result, RESULT);

  // The guardrails run on every real answer: a claimed skill the resume lacks moves to missing,
  // and a skill the JD never mentions is dropped.
  const padded = { ...RESULT, matched_skills: ["React", "SQL", "Docker", "Kubernetes"], missing_skills: [] };
  const guarded = createClaudeAnalyzer({ client: clientReturning({ stop_reason: "end_turn", usage, parsed_output: padded, model: "m" }) });
  const out = await guarded(input);
  assert.deepEqual(out.result.matched_skills, ["React", "SQL"]);
  assert.deepEqual(out.result.missing_skills, ["Docker"]);
  assert.deepEqual(out.raw.matched_skills, padded.matched_skills); // raw answer kept for evals

  assert.equal(createClaudeAnalyzer({ apiKey: "" }), null); // no key → not configured
});
