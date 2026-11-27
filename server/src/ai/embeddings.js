// Keeping each application's embedding in sync with its text.
import pool from "../db.js";

// What gets embedded: the role and company give context the description alone might lack.
export const embeddingText = (app) => `${app.role} at ${app.company_name}\n\n${app.job_description}`;

// pgvector reads vectors written as text: "[0.1,0.2,...]".
export const toVectorLiteral = (vector) => `[${vector.join(",")}]`;

// Embeds one application and saves the vector. Never throws: a failed embedding must not
// fail the save the user just made (the backfill picks it up later). Returns true if saved.
export async function embedApplication(embedder, id) {
  if (!embedder) return false;
  try {
    const { rows } = await pool.query("SELECT role, company_name, job_description FROM applications WHERE id = $1", [id]);
    if (rows.length === 0) return false;
    const [vector] = await embedder([embeddingText(rows[0])], "document");
    await pool.query(
      "UPDATE applications SET embedding = $2::vector, embedded_at = now(), embedding_model = $3 WHERE id = $1",
      [id, toVectorLiteral(vector), embedder.model],
    );
    return true;
  } catch (err) {
    console.error(`embed: application ${id} failed: ${err.message}`);
    return false;
  }
}

// Embeds every application that has no embedding yet (or one from another model), in batches.
// Runs at server start, so rows created before this feature, or whose embedding failed, catch up.
export async function backfillEmbeddings(embedder, { batchSize = 50 } = {}) {
  if (!embedder) return 0;
  let total = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id, role, company_name, job_description FROM applications
       WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1
       ORDER BY id LIMIT $2`,
      [embedder.model, batchSize],
    );
    if (rows.length === 0) break;
    const vectors = await embedder(rows.map(embeddingText), "document");
    for (const [i, row] of rows.entries()) {
      await pool.query(
        "UPDATE applications SET embedding = $2::vector, embedded_at = now(), embedding_model = $3 WHERE id = $1",
        [row.id, toVectorLiteral(vectors[i]), embedder.model],
      );
    }
    total += rows.length;
  }
  return total;
}
