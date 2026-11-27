import { createApp } from "./app.js";
import { createVoyageEmbedder } from "./ai/embedder.js";
import { backfillEmbeddings } from "./ai/embeddings.js";

const PORT = process.env.PORT || 3000;
const embedder = createVoyageEmbedder();

createApp({ embedder }).listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);

  // In the background, embed any applications that don't have an embedding yet
  // (rows from before this feature, or saves where Voyage was briefly down).
  // Not awaited, so the server answers requests immediately.
  if (embedder) {
    backfillEmbeddings(embedder)
      .then((n) => n && console.log(`embed: backfilled ${n} application(s)`))
      .catch((err) => console.error("embed: backfill failed:", err.message));
  }
});
