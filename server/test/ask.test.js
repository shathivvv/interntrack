import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import pool from "../src/db.js";
import { createClaudeAnswerer } from "../src/ai/answerer.js";
import { AnalyzeError } from "../src/ai/analyzer.js";
import { EMBEDDING_DIMENSIONS } from "../src/ai/embedder.js";
import { fakeAuth, resetDb, createUser, validApplication } from "./helpers.js";

// Same word-hashing fake embedder as embeddings.test.js: shared words → similar vectors.
async function fakeEmbedder(texts) {
  return texts.map((text) => {
    const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      let h = 0;
      for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % EMBEDDING_DIMENSIONS;
      v[h] += 1;
    }
    v[0] += 0.01;
    return v;
  });
}
fakeEmbedder.model = "fake-embed";

// A fake answerer: records exactly what would be sent to the model, and cites what the test says.
let seen;
let reply;
async function fakeAnswerer(input) {
  seen = input;
  return { answer: "Fake answer.", sources: reply.sources };
}

const app = createApp({ authenticate: fakeAuth, analyzer: null, embedder: fakeEmbedder, answerer: fakeAnswerer });
let alice;
let bob;
const ask = (id, question) => request(app).post("/api/ask").set("x-test-user-id", String(id)).send({ question });

beforeEach(async () => {
  await resetDb();
  seen = null;
  reply = { sources: [] };
  alice = await createUser("alice@example.com");
  bob = await createUser("bob@example.com");
});
after(() => pool.end());

async function seed() {
  const post = (id, o) => request(app).post("/api/applications").set("x-test-user-id", String(id)).send(validApplication(o));
  const react = (await post(alice, { company_name: "WebCo", role: "React Intern", job_description: "React, TypeScript and REST APIs for dashboards." })).body;
  const java = (await post(alice, { company_name: "BankCo", role: "Java Intern", job_description: "Java Spring backend for payments." })).body;
  const secret = (await post(bob, { company_name: "BobSecret", role: "React Intern", job_description: "React, TypeScript and REST APIs for dashboards." })).body;
  return { react, java, secret };
}

test("the model sees all my facts, the most relevant job descriptions first, and never another user's data", async () => {
  const { react, java, secret } = await seed();
  reply = { sources: [react.id] };
  const res = await ask(alice, "Which jobs use React and TypeScript?");

  assert.equal(res.status, 200);
  assert.equal(res.body.answer, "Fake answer.");
  assert.deepEqual(res.body.sources.map((s) => s.company_name), ["WebCo"]);

  // Hybrid context: every one of my applications as facts…
  assert.deepEqual(seen.facts.map((f) => f.id).sort(), [react.id, java.id].sort());
  // …and job descriptions ranked by meaning, the React job first.
  assert.equal(seen.documents[0].id, react.id);
  // Bob's identical React job is never sent to the model.
  const everything = JSON.stringify(seen);
  assert.equal(everything.includes("BobSecret"), false);
  assert.equal(seen.documents.some((d) => d.id === secret.id), false);
  assert.match(seen.today, /^\d{4}-\d{2}-\d{2}$/);
});

test("validation, no applications (no AI call), and no AI configured", async () => {
  assert.equal((await ask(alice, "hi")).status, 400);

  const empty = await ask(alice, "What have I applied to?");
  assert.equal(empty.status, 200);
  assert.equal(seen, null); // answered without calling the model

  await seed();
  const noAi = createApp({ authenticate: fakeAuth, analyzer: null, embedder: fakeEmbedder, answerer: null });
  const res = await request(noAi).post("/api/ask").set("x-test-user-id", String(alice)).send({ question: "Anything?" });
  assert.equal(res.status, 503);
});

test("without embeddings it still answers from the facts table", async () => {
  await seed();
  const noEmbed = createApp({ authenticate: fakeAuth, analyzer: null, embedder: null, answerer: fakeAnswerer });
  const res = await request(noEmbed).post("/api/ask").set("x-test-user-id", String(alice)).send({ question: "Which are applied?" });
  assert.equal(res.status, 200);
  assert.equal(seen.documents.length, 0);
  assert.equal(seen.facts.length, 2);
});

test("real answerer: drops citations of jobs it was never shown; handles refusals and bad output", async () => {
  const clientReturning = (r) => ({ messages: { parse: async () => r } });
  const usage = { input_tokens: 10, output_tokens: 5 };
  const input = { question: "q?", today: "2026-11-27", documents: [], facts: [{ id: 7, company_name: "A", role: "B", status: "applied" }] };

  const ok = createClaudeAnswerer({ client: clientReturning({ stop_reason: "end_turn", usage, parsed_output: { answer: "Yes.", sources: [7, 7, 999] } }) });
  assert.deepEqual((await ok(input)).sources, [7]); // duplicate and unknown id (999) removed

  const refusing = createClaudeAnswerer({ client: clientReturning({ stop_reason: "refusal", usage, parsed_output: null }) });
  await assert.rejects(refusing(input), AnalyzeError);

  const invalid = createClaudeAnswerer({ client: clientReturning({ stop_reason: "end_turn", usage, parsed_output: { answer: "" , sources: [] } }) });
  await assert.rejects(invalid(input), AnalyzeError);
});
