import { SESSION_COOKIE, findSessionUser, sessionCookieOptions } from "../auth/sessions.js";

// Runs before every route that needs a logged-in user.
// Reads the session cookie, looks it up, and sets req.user = { id, email, name }, or replies 401.
// Routes use req.user.id and never read a user id from the request body, URL or headers.
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "Not logged in" });

  const user = await findSessionUser(token);
  if (!user) {
    // Expired or logged-out session: tell the browser to drop the stale cookie.
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    return res.status(401).json({ error: "Not logged in" });
  }

  req.user = user;
  next();
}
