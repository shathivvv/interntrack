// The "R" in RAG: given a question, collect what the model should read to answer it.
// Hybrid context (SPEC decision, B5):
//   1. facts: a compact line for EVERY application of this user (status, dates, salary...),
//      because vector search is bad at exact facts like "status = applied" or "overdue";
//   2. documents: the full job descriptions of the k most relevant applications, found by
//      HYBRID search: meaning (pgvector) fused with exact words (Postgres full-text).
import pool from "../db.js";
import { toVectorLiteral } from "./embeddings.js";

export const TOP_K = 5;

// Every application of this user, as short facts. Never includes another user's rows.
export async function loadFacts(userId) {
  const { rows } = await pool.query(
    `SELECT id, company_name, role, status, date_applied, follow_up_date, interview_round,
            salary, location, application_method, fit_score
     FROM applications WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

// How many candidates each search contributes before fusion.
const CANDIDATES = 20;

// Words that appear in almost every question about applications and say nothing about the job.
// Postgres already drops English stop words ("which", "for"); these are domain stop words.
const QUESTION_WORDS = new Set([
  "job", "jobs", "role", "roles", "intern", "interns", "internship", "internships", "application",
  "applications", "applied", "company", "companies", "position", "positions", "ask", "asks", "want",
  "wants", "need", "needs", "require", "requires", "mention", "mentions", "use", "uses", "list", "show",
]);

// Turns a question into an OR full-text query: "Which jobs ask for React?" → "react".
// Only plain letters and digits go in, so the user's text can never break the query syntax.
export function keywordQuery(question) {
  const words = (question.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !QUESTION_WORDS.has(w) && w.length > 1);
  return [...new Set(words)].join(" | ");
}

// Reciprocal Rank Fusion: each list votes 1 / (60 + rank) for its items; the sums decide the order.
// It only uses ranks, so a cosine similarity and a text-search score never need to be comparable.
export function fuseRanks(lists, k = 60) {
  const score = new Map();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// Hybrid retrieval: the user's applications closest in MEANING (embeddings) fused with the ones that
// contain the question's WORDS (full-text search), top k overall. Only this user's rows, always.
// mode "vector" | "keyword" | "hybrid" exists so the retrieval test can compare them.
export async function retrieveDocuments(embedder, userId, question, k = TOP_K, { mode = "hybrid" } = {}) {
  const lists = [];
  const similarity = new Map();

  if (embedder && mode !== "keyword") {
    const [vector] = await embedder([question], "query"); // "query" mode: tuned for searching
    const { rows } = await pool.query(
      `SELECT id, round((1 - (embedding <=> $2::vector))::numeric, 3)::float AS similarity
       FROM applications WHERE user_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector LIMIT $3`,
      [userId, toVectorLiteral(vector), CANDIDATES],
    );
    rows.forEach((r) => similarity.set(r.id, r.similarity));
    lists.push(rows.map((r) => r.id));
  }

  const terms = keywordQuery(question);
  if (terms && mode !== "vector") {
    const { rows } = await pool.query(
      `SELECT id FROM applications, to_tsquery('english', $2) AS q
       WHERE user_id = $1 AND search @@ q
       ORDER BY ts_rank_cd(search, q) DESC, id LIMIT $3`,
      [userId, terms, CANDIDATES],
    );
    lists.push(rows.map((r) => r.id));
  }

  const ids = fuseRanks(lists).slice(0, k);
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    "SELECT id, company_name, role, status, job_description FROM applications WHERE user_id = $1 AND id = ANY($2)",
    [userId, ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id), similarity: similarity.get(id) ?? null }));
}

// Formats the facts as one line per application, which is compact and easy for the model to scan.
export function formatFacts(facts) {
  const v = (x) => x ?? "-";
  return facts
    .map((a) =>
      [`#${a.id}`, a.company_name, a.role, `status: ${a.status}`, `applied: ${v(a.date_applied)}`,
       `follow-up: ${v(a.follow_up_date)}`, `interview round: ${v(a.interview_round)}`, `salary: ${v(a.salary)}`,
       `location: ${v(a.location)}`, `via: ${v(a.application_method)}`, `fit score: ${v(a.fit_score)}`].join(" | "),
    )
    .join("\n");
}
