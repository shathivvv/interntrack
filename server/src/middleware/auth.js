// Every route that needs a logged-in user runs `authenticate` first.
// Its only job: set req.user = { id } from the login session, or reply 401.
// Routes then use req.user.id and never read a user id from the request itself.
//
// B2 (25 Nov) replaces the body of this function with the real check
// (read the httpOnly cookie and verify it). Until then nobody is logged in,
// so the live API correctly refuses every protected route.
export function requireAuth(req, res, next) {
  res.status(401).json({ error: "Not logged in" });
}
