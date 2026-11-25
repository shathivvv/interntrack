import { Router } from "express";
import bcrypt from "bcryptjs";
import pool from "../db.js";
import { registerSchema, loginSchema } from "../validation/auth.js";
import { validationError } from "../validation/applications.js";
import { SESSION_COOKIE, createSession, deleteSession, sessionCookieOptions } from "../auth/sessions.js";

// Work factor: each +1 doubles the time to hash, for us and for an attacker guessing.
// Tests lower it (BCRYPT_ROUNDS) so they run fast; production uses 12.
const rounds = () => Number(process.env.BCRYPT_ROUNDS) || 12;

// Used when the email doesn't exist, so a failed login takes the same time either way
// and the response time can't reveal which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

const INVALID_LOGIN = { error: "Invalid email or password" };

async function startSession(res, user) {
  const token = await createSession(user.id);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function authRouter({ authenticate }) {
  const router = Router();

  // POST /api/auth/register: create an account and log straight in.
  router.post("/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));

    const { email, password, name } = parsed.data;
    const passwordHash = await bcrypt.hash(password, rounds());

    let user;
    try {
      const { rows } = await pool.query(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name",
        [email, passwordHash, name ?? null],
      );
      user = rows[0];
    } catch (err) {
      // 23505 = unique_violation: the UNIQUE constraint on email did its job.
      if (err.code === "23505") return res.status(409).json({ error: "An account with this email already exists" });
      throw err;
    }

    await startSession(res, user);
    res.status(201).json(user);
  });

  // POST /api/auth/login
  router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));

    const { email, password } = parsed.data;
    const { rows } = await pool.query(
      "SELECT id, email, name, password_hash FROM users WHERE email = $1",
      [email],
    );
    const found = rows[0];

    // Always run one bcrypt compare, so "no such email" and "wrong password" look identical.
    const ok = await bcrypt.compare(password, found?.password_hash ?? DUMMY_HASH);
    if (!found || !ok) return res.status(401).json(INVALID_LOGIN);

    await startSession(res, found);
    res.json({ id: found.id, email: found.email, name: found.name });
  });

  // POST /api/auth/logout: delete the session row (so the token is dead everywhere) and the cookie.
  // Safe to call when already logged out, so it doesn't require a valid session.
  router.post("/logout", async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await deleteSession(token);
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.status(204).end();
  });

  // GET /api/auth/me: who am I? React calls this on page load, because it can't read
  // the httpOnly cookie itself.
  router.get("/me", authenticate, (req, res) => {
    res.json(req.user);
  });

  return router;
}
