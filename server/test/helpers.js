import pool from "../src/db.js";

// Fake authentication for tests: the test says who is "logged in" with a header.
// Only tests use this. The real app uses requireAuth, which ignores this header.
export function fakeAuth(req, res, next) {
  const id = req.get("x-test-user-id");
  if (!id) return res.status(401).json({ error: "Not logged in" });
  req.user = { id: Number(id) };
  next();
}

// Empty every table and restart the id counters, so each test starts from a known state.
// This is why tests run against the `test` Neon branch / CI's throwaway database, never dev.
export async function resetDb() {
  await pool.query("TRUNCATE users, applications, sessions RESTART IDENTITY CASCADE");
}

export async function createUser(email) {
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-real-hash') RETURNING id",
    [email],
  );
  return rows[0].id;
}

// A minimal valid application body; tests override fields as needed.
export function validApplication(overrides = {}) {
  return {
    company_name: "LuuWu Solutions",
    role: "AI Research & Implementation Intern",
    job_description: "Build AI agents and IDP tools for supply chain warehouses.",
    ...overrides,
  };
}
