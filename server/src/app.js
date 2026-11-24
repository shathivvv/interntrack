import express from "express";
import pool from "./db.js";

// The app is built here and started in index.js, so tests can import it
// and call routes with supertest without opening a real port.
const app = express();

// Parse JSON request bodies into req.body (needed for POST/PATCH).
app.use(express.json());

// Every route lives under /api, so the Vite dev proxy and the Vercel rewrite
// can forward /api/* to this server without changing the path.
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "ok" });
  } catch (err) {
    console.error("Health check: database unreachable:", err.message);
    res.status(503).json({ error: "Database unavailable" });
  }
});

// Unknown routes get the spec's error shape instead of Express's HTML page.
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
