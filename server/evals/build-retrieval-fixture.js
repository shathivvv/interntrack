// Embeds the eval job ads and questions ONCE with the real Voyage model and saves the vectors,
// so the retrieval test (test/retrieval.test.js) can run the real SQL in CI without an API key.
// Re-run whenever cases.json or retrieval-questions.json changes:
//
//   npm run eval:fixture     (needs VOYAGE_API_KEY in server/.env)
import { readFile, writeFile } from "node:fs/promises";
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

const docs = cases.map((c) => ({ id: c.id, company_name: c.company, role: c.role, job_description: c.job_description }));
const docVectors = await embed(docs.map(embeddingText), "document");
const questionVectors = await embed(questions.map((q) => q.q), "query");

// Rounded to 5 decimals: ~45% smaller file, no measurable change in cosine ranking.
const round = (v) => v.map((x) => Math.round(x * 1e5) / 1e5);
await writeFile(
  new URL("retrieval-fixture.json", dir),
  JSON.stringify({
    model: EMBEDDING_MODEL,
    created: new Date().toISOString(),
    docs: docs.map((d, i) => ({ ...d, embedding: round(docVectors[i]) })),
    questions: questions.map((q, i) => ({ ...q, embedding: round(questionVectors[i]) })),
  }),
);
console.log(`Saved retrieval-fixture.json: ${docs.length} docs, ${questions.length} questions (${EMBEDDING_MODEL})`);
