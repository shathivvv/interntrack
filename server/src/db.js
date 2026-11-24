import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy server/.env.example to server/.env and fill it in.");
}

// A pool keeps a few connections open and lends them out per query,
// instead of opening a new connection (slow, especially to a remote DB) every time.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export default pool;
