// The rules an /analyze result is judged by. Pure functions (no network, no DB),
// so they're unit-tested like any other code in test/eval-checks.test.js.
// Text matching is shared with the production guardrails (src/ai/grounding.js), so the
// eval and the app agree on what "grounded" and "soft skill" mean.
import { norm, isGrounded, isSoftSkill, MAX_SOFT_SKILLS } from "../src/ai/grounding.js";

export { isGrounded, isSoftSkill, MAX_SOFT_SKILLS };

// Whole-word match, so "Java" does NOT match "JavaScript" (a bug in the first version).
// An expected skill may list synonyms with "|", e.g. "RAG|Retrieval-Augmented Generation".
const hasPhrase = (text, phrase) => ` ${norm(text)} `.includes(` ${norm(phrase)} `);
export const containsSkill = (list, wanted) =>
  wanted.split("|").some((alias) => list.some((s) => hasPhrase(s, alias) || hasPhrase(alias, s)));

// Runs every check for one case. Returns [{ name, pass, detail }].
export function checkCase(expect, result, jobDescription) {
  const out = [];
  const add = (name, pass, detail = "") => out.push({ name, pass, detail });
  const { matched_skills: matched, missing_skills: missing, fit_score: score } = result;

  if (expect.score_range) {
    const [lo, hi] = expect.score_range;
    add("score in range", score >= lo && score <= hi, `got ${score}, expected ${lo}–${hi}`);
  }
  for (const s of expect.must_match ?? []) add(`matches "${s}"`, containsSkill(matched, s));
  for (const s of expect.must_miss ?? []) add(`lists "${s}" as missing`, containsSkill(missing, s));
  for (const s of expect.never_match ?? []) add(`does not claim "${s}"`, !containsSkill(matched, s));

  // Automatic checks that apply to every case.
  const ungrounded = [...matched, ...missing].filter((s) => !isGrounded(s, jobDescription));
  add("skills come from the JD", ungrounded.length === 0, ungrounded.length ? `not in JD: ${ungrounded.join(", ")}` : "");
  const soft = matched.filter(isSoftSkill);
  add(`≤ ${MAX_SOFT_SKILLS} soft skills in matched`, soft.length <= MAX_SOFT_SKILLS, soft.length ? `${soft.length}: ${soft.join(", ")}` : "");
  const both = matched.filter((m) => missing.some((x) => norm(x) === norm(m)));
  add("no skill in both lists", both.length === 0, both.join(", "));

  return out;
}

// Claude Haiku 5.5 list prices (USD per million tokens), for the cost column.
export const PRICE_PER_MTOK = { input: 0.1, output: 0.5 };
export const costUsd = ({ input_tokens, output_tokens }) =>
  (input_tokens * PRICE_PER_MTOK.input + output_tokens * PRICE_PER_MTOK.output) / 1e6;
