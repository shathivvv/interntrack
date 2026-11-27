// The rules an /analyze result is judged by. Pure functions (no network, no DB),
// so they're unit-tested like any other code in test/eval-checks.test.js.

// Words that describe soft skills. More than a few in "matched" means the model is
// padding the list with resume buzzwords instead of real technical matches.
const SOFT_SKILL_WORDS = [
  "communication", "teamwork", "team work", "collaboration", "leadership", "problem-solving",
  "problem solving", "analytical", "adaptab", "self-motivated", "proactive", "willing to learn",
  "curiosity", "ownership", "attention to detail", "detail-oriented", "time management",
  "interpersonal", "planning", "positive", "independent", "initiative",
];
export const MAX_SOFT_SKILLS = 3;

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const containsSkill = (list, wanted) => list.some((s) => norm(s).includes(norm(wanted)) || norm(wanted).includes(norm(s)));

export const isSoftSkill = (skill) => SOFT_SKILL_WORDS.some((w) => skill.toLowerCase().includes(w));

// A skill counts as grounded if at least half of its meaningful words appear in the job text.
// Loose on purpose: "REST API development" is grounded by a JD that says "REST APIs".
export function isGrounded(skill, jobDescription) {
  const jd = ` ${norm(jobDescription)} `;
  const words = norm(skill).split(" ").filter((w) => w.length > 2 || /[+#]/.test(w));
  if (words.length === 0) return true;
  const found = words.filter((w) => jd.includes(w.replace(/s$/, "")));
  return found.length / words.length >= 0.5;
}

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

  return out;
}

// Claude Haiku 5.5 list prices (USD per million tokens), for the cost column.
export const PRICE_PER_MTOK = { input: 0.1, output: 0.5 };
export const costUsd = ({ input_tokens, output_tokens }) =>
  (input_tokens * PRICE_PER_MTOK.input + output_tokens * PRICE_PER_MTOK.output) / 1e6;
