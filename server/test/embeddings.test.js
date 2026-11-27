import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import pool from "../src/db.js";
import { createVoyageEmbedder, EmbedError, EMBEDDING_DIMENSIONS } from "../src/ai/embedder.js";
import { backfillEmbeddings } from "../src/ai/embeddings.js";
import { fakeAuth, resetDb, createUser, validApplication } from "./helpers.js";

// A fake embedder: no network, no key. Texts that share words get similar vectors
// (each word adds 1 to a slot chosen by hashing it), which is all similarity needs.
let calls = 0;
async function fakeEmbedder(texts) {
  calls += texts.length;
  return texts.map((text) => {
    const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      let h = 0;
      for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % EMBEDDING_DIMENSIONS;
      v[h] += 1;
    }
    v[0] += 0.01; // never an all-zero vector (cosine distance would be undefined)
    return v;
  });
}
fakeEmbedder.model = "fake-embed";

const app = createApp({ authenticate: fakeAuth, analyzer: null, embedder: fakeEmbedder });
let alice;
let bob;

beforeEach(async () => {
  await resetDb();
  calls = 0;
  alice = await createUser("alice@example.com");
  bob = await createUser("bob@example.com");
});
after(() => pool.end());

const as = (id) => ({
  post: (url, body) => request(app).post(url).set("x-test-user-id", String(id)).send(body),
  patch: (url, body) => request(app).patch(url).set("x-test-user-id", String(id)).send(body),
  get: (url) => request(app).get(url).set("x-test-user-id", String(id)),
});
const embeddingOf = async (id) =>
  (await pool.query("SELECT embedding::text AS e, embedding_model FROM applications WHERE id = $1", [id])).rows[0];

test("creating an application stores its embedding, and the API never returns the vector", async () => {
  const res = await as(alice).post("/api/applications", validApplication());
  assert.equal(res.status, 201);
  assert.equal("embedding" in res.body, false);
  const row = await embeddingOf(res.body.id);
  assert.ok(row.e.startsWith("["));
  assert.equal(row.embedding_model, "fake-embed");
});

test("only changes to role, company or description re-embed", async () => {
  const { body } = await as(alice).post("/api/applications", validApplication());
  const before = (await embeddingOf(body.id)).e;
  calls = 0;

  await as(alice).patch(`/api/applications/${body.id}`, { status: "applied" });
  assert.equal(calls, 0);

  await as(alice).patch(`/api/applications/${body.id}`, { job_description: "Kotlin Android mobile apps." });
  assert.equal(calls, 1);
  assert.notEqual((await embeddingOf(body.id)).e, before);
});

test("similar applications: closest in meaning first, own rows only, never itself", async () => {
  const react = (await as(alice).post("/api/applications", validApplication({ company_name: "A", role: "React developer", job_description: "React frontend with TypeScript and REST APIs." }))).body;
  await as(alice).post("/api/applications", validApplication({ company_name: "B", role: "Frontend developer", job_description: "React frontend, TypeScript, REST APIs, CSS." }));
  await as(alice).post("/api/applications", validApplication({ company_name: "C", role: "Accountant", job_description: "Payroll, audits and tax filing." }));
  await as(bob).post("/api/applications", validApplication({ company_name: "Bob's React job", role: "React developer", job_description: "React frontend with TypeScript and REST APIs." }));

  const res = await as(alice).get(`/api/applications/${react.id}/similar`);
  assert.equal(res.status, 200);
  assert.equal(res.body.available, true);
  assert.deepEqual(res.body.items.map((a) => a.company_name), ["B", "C"]); // B is closest; Bob's job never appears
  assert.ok(res.body.items[0].similarity > res.body.items[1].similarity);

  assert.equal((await as(bob).get(`/api/applications/${react.id}/similar`)).status, 404); // not Bob's
});

test("an embedding failure never blocks saving, and the backfill fills the gap later", async () => {
  const failing = createApp({ authenticate: fakeAuth, analyzer: null, embedder: Object.assign(async () => { throw new EmbedError("down"); }, { model: "fake-embed" }) });
  const res = await request(failing).post("/api/applications").set("x-test-user-id", String(alice)).send(validApplication());
  assert.equal(res.status, 201);
  assert.equal((await embeddingOf(res.body.id)).e, null);

  assert.equal(await backfillEmbeddings(fakeEmbedder), 1);
  assert.ok((await embeddingOf(res.body.id)).e);
  assert.equal(await backfillEmbeddings(fakeEmbedder), 0); // nothing left to do
});

test("without a Voyage key, similar says it's unavailable instead of failing", async () => {
  const noKey = createApp({ authenticate: fakeAuth, analyzer: null, embedder: null });
  const { body } = await request(noKey).post("/api/applications").set("x-test-user-id", String(alice)).send(validApplication());
  const res = await request(noKey).get(`/api/applications/${body.id}/similar`).set("x-test-user-id", String(alice));
  assert.deepEqual(res.body, { available: false, items: [] });
});

test("Voyage client: sends the right request and orders vectors by index", async () => {
  let sent;
  const vec = (x) => new Array(EMBEDDING_DIMENSIONS).fill(x);
  const fetchImpl = async (url, opts) => {
    sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ data: [{ index: 1, embedding: vec(2) }, { index: 0, embedding: vec(1) }] }) };
  };
  const embed = createVoyageEmbedder({ apiKey: "test-key", fetchImpl });
  const out = await embed(["first", "second"], "query");

  assert.equal(sent.url, "https://api.voyageai.com/v1/embeddings");
  assert.equal(sent.headers.Authorization, "Bearer test-key");
  assert.deepEqual(sent.body, { input: ["first", "second"], model: "voyage-4-lite", input_type: "query", output_dimension: 1024 });
  assert.equal(out[0][0], 1); // re-ordered by index
  assert.equal(out[1][0], 2);

  const failing = createVoyageEmbedder({ apiKey: "k", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "bad key" }) });
  await assert.rejects(failing(["x"]), EmbedError);
  assert.equal(createVoyageEmbedder({ apiKey: "" }), null);
});
