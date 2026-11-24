import { readdir, readFile } from "node:fs/promises";
import pool from "./db.js";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

// Runs every migrations/*.sql file that hasn't run yet, in filename order.
// schema_migrations records which files have run, so each one runs exactly once.
// Each file runs inside a transaction: if any statement fails, none of it is applied.
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name   text PRIMARY KEY,
        run_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const alreadyRun = new Set(rows.map((row) => row.name));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (alreadyRun.has(file)) continue;

      const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
}

// `npm run migrate` runs this file directly; tests import migrate() instead.
if (import.meta.main) {
  try {
    await migrate();
    console.log("Migrations up to date.");
  } finally {
    await pool.end();
  }
}
