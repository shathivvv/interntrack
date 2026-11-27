// Retrieval eval: measures the SEARCH step of RAG on its own, no LLM involved.
// Embeds the 11 job descriptions from cases.json and each question with the real Voyage model,
// ranks by cosine similarity (the same maths pgvector does), and checks the expected jobs come back.
//
//   npm run eval:retrieval        (needs VOYAGE_API_KEY in server/.env)
//
// Metrics:
//   hit@k     share of questions where at least one expected job is in the top k
//   recall@k  share of all expected jobs that appear in their question's top k
//   MRR       mean of 1/rank of the first expected job (1.0 = always ranked first)
import { readFile } from "node:fs/promises";
import { createVoyageEmbedder, EMBEDDING_MODEL } from "../src/ai/embedder.js";
import { embeddingText } from "../src/ai/embeddings.js";

const dir = new URL("./", import.meta.url);
const { cases } = JSON.parse(await readFile(new URL("cases.json", dir), "utf8"));
const { questions } = JSON.parse(await readFile(new URL("retrieval-questions.json", dir), "utf8"));

const embed = createVoyageEmbedder();
if (!embed) {
  console.error("VOYAGE_API_KEY is not set. Add it to server/.env (never commit it).");
  process.exit(1);
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / Math.sqrt(na * nb);
};

// The same text the app embeds for a real application.
const docs = cases.map((c) => ({ id: c.id, text: embeddingText({ role: c.role, company_name: c.company, job_description: c.job_description }) }));
const docVectors = await embed(docs.map((d) => d.text), "document");
const questionVectors = await embed(questions.map((q) => q.q), "query");

const K = [1, 3, 5];
const totals = Object.fromEntries(K.map((k) => [k, { hit: 0, found: 0 }]));
let expectedTotal = 0;
let rrSum = 0;

for (const [i, { q, expected }] of questions.entries()) {
  const ranked = docs
    .map((d, j) => ({ id: d.id, score: cosine(questionVectors[i], docVectors[j]) }))
    .sort((a, b) => b.score - a.score);
  const rankOf = (id) => ranked.findIndex((r) => r.id === id) + 1;
  const firstRank = Math.min(...expected.map(rankOf));

  expectedTotal += expected.length;
  rrSum += 1 / firstRank;
  for (const k of K) {
    const inTop = expected.filter((id) => rankOf(id) <= k).length;
    totals[k].found += inTop;
    if (inTop > 0) totals[k].hit++;
  }
  const top3 = ranked.slice(0, 3).map((r) => `${r.id} ${r.score.toFixed(2)}`).join(", ");
  console.log(`${firstRank === 1 ? "✔" : firstRank <= 5 ? "~" : "✖"} rank ${firstRank}  ${q}\n      top 3: ${top3}`);
}

const pct = (n, d) => `${Math.round((n / d) * 100)}%`;
const summary = {
  model: EMBEDDING_MODEL,
  questions: questions.length,
  corpus: docs.length,
  ...Object.fromEntries(K.flatMap((k) => [[`hit@${k}`, pct(totals[k].hit, questions.length)], [`recall@${k}`, pct(totals[k].found, expectedTotal)]])),
  MRR: Number((rrSum / questions.length).toFixed(3)),
};
console.log("\n" + JSON.stringify(summary, null, 2));
