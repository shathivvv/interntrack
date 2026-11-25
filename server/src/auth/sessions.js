import { randomBytes, createHash } from "node:crypto";
import pool from "../db.js";

export const SESSION_COOKIE = "sid";
export const SESSION_DAYS = 7;

// The cookie holds a random token; the database holds only its SHA-256 hash.
// A fast hash is fine here (unlike passwords) because the token is 32 random bytes:
// there's nothing to guess, so slowing down guessing adds no protection.
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  // Tidy up this user's expired sessions while we're here.
  await pool.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()", [userId]);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, hashToken(token), SESSION_DAYS],
  );
  return token;
}

// Returns { id, email, name } for a valid, unexpired session, or null.
export async function findSessionUser(token) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(token) {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

// httpOnly: JavaScript in the page can't read it, so an injected script can't steal it.
// secure: only sent over HTTPS (on in production; localhost dev is plain http).
// sameSite lax: not sent on requests that other sites trigger in the background (CSRF protection).
// No `domain`: the cookie belongs to whatever site the browser sees, which through the
// Vercel rewrite is the Vercel domain, so it's first-party.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
}
