import { Router } from "express";
import { z } from "zod";
import pool from "../db.js";
import { startRun, decide, publicRun, AgentError } from "../ai/agent/loop.js";
import { validationError } from "../validation/applications.js";

const startSchema = z.strictObject({ message: z.string().trim().min(3, "Say a bit more").max(1000) });
const decideSchema = z.strictObject({
  decisions: z.array(z.strictObject({ tool_use_id: z.string().min(1).max(200), approve: z.boolean() })).min(1).max(20),
});

const parseId = (raw) => (/^[1-9]\d{0,17}$/.test(raw) ? Number(raw) : null);

// POST /api/agent/runs           { message }                      → run
// POST /api/agent/runs/:id/decide { decisions: [{ tool_use_id, approve }] } → run
// GET  /api/agent/runs/:id                                         → run
export function agentRouter({ authenticate, agentModel }) {
  const router = Router();
  router.use(authenticate);

  router.use((req, res, next) =>
    agentModel ? next() : res.status(503).json({ error: "The assistant isn't configured on this server." }),
  );

  async function ownRun(req, res) {
    const id = parseId(req.params.id);
    const { rows } = id ? await pool.query("SELECT * FROM agent_runs WHERE id = $1 AND user_id = $2", [id, req.user.id]) : { rows: [] };
    if (rows.length === 0) res.status(404).json({ error: "Run not found" });
    return rows[0];
  }

  router.post("/runs", async (req, res) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));
    const run = await startRun(agentModel, req.user.id, parsed.data.message);
    res.status(201).json(publicRun(run));
  });

  router.get("/runs/:id", async (req, res) => {
    const run = await ownRun(req, res);
    if (run) res.json(publicRun(run));
  });

  router.post("/runs/:id/decide", async (req, res) => {
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationError(parsed.error));
    const run = await ownRun(req, res);
    if (!run) return;
    try {
      res.json(publicRun(await decide(agentModel, run, req.user.id, parsed.data.decisions)));
    } catch (err) {
      if (err instanceof AgentError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
