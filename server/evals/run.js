// Runs every case in cases.json through the REAL analyzer (Claude), checks each answer,
// and prints a pass/fail table with tokens, latency and cost.
//
//   npm run eval                    all cases, once each
//   npm run eval -- --case=xenber   cases whose id contains "xenber"
//   npm run eval -- --runs=3        each case 3 times (LLM answers vary between runs)
//
// Needs ANTHROPIC_API_KEY in server/.env. A full run of 11 cases costs well under one US cent.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createClaudeAnalyzer, ANALYSIS_MODEL } from "../src/ai/analyzer.js";
import { checkCase, costUsd } from "./checks.js";

const dir = new URL("./", import.meta.url);
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const runs = Number(args.runs ?? 1);

const suite = JSON.parse(await readFile(new URL("cases.json", dir), "utf8"));
const resume = await readFile(new URL(suite.resume_file, dir), "utf8");
const cases = suite.cases.filter((c) => !args.case || c.id.includes(args.case));

const analyze = createClaudeAnalyzer();
if (!analyze) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to server/.env (never commit it).");
  process.exit(1);
}

const rows = [];
for (const c of cases) {
  for (let run = 1; run <= runs; run++) {
    const label = runs > 1 ? `${c.id} #${run}` : c.id;
    try {
      const out = await analyze({ company: c.company, role: c.role, jobDescription: c.job_description, resume });
      const checks = checkCase(c.expect, out.result, c.job_description);
      rows.push({ id: label, pass: checks.every((k) => k.pass), score: out.result.fit_score, checks, result: out.result,
        tokens: out.usage, latencyMs: out.latencyMs, cost: costUsd(out.usage) });
    } catch (err) {
      rows.push({ id: label, pass: false, error: err.message, checks: [{ name: "call succeeded", pass: false, detail: err.message }] });
    }
    const r = rows.at(-1);
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${label.padEnd(24)} score ${String(r.score ?? "-").padStart(3)}  ${r.latencyMs ?? "-"} ms`);
    for (const k of r.checks.filter((k) => !k.pass)) console.log(`        ✖ ${k.name}${k.detail ? ` (${k.detail})` : ""}`);
  }
}

// Summary: overall pass rate, and how often each kind of check passed.
const passed = rows.filter((r) => r.pass).length;
const byCheck = {};
for (const r of rows) for (const k of r.checks) {
  const kind = k.name.replace(/".*"/, '"…"');
  byCheck[kind] ??= { pass: 0, total: 0 };
  byCheck[kind].total++;
  if (k.pass) byCheck[kind].pass++;
}
const ok = rows.filter((r) => r.tokens);
const sum = (f) => ok.reduce((s, r) => s + f(r), 0);
const summary = {
  model: ANALYSIS_MODEL,
  date: new Date().toISOString(),
  cases: rows.length,
  passed,
  pass_rate: `${Math.round((passed / rows.length) * 100)}%`,
  checks: Object.fromEntries(Object.entries(byCheck).map(([k, v]) => [k, `${v.pass}/${v.total}`])),
  avg_latency_ms: ok.length ? Math.round(sum((r) => r.latencyMs) / ok.length) : null,
  total_tokens: { input: sum((r) => r.tokens.input_tokens), output: sum((r) => r.tokens.output_tokens) },
  total_cost_usd: Number(sum((r) => r.cost).toFixed(5)),
};
console.log("\n" + JSON.stringify(summary, null, 2));

// Save the full run, so before/after comparisons use real numbers.
await mkdir(new URL("results/", dir), { recursive: true });
const file = new URL(`results/${summary.date.slice(0, 16).replace(/[:T]/g, "-")}.json`, dir);
await writeFile(file, JSON.stringify({ summary, rows }, null, 2));
console.log(`Saved ${file.pathname.split("/").slice(-2).join("/")}`);
