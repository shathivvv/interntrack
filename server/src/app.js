import express from "express";
import pool from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import { applicationsRouter } from "./routes/applications.js";

// Builds the Express app. index.js starts it; tests import it and call routes
// with supertest without opening a real port.
//
// `authenticate` is injectable: production uses the real requireAuth, and tests pass
// a fake that sets req.user directly, the same idea as FakeOCR in the FYP tests.
export function createApp({ authenticate = requireAuth } = {}) {
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

  app.use("/api/applications", applicationsRouter({ authenticate }));

  // Unknown routes get the spec's error shape instead of Express's HTML page.
  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Error handler (4 arguments). Express 5 sends errors from async routes here too.
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Request body is not valid JSON" });
    }
    // Log the details for us; never send internals (SQL, stack traces) to the client.
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}
