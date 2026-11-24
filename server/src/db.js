import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy server/.env.example to server/.env and fill it in.");
}

// Return DATE columns as plain "YYYY-MM-DD" strings. By default pg turns them into
// JavaScript Date objects at local midnight, and JSON then shifts them to UTC:
// in Malaysia (UTC+8), 2026-11-24 would come back as "2026-11-23T16:00:00.000Z".
// 1082 is Postgres's internal type id for DATE.
pg.types.setTypeParser(1082, (value) => value);

// Return BIGINT (type id 20) as a JavaScript number. pg defaults to a string because
// numbers above 2^53 lose precision in JS; our ids and counts will never get near that,
// and a string id ("1") would make the client's `id === 1` checks fail silently.
pg.types.setTypeParser(20, (value) => Number(value));

// A pool keeps a few connections open and lends them out per query,
// instead of opening a new connection (slow, especially to a remote DB) every time.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export default pool;
