import { Router } from "express";
import pool from "../db.js";
import {
  createApplicationSchema,
  updateApplicationSchema,
  checkDates,
  validationError,
} from "../validation/applications.js";

// Columns sent back to the client. user_id is left out: the client already knows who it is.
const COLUMNS = `id, company_name, role, status, job_description, location, salary,
  date_applied, application_method, job_url, resume_version, follow_up_date,
  interview_round, contact_name, contact_email, contact_phone, created_at, updated_at`;

// Turns ":id" into a positive whole number, or null if it isn't one.
// An invalid id is treated like a missing row (404): there's nothing at that address.
function parseId(raw) {
  return /^[1-9]\d{0,17}$/.test(raw) ? Number(raw) : null;
}

const notFound = (res) => res.status(404).json({ error: "Application not found" });

// `authenticate` runs before every route here and sets req.user (see middleware/auth.js).
export function applicationsRouter({ authenticate }) {
  const router = Router();
  router.use(authenticate);

  // GET /api/applications — list mine, newest first.
  router.get("/", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM applications WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
      [req.user.id],
    );
    res.json(rows);
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
    const setClause = fields.map((field, i) => `${field} = $${i + 3}`).join(", ");
    // B4: when job_description changes, this will also clear the saved analysis (SPEC).
    const { rows } = await pool.query(
      `UPDATE applications SET ${setClause}, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${COLUMNS}`,
      [id, req.user.id, ...Object.values(parsed.data)],
    );
    if (rows.length === 0) return notFound(res); // deleted between the SELECT and the UPDATE
    res.json(rows[0]);
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
