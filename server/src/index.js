import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON request bodies (needed from B1 for POST/PATCH).
app.use(express.json());

// Every route lives under /api, so the Vite dev proxy and the Vercel rewrite
// can forward /api/* to this server without changing the path.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Unknown routes get the spec's error shape instead of Express's HTML page.
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
