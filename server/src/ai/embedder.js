// Turns text into embedding vectors with Voyage AI (voyage-4-lite, 1024 numbers per text).
// Plain fetch instead of an SDK: it's one HTTP call, and every line of it is visible.
// Like the analyzer, it's injectable: tests pass a fake embedder, and it's null when
// VOYAGE_API_KEY isn't set (the app still works, just without similarity search).

export const EMBEDDING_MODEL = "voyage-4-lite";
export const EMBEDDING_DIMENSIONS = 1024;
const MAX_BATCH = 1000; // Voyage's limit on texts per request

export class EmbedError extends Error {}

export function createVoyageEmbedder({ apiKey = process.env.VOYAGE_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) return null;

  // texts: string[]; inputType: "document" when storing, "query" when searching.
  // Returns one vector (number[]) per text, in the same order.
  async function embed(texts, inputType = "document") {
    const vectors = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      let res;
      try {
        res = await fetchImpl("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input: batch, model: EMBEDDING_MODEL, input_type: inputType, output_dimension: EMBEDDING_DIMENSIONS }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new EmbedError(`Voyage request failed: ${err.message}`);
      }
      if (!res.ok) throw new EmbedError(`Voyage returned ${res.status}: ${(await res.text()).slice(0, 200)}`);

      const body = await res.json();
      // `index` says which input each vector belongs to; don't rely on the array order.
      const byIndex = [...body.data].sort((a, b) => a.index - b.index);
      if (byIndex.length !== batch.length || byIndex.some((d) => d.embedding.length !== EMBEDDING_DIMENSIONS)) {
        throw new EmbedError("Voyage returned an unexpected number or size of vectors");
      }
      vectors.push(...byIndex.map((d) => d.embedding));
    }
    return vectors;
  }
  embed.model = EMBEDDING_MODEL;
  return embed;
}
