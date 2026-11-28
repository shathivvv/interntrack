// Retrieval quality test: real Voyage embeddings (saved in evals/retrieval-fixture.json), the real
// SQL (pgvector + Postgres full-text), no API key needed. Compares vector-only search with hybrid,
// and fails if hybrid ever gets worse than vector-only or drops below the agreed floor.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pool from "../src/db.js";
import { retrieveDocuments, keywordQuery, fuseRanks } from "../src/ai/retrieval.js";
import { toVectorLiteral } from "../src/ai/embeddings.js";
import { resetDb, createUser } from "./helpers.js";

const fixture = JSON.parse(await readFile(new URL("../evals/retrieval-fixture.json", import.meta.url), "utf8").catch(() => "null"));
const K = 5;
let userId;
const dbId = new Map(); // case id → application id

before(async () => {
  if (!fixture) return;
  await resetDb();
  userId = await createUser("retrieval@example.com");
  for (const d of fixture.docs) {
    const { rows } = await pool.query(
      `INSERT INTO applications (user_id, company_name, role, job_description, embedding, embedding_model)
       VALUES ($1, $2, $3, $4, $5::vector, $6) RETURNING id`,
      [userId, d.company_name, d.role, d.job_description, toVectorLiteral(d.embedding), fixture.model],
    );
    dbId.set(d.id, rows[0].id);
  }
});
after(() => pool.end());

// The "embedder" returns the question's saved real vector, so ranking matches production exactly.
const embedderFor = (q) => Object.assign(async () => [q.embedding], { model: fixture.model });

async function measure(mode) {
  let hits = 0;
  let found = 0;
  let expected = 0;
  const misses = [];
  for (const q of fixture.questions) {
    const docs = await retrieveDocuments(embedderFor(q), userId, q.q, K, { mode });
    const got = new Set(docs.map((d) => d.id));
    const want = q.expected.map((id) => dbId.get(id));
    const inTop = want.filter((id) => got.has(id)).length;
    expected += want.length;
    found += inTop;
    if (inTop > 0) hits++;
    if (inTop < want.length) misses.push(`${q.q} (${inTop}/${want.length})`);
  }
  return { hitRate: hits / fixture.questions.length, recall: found / expected, misses };
}

test("pure helpers: keyword query is safe; rank fusion rewards agreement", () => {
  assert.equal(keywordQuery("Which jobs ask for React?"), "which | for | react");
  assert.match(keywordQuery("x'; DROP TABLE users;--"), /^[a-z0-9 |]*$/); // only plain words reach to_tsquery
  assert.deepEqual(fuseRanks([[1, 2, 3], [3, 4, 1]]), [1, 3, 2, 4]);
});

test("hybrid search finds what vector search misses, and never does worse", { skip: !fixture && "no retrieval fixture yet" }, async () => {
  const vector = await measure("vector");
  const hybrid = await measure("hybrid");
  console.log(`vector: hit@${K} ${(vector.hitRate * 100).toFixed(0)}%, recall@${K} ${(vector.recall * 100).toFixed(0)}%  misses: ${vector.misses.join("; ") || "none"}`);
  console.log(`hybrid: hit@${K} ${(hybrid.hitRate * 100).toFixed(0)}%, recall@${K} ${(hybrid.recall * 100).toFixed(0)}%  misses: ${hybrid.misses.join("; ") || "none"}`);

  assert.ok(hybrid.recall >= vector.recall, "hybrid must not lose relevant jobs");
  assert.ok(hybrid.hitRate >= 0.9, "at least 90% of questions find a relevant job in the top 5");
});

test("another user's applications are never retrieved", { skip: !fixture && "no retrieval fixture yet" }, async () => {
  const other = await createUser("other@example.com");
  const q = fixture.questions[0];
  assert.deepEqual(await retrieveDocuments(embedderFor(q), other, q.q, K), []);
});
