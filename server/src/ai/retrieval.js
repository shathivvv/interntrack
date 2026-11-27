// The "R" in RAG: given a question, collect what the model should read to answer it.
// Hybrid context (SPEC decision, B5):
//   1. facts: a compact line for EVERY application of this user (status, dates, salary...),
//      because vector search is bad at exact facts like "status = applied" or "overdue";
//   2. documents: the full job descriptions of the k applications most similar in meaning.
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

// The k applications of this user whose embeddings are closest to the question's.
// Returns [] when embeddings aren't available; the model then answers from facts alone.
export async function retrieveDocuments(embedder, userId, question, k = TOP_K) {
  if (!embedder) return [];
  const [vector] = await embedder([question], "query"); // "query" mode: tuned for searching
  const { rows } = await pool.query(
    `SELECT id, company_name, role, status, job_description,
            round((1 - (embedding <=> $2::vector))::numeric, 3)::float AS similarity
     FROM applications
     WHERE user_id = $1 AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [userId, toVectorLiteral(vector), k],
  );
  return rows;
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
