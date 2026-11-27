import { Router } from "express";
import { z } from "zod";
import { AnalyzeError } from "../ai/analyzer.js";
import { loadFacts, retrieveDocuments } from "../ai/retrieval.js";
import { validationError, todayInMalaysia } from "../validation/applications.js";

const askSchema = z.strictObject({ question: z.string().trim().min(3, "Ask a longer question").max(500) });

// POST /api/ask { question } → { answer, sources: [{ id, company_name, role, status }], retrieved: [{ id, similarity }] }
export function askRouter({ authenticate, answerer, embedder }) {
  const router = Router();
  router.use(authenticate);

  router.post("/", async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));
    if (!answerer) return res.status(503).json({ error: "AI answers aren't configured on this server." });

    const { question } = parsed.data;
    const facts = await loadFacts(req.user.id); // only this user's rows, ever
    if (facts.length === 0) {
      // Nothing to search: answer without spending an AI call.
      return res.json({ answer: "You haven't added any applications yet.", sources: [], retrieved: [] });
    }

    let documents = [];
    try {
      documents = await retrieveDocuments(embedder, req.user.id, question);
    } catch (err) {
      // Embeddings down: still answer from the facts table, just without job descriptions.
      console.error("ask: retrieval failed:", err.message);
    }

    let out;
    try {
      out = await answerer({ question, facts, documents, today: todayInMalaysia() });
    } catch (err) {
      if (err instanceof AnalyzeError) return res.status(err.status).json({ error: err.message });
      throw err;
    }

    const byId = new Map(facts.map((f) => [f.id, f]));
    res.json({
      answer: out.answer,
      sources: out.sources.map((id) => {
        const f = byId.get(id);
        return { id, company_name: f.company_name, role: f.role, status: f.status };
      }),
      // Shown so you can see what the search found, even if the answer didn't use it.
      retrieved: documents.map((d) => ({ id: d.id, similarity: d.similarity })),
    });
  });

  return router;
}
