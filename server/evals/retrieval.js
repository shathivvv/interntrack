// Retrieval eval: measures the SEARCH step of RAG on its own, no LLM involved.
// Ranks the 11 job descriptions from cases.json for each question by cosine similarity (the same maths pgvector does), and checks the expected jobs come back.
//
//   npm run eval:retrieval        (uses the saved vectors; vector-only. The vector-vs-hybrid
//                                  comparison with the real SQL is test/retrieval.test.js)
//
// Metrics:
//   hit@k     share of questions where at least one expected job is in the top k
//   recall@k  share of all expected jobs that appear in their question's top k
//   MRR       mean of 1/rank of the first expected job (1.0 = always ranked first)
import { readFile } from "node:fs/promises";

const dir = new URL("./", import.meta.url);
const { questions } = JSON.parse(await readFile(new URL("retrieval-questions.json", dir), "utf8"));

// Uses the vectors saved by `npm run eval:fixture`, so this costs no API calls (Voyage's free
// tier without a payment method allows only 3 requests a minute).
let fixture;
try {
  fixture = JSON.parse(await readFile(new URL("retrieval-fixture.json", dir), "utf8"));
} catch {
  console.error("No evals/retrieval-fixture.json yet. Run `npm run eval:fixture` first (needs VOYAGE_API_KEY).");
  process.exit(1);
}
const docs = fixture.docs.map((d) => ({ id: d.id }));
const docVectors = fixture.docs.map((d) => d.embedding);
const questionVectors = questions.map((q) => {
  const saved = fixture.questions.find((f) => f.q === q.q);
  if (!saved) throw new Error(`Question not in the fixture, re-run npm run eval:fixture: ${q.q}`);
  return saved.embedding;
});

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / Math.sqrt(na * nb);
};

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
  model: fixture.model,
  questions: questions.length,
  corpus: docs.length,
  ...Object.fromEntries(K.flatMap((k) => [[`hit@${k}`, pct(totals[k].hit, questions.length)], [`recall@${k}`, pct(totals[k].found, expectedTotal)]])),
  MRR: Number((rrSum / questions.length).toFixed(3)),
};
console.log("\n" + JSON.stringify(summary, null, 2));
