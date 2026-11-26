import { Router } from "express";
import pool from "../db.js";
import { profileSchema } from "../validation/auth.js";
import { validationError } from "../validation/applications.js";

const PROFILE_COLUMNS = "id, email, name, resume_text";

// The logged-in user's own profile. There is no :id in the URL: you can only ever
// read or change yourself, so there's no id to guess and no ownership to check.
export function profileRouter({ authenticate }) {
  const router = Router();
  router.use(authenticate);

  // GET /api/profile
  router.get("/", async (req, res) => {
    const { rows } = await pool.query(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1`, [req.user.id]);
    res.json(rows[0]);
  });

  // PATCH /api/profile: change only the fields sent.
  router.patch("/", async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));

    // Keys come from the strict schema (only name and resume_text); values are parameters.
    const fields = Object.keys(parsed.data);
    const setClause = fields.map((field, i) => `${field} = $${i + 2}`).join(", ");
    const { rows } = await pool.query(
      `UPDATE users SET ${setClause} WHERE id = $1 RETURNING ${PROFILE_COLUMNS}`,
      [req.user.id, ...Object.values(parsed.data)],
    );
    res.json(rows[0]);
  });

  return router;
}
