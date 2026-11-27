// Agent eval: runs the REAL model with the REAL tool definitions and input validation, against a
// fictional in-memory dataset (agent-cases.json), and checks the agent's DECISIONS:
//   - exactly the expected changes proposed (tool, application id, value), nothing more
//   - every id it changes was first returned by a search/read (no guessed ids)
//   - replies contain what they should; no markdown when plain text is expected
//   - accepts a rejection; finishes within the step limit
//
//   npm run eval:agent                 (needs ANTHROPIC_API_KEY in server/.env)
//   npm run eval:agent -- --runs=2 --case=bulk
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createClaudeAgentModel, MAX_STEPS, AGENT_MODEL } from "../src/ai/agent/loop.js";
import { TOOLS } from "../src/ai/agent/tools.js";
import { checkDates } from "../src/validation/applications.js";
import { costUsd } from "./checks.js";

const dir = new URL("./", import.meta.url);
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const runs = Number(args.runs ?? 1);
const suite = JSON.parse(await readFile(new URL("agent-cases.json", dir), "utf8"));
const model = createClaudeAgentModel({ today: () => suite.today });
if (!model) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to server/.env (never commit it).");
  process.exit(1);
}

// In-memory versions of the tools, with the same output format as src/ai/agent/tools.js.
const line = (a) =>
  `#${a.id} ${a.company_name} – ${a.role} | status ${a.status} | applied ${a.date_applied ?? "-"} | follow-up ${a.follow_up_date ?? "-"} | fit -`;
function fixtureTools(apps, seen) {
  const find = (id) => apps.find((a) => a.id === id);
  return {
    search_applications({ query, status }) {
      const q = query.trim().toLowerCase();
      const hits = apps.filter(
        (a) => (status === "any" || a.status === status) &&
          (!q || [a.company_name, a.role, a.job_description].some((t) => t.toLowerCase().includes(q))),
      );
      hits.forEach((a) => seen.add(a.id));
      return hits.length ? hits.map(line).join("\n") : "No applications match.";
    },
    get_application({ id }) {
      const a = find(id);
      if (!a) return `No application with id ${id}.`;
      seen.add(id);
      const { job_description: jd, ...rest } = a;
      return `${JSON.stringify(rest)}\n<job_description>\n${jd}\n</job_description>`;
    },
    preview(name, input) {
      const a = find(input.id);
      if (!a) return { error: `No application with id ${input.id}.` };
      if (name === "update_status" && a.status === input.status) return { error: `${a.company_name} is already "${input.status}".` };
      if (name === "set_follow_up_date") {
        const p = checkDates({ date_applied: a.date_applied, follow_up_date: input.date });
        if (p.length) return { error: p.map((x) => x.message).join("; ") };
      }
      return {};
    },
    apply(name, input) {
      const a = find(input.id);
      if (name === "update_status") a.status = input.status;
      else a.follow_up_date = input.date;
      return "Done.";
    },
  };
}

async function runCase(c) {
  const apps = structuredClone(suite.applications);
  const seen = new Set();
  const tools = fixtureTools(apps, seen);
  const messages = [{ role: "user", content: c.message }];
  const proposed = [];
  const guessed = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const started = Date.now();
  let reply = null;
  let steps = 0;
  let stop = null;

  while (steps < MAX_STEPS) {
    const r = await model(messages);
    steps++;
    usage.input_tokens += r.usage.input_tokens;
    usage.output_tokens += r.usage.output_tokens;
    messages.push({ role: "assistant", content: r.content });
    stop = r.stop_reason;
    if (r.stop_reason !== "tool_use") {
      reply = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      break;
    }
    const results = [];
    for (const b of r.content.filter((x) => x.type === "tool_use")) {
      const res = (content, is_error = false) => results.push({ type: "tool_result", tool_use_id: b.id, content, is_error });
      const tool = TOOLS[b.name];
      const parsed = tool?.input.safeParse(b.input);
      if (!tool || !parsed.success) {
        res(`Invalid input for ${b.name}.`, true);
        continue;
      }
      if (!tool.write) {
        res(tools[b.name](parsed.data));
        continue;
      }
      const p = tools.preview(b.name, parsed.data);
      if (p.error) {
        res(p.error, true);
        continue;
      }
      const value = b.name === "update_status" ? parsed.data.status : parsed.data.date;
      proposed.push([b.name, parsed.data.id, value]);
      if (!seen.has(parsed.data.id)) guessed.push(parsed.data.id);
      res(c.reject_writes ? "The user rejected this action. Do not propose it again." : tools.apply(b.name, parsed.data));
    }
    messages.push({ role: "user", content: results });
  }
  return { proposed, guessed, reply, steps, stop, usage, latencyMs: Date.now() - started };
}

function check(c, out) {
  const checks = [];
  const add = (name, pass, detail = "") => checks.push({ name, pass, detail });
  const key = (w) => w.join(" ");
  const e = c.expect;
  if (e.writes) {
    const want = e.writes.map(key).sort();
    const got = out.proposed.map(key).sort();
    add("exact changes proposed", JSON.stringify(want) === JSON.stringify(got), `expected [${want.join("; ")}], got [${got.join("; ")}]`);
  }
  if (e.max_writes !== undefined) add(`≤ ${e.max_writes} change proposed`, out.proposed.length <= e.max_writes, `${out.proposed.length}`);
  add("no guessed ids", out.guessed.length === 0, out.guessed.join(", "));
  add("finished", out.stop === "end_turn" && !!out.reply, `${out.stop} after ${out.steps} steps`);
  for (const item of e.reply_includes ?? []) {
    add(`reply mentions "${item}"`, item.split("|").some((alt) => (out.reply ?? "").toLowerCase().includes(alt.toLowerCase())));
  }
  // Every reply is shown as plain text in the UI, so markdown is checked on EVERY case
  // (the baseline only checked one case and missed that 12 of 28 replies used **bold**).
  add("plain text (no markdown)", !/\*\*|__|^#{1,6}\s/m.test(out.reply ?? ""));
  return checks;
}

const rows = [];
for (const c of suite.cases.filter((x) => !args.case || x.id.includes(args.case))) {
  for (let i = 1; i <= runs; i++) {
    const label = runs > 1 ? `${c.id} #${i}` : c.id;
    let out;
    let checks;
    try {
      out = await runCase(c);
      checks = check(c, out);
    } catch (err) {
      out = { error: err.message };
      checks = [{ name: "run succeeded", pass: false, detail: err.message }];
    }
    const pass = checks.every((k) => k.pass);
    rows.push({ id: label, pass, checks, ...out });
    console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(22)} ${out.steps ?? "-"} steps  ${out.latencyMs ?? "-"} ms`);
    for (const k of checks.filter((k) => !k.pass)) console.log(`        ✖ ${k.name}${k.detail ? ` (${k.detail})` : ""}`);
  }
}

const ok = rows.filter((r) => r.usage);
const sum = (f) => ok.reduce((s, r) => s + f(r), 0);
const passed = rows.filter((r) => r.pass).length;
const summary = {
  model: AGENT_MODEL,
  date: new Date().toISOString(),
  cases: rows.length,
  passed,
  pass_rate: `${Math.round((passed / rows.length) * 100)}%`,
  wrong_or_extra_changes: rows.filter((r) => r.checks.some((k) => k.name === "exact changes proposed" && !k.pass)).length,
  guessed_ids: rows.filter((r) => r.guessed?.length).length,
  avg_steps: Number((sum((r) => r.steps) / ok.length).toFixed(1)),
  avg_latency_ms: Math.round(sum((r) => r.latencyMs) / ok.length),
  total_cost_usd: Number(sum((r) => costUsd(r.usage)).toFixed(5)),
};
console.log("\n" + JSON.stringify(summary, null, 2));
await mkdir(new URL("results/", dir), { recursive: true });
const file = new URL(`results/agent-${summary.date.slice(0, 16).replace(/[:T]/g, "-")}.json`, dir);
// Save without the raw conversations (they include model internals); decisions and replies are enough.
await writeFile(file, JSON.stringify({ summary, rows: rows.map(({ id, pass, checks, proposed, guessed, reply, steps }) => ({ id, pass, checks, proposed, guessed, reply, steps })) }, null, 2));
console.log(`Saved ${file.pathname.split("/").slice(-2).join("/")}`);
