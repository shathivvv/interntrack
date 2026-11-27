import { Router } from "express";
import pool from "../db.js";
import {
  createApplicationSchema,
  updateApplicationSchema,
  checkDates,
  validationError,
  listQuerySchema,
  STATUSES,
} from "../validation/applications.js";
import { AnalyzeError } from "../ai/analyzer.js";
import { embedApplication } from "../ai/embeddings.js";

// The fields that make up the embedded text (see ai/embeddings.js).
const EMBEDDED_FIELDS = ["role", "company_name", "job_description"];

// Each allowed ?sort= value maps to a fixed ORDER BY. The user picks a key, never SQL text.
// "id DESC" at the end breaks ties, so the order is always the same between requests.
const ORDER_BY = {
  newest: "created_at DESC, id DESC",
  date_applied: "date_applied DESC NULLS LAST, id DESC",
  follow_up: "follow_up_date ASC NULLS LAST, id DESC",
  company: "lower(company_name) ASC, id DESC",
};

// In LIKE patterns, % and _ are wildcards. Escape them (and the escape character itself)
// so searching for "100%" finds the text "100%", not everything starting with "100".
const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

// Columns sent back to the client. user_id is left out: the client already knows who it is.
const COLUMNS = `id, company_name, role, status, job_description, location, salary,
  date_applied, application_method, job_url, resume_version, follow_up_date,
  interview_round, contact_name, contact_email, contact_phone, created_at, updated_at,
  analysis_result, fit_score, analyzed_at, analysis_model`;

// Used in PATCH: if the job description really changes, the saved analysis no longer
// describes it, so it's cleared (SPEC). The CASE compares against the OLD value, because
// every expression in an UPDATE's SET sees the row as it was before the update.
const clearAnalysisIfJdChanges = (p) =>
  ["analysis_result", "fit_score", "analyzed_at", "analysis_model"]
    .map((col) => `${col} = CASE WHEN job_description IS DISTINCT FROM ${p} THEN NULL ELSE ${col} END`)
    .join(", ");

// Turns ":id" into a positive whole number, or null if it isn't one.
// An invalid id is treated like a missing row (404): there's nothing at that address.
function parseId(raw) {
  return /^[1-9]\d{0,17}$/.test(raw) ? Number(raw) : null;
}

const notFound = (res) => res.status(404).json({ error: "Application not found" });

// `authenticate` runs before every route here and sets req.user (see middleware/auth.js).
// `analyzer` is the function that calls the LLM (ai/analyzer.js); tests pass a fake one.
// `embedder` turns text into vectors (ai/embedder.js); also injectable, also null without a key.
export function applicationsRouter({ authenticate, analyzer, embedder }) {
  const router = Router();
  router.use(authenticate);

  // GET /api/applications?q=&status=&sort= — list mine, optionally searched, filtered and sorted.
  router.get("/", async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));
    const { q, status, sort } = parsed.data;

    // Build the WHERE clause from fixed pieces; every user value goes in as a $n parameter.
    const conditions = ["user_id = $1"];
    const params = [req.user.id];
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      const p = `$${params.length}`;
      // ILIKE = case-insensitive LIKE. The same parameter is reused for each column.
      conditions.push(
        `(company_name ILIKE ${p} OR role ILIKE ${p} OR location ILIKE ${p} OR job_description ILIKE ${p})`,
      );
    }

    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM applications WHERE ${conditions.join(" AND ")} ORDER BY ${ORDER_BY[sort]}`,
      params,
    );
    res.json(rows);
  });

  // GET /api/applications/summary — how many of mine are in each status (for the filter chips).
  // Registered before "/:id", otherwise Express would treat "summary" as an id.
  router.get("/summary", async (req, res) => {
    const { rows } = await pool.query(
      "SELECT status, count(*)::int AS count FROM applications WHERE user_id = $1 GROUP BY status",
      [req.user.id],
    );
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const row of rows) byStatus[row.status] = row.count;
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    res.json({ total, by_status: byStatus });
  });

  // GET /api/applications/:id — one of mine.
  router.get("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return notFound(res);

    // Both conditions: someone else's application finds no row, so it's a 404, not a 403.
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM applications WHERE id = $1 AND user_id = $2`,
      [id, req.user.id],
    );
    if (rows.length === 0) return notFound(res);
    res.json(rows[0]);
  });

  // POST /api/applications — create one, owned by me.
  router.post("/", async (req, res) => {
    const parsed = createApplicationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));

    const problems = checkDates(parsed.data);
    if (problems.length) return res.status(400).json({ error: "Validation failed", details: problems });

    // Column names come from the validated object (only keys the schema allows),
    // values go in as $1, $2... parameters, never pasted into the SQL text.
    const fields = Object.keys(parsed.data);
    const values = Object.values(parsed.data);
    const columns = ["user_id", ...fields].join(", ");
    const placeholders = ["$1", ...fields.map((_, i) => `$${i + 2}`)].join(", ");

    const { rows } = await pool.query(
      `INSERT INTO applications (${columns}) VALUES (${placeholders}) RETURNING ${COLUMNS}`,
      [req.user.id, ...values],
    );
    // Embed it for similarity search. A failure is logged, never fails the save.
    await embedApplication(embedder, rows[0].id);
    res.status(201).json(rows[0]);
  });

  // PATCH /api/applications/:id — change only the fields sent.
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return notFound(res);

    const parsed = updateApplicationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));

    // The date rules depend on both dates, so check them against the row as it WILL be:
    // the current values, overwritten by whatever this request changes.
    const current = await pool.query(
      "SELECT date_applied, follow_up_date FROM applications WHERE id = $1 AND user_id = $2",
      [id, req.user.id],
    );
    if (current.rows.length === 0) return notFound(res);

    const problems = checkDates({ ...current.rows[0], ...parsed.data });
    if (problems.length) return res.status(400).json({ error: "Validation failed", details: problems });

    const fields = Object.keys(parsed.data);
    let setClause = fields.map((field, i) => `${field} = $${i + 3}`).join(", ");
    if (fields.includes("job_description")) {
      setClause += ", " + clearAnalysisIfJdChanges(`$${fields.indexOf("job_description") + 3}`);
    }
    const { rows } = await pool.query(
      `UPDATE applications SET ${setClause}, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${COLUMNS}`,
      [id, req.user.id, ...Object.values(parsed.data)],
    );
    if (rows.length === 0) return notFound(res); // deleted between the SELECT and the UPDATE
    // The embedding describes role + company + description; re-embed only if one of those changed.
    if (fields.some((f) => EMBEDDED_FIELDS.includes(f))) await embedApplication(embedder, id);
    res.json(rows[0]);
  });

  // GET /api/applications/:id/similar?limit=3: my other applications closest in meaning,
  // by cosine distance between embeddings (<=> is pgvector's cosine distance: 0 = same direction).
  router.get("/:id/similar", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return notFound(res);
    const limit = Math.min(Math.max(Number(req.query.limit) || 3, 1), 10);

    const own = await pool.query("SELECT embedding IS NOT NULL AS has FROM applications WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (own.rows.length === 0) return notFound(res);
    if (!embedder) return res.json({ available: false, items: [] });
    // Not embedded yet (created before this feature, or Voyage was down): embed it now.
    if (!own.rows[0].has && !(await embedApplication(embedder, id))) return res.json({ available: false, items: [] });

    const { rows } = await pool.query(
      `WITH target AS (SELECT embedding FROM applications WHERE id = $1 AND user_id = $2)
       SELECT a.id, a.company_name, a.role, a.status, a.fit_score,
              round((1 - (a.embedding <=> target.embedding))::numeric, 3)::float AS similarity
       FROM applications a, target
       WHERE a.user_id = $2 AND a.id <> $1 AND a.embedding IS NOT NULL
       ORDER BY a.embedding <=> target.embedding
       LIMIT $3`,
      [id, req.user.id, limit],
    );
    res.json({ available: true, items: rows });
  });

  // POST /api/applications/:id/analyze: ask the LLM how well my resume fits this job,
  // validate the answer, save it on the row and return the updated application.
  router.post("/:id/analyze", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return notFound(res);
    if (!analyzer) return res.status(503).json({ error: "AI analysis isn't configured on this server." });

    // One query gets the job (only if it's mine) and my resume.
    const { rows } = await pool.query(
      `SELECT a.company_name, a.role, a.job_description, u.resume_text
       FROM applications a JOIN users u ON u.id = a.user_id
       WHERE a.id = $1 AND a.user_id = $2`,
      [id, req.user.id],
    );
    if (rows.length === 0) return notFound(res);
    const job = rows[0];
    if (!job.resume_text) {
      return res.status(400).json({ error: "Add your resume on the Profile page first." });
    }

    let analysis;
    try {
      analysis = await analyzer({
        company: job.company_name,
        role: job.role,
        jobDescription: job.job_description,
        resume: job.resume_text,
      });
    } catch (err) {
      if (err instanceof AnalyzeError) return res.status(err.status).json({ error: err.message });
      throw err;
    }

    // Save only if the job description hasn't changed while the model was thinking:
    // otherwise the result would describe text that's no longer there.
    const saved = await pool.query(
      `UPDATE applications
       SET analysis_result = $3, fit_score = $4, analyzed_at = now(), analysis_model = $5
       WHERE id = $1 AND user_id = $2 AND job_description = $6
       RETURNING ${COLUMNS}`,
      [id, req.user.id, JSON.stringify(analysis.result), analysis.result.fit_score, analysis.model, job.job_description],
    );
    if (saved.rows.length === 0) {
      return res.status(409).json({ error: "The job changed while it was being analysed. Please try again." });
    }
    res.json(saved.rows[0]);
  });

  // DELETE /api/applications/:id — delete one of mine.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return notFound(res);

    const { rowCount } = await pool.query(
      "DELETE FROM applications WHERE id = $1 AND user_id = $2",
      [id, req.user.id],
    );
    if (rowCount === 0) return notFound(res);
    res.status(204).end();
  });

  return router;
}
