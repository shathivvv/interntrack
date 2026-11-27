// Re-checks a saved run with the current checker, without calling the model again.
//   node evals/rescore.js results/<file>.json
import { readFile } from "node:fs/promises";
import { checkCase } from "./checks.js";

const run = JSON.parse(await readFile(new URL(process.argv[2], new URL("./", import.meta.url)), "utf8"));
const suite = JSON.parse(await readFile(new URL("cases.json", import.meta.url), "utf8"));
let passed = 0;
const byCheck = {};
for (const row of run.rows.filter((r) => r.result)) {
  const c = suite.cases.find((c) => c.id === row.id.split(" ")[0]);
  const checks = checkCase(c.expect, row.result, c.job_description);
  if (checks.every((k) => k.pass)) passed++;
  for (const k of checks) {
    const kind = k.name.replace(/".*"/, '"…"');
    byCheck[kind] ??= [0, 0];
    byCheck[kind][1]++;
    if (k.pass) byCheck[kind][0]++;
  }
}
console.log(`${passed}/${run.rows.length} cases pass`);
for (const [k, [p, t]] of Object.entries(byCheck)) console.log(`  ${k.padEnd(28)} ${p}/${t}`);
