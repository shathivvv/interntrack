// Deterministic guardrails applied to every /analyze result after the model answers.
// The prompt *asks* the model to follow these rules; this code *enforces* them.
// (The first eval run showed the model claiming Java, C#, Azure and PyTorch that the resume
// doesn't have, and padding "matched" with resume skills the job never asked for.)

// Lowercase, keep letters/digits/+/#, and keep dots only inside names like "node.js" and ".net"
// (a full stop at the end of a sentence must not stick to the word: "APIs." → "apis").
export const norm = (s) =>
  s.toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/(^|\s)\.(?!net)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Crude stemming, applied to BOTH the skill and the text, so "testing" matches "test",
// "APIs" matches "API", "mapping" matches "map" and "processes" matches "process".
// Whole words only, so "java" never matches "javascript".
function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3).replace(/([b-df-hj-np-tv-z])\1$/, "$1"); // mapping → map
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2); // documented → document
  if (w.endsWith("sses")) w = w.slice(0, -2); // processes → process
  // Plural "s", also on short words (APIs → api), but not "ss" (class) or "us"/"is" (status, redis).
  else if (w.length > 3 && /[^su]s$/.test(w) && !w.endsWith("is")) w = w.slice(0, -1); // services → service
  return w;
}
// Every word of the text, as written and stemmed.
function wordForms(text) {
  const out = new Set();
  for (const w of norm(text).split(" ").filter(Boolean)) {
    out.add(w).add(stem(w));
    // "HTML5" and "CSS3" count as "HTML" and "CSS" (a bug the second eval run caught).
    if (/^[a-z]+\d+$/.test(w)) out.add(w.replace(/\d+$/, ""));
  }
  return out;
}
// The forms of a skill word to look for: as written, stemmed, and with or without a plural "s".
const variants = (w) => [w, stem(w), `${w}s`, `${w}es`, w.replace(/e?s$/, "")];

// Generic words that say nothing about a specific skill. They don't count as evidence:
// "Computer Vision" must not be grounded by a JD that only says "Computer Science",
// and "Java-adjacent backend development" must not count as matched because the
// resume says "backend development" (both found by the third eval run).
const GENERIC = new Set([
  "computer", "science", "development", "developer", "experience", "skill", "skills", "knowledge",
  "basic", "basics", "fundamental", "fundamentals", "practice", "practices", "system", "systems",
  "related", "field", "degree", "bachelor", "understanding", "familiarity", "strong", "good", "work",
  "adjacent", "and", "the", "with", "for", "using",
]);
function meaningfulWords(skill) {
  const words = norm(skill).split(/[\s-]+/).filter((w) => w.length > 2 || /[+#]/.test(w) || w === "c");
  const specific = words.filter((w) => !GENERIC.has(w));
  return specific.length ? specific : words;
}
const found = (inText, w) => variants(w).some((v) => inText.has(v));

// A skill counts as present in a text if at least half of its meaningful words appear there.
// Loose on purpose: "REST API development" is grounded by text that says "REST APIs".
export function isGrounded(skill, text) {
  const inText = wordForms(text);
  const words = meaningfulWords(skill);
  if (words.length === 0) return true;
  return words.filter((w) => found(inText, w)).length / words.length >= 0.5;
}

const SOFT_SKILL_WORDS = [
  "communication", "teamwork", "team work", "collaboration", "leadership", "problem-solving",
  "problem solving", "analytical", "adaptab", "self-motivated", "proactive", "willing to learn",
  "curiosity", "ownership", "attention to detail", "detail-oriented", "time management",
  "interpersonal", "planning", "positive", "independent", "initiative", "stakeholder",
];
export const MAX_SOFT_SKILLS = 3;
export const isSoftSkill = (skill) => SOFT_SKILL_WORDS.some((w) => skill.toLowerCase().includes(w));

const sameSkill = (a, b) => norm(a) === norm(b);

// Stricter than isGrounded: EVERY meaningful word of the skill appears in the text.
// Used for the resume side, so "Java-adjacent backend development" (no "java" in the resume)
// isn't a match, and "Distributed systems" isn't promoted from a resume that says "embedded systems".
function wholeNameIn(skill, text) {
  const inText = wordForms(text);
  return meaningfulWords(skill).every((w) => found(inText, w));
}

// Returns a corrected copy of the model's result:
// 1. drops skills the job description doesn't mention (invented requirements);
// 2. moves "matched" skills the resume doesn't show into "missing" (hallucinated matches);
// 3. never lists the same skill in both lists;
// 4. keeps at most MAX_SOFT_SKILLS soft skills in "matched".
export function applyGuardrails(result, { jobDescription, resume }) {
  const matched = [];
  const missing = [];
  let soft = 0;

  for (const skill of result.matched_skills) {
    if (!isGrounded(skill, jobDescription)) continue;
    // Technical skills need every meaningful word on the resume; soft skills only need a mention.
    const onResume = isSoftSkill(skill) ? isGrounded(skill, resume) : wholeNameIn(skill, resume);
    if (!onResume) {
      missing.push(skill);
      continue;
    }
    if (isSoftSkill(skill) && ++soft > MAX_SOFT_SKILLS) continue;
    matched.push(skill);
  }
  for (const skill of result.missing_skills) {
    if (!isGrounded(skill, jobDescription)) continue;
    if (matched.some((m) => sameSkill(m, skill)) || missing.some((m) => sameSkill(m, skill))) continue;
    // The reverse mistake: calling a skill "missing" when the resume clearly lists it
    // (the eval caught "Laravel" listed as missing for a resume that names Laravel).
    // Soft skills stay where the model put them: a keyword alone isn't evidence of those.
    if (!isSoftSkill(skill) && isGrounded(skill, resume) && wholeNameIn(skill, resume)) {
      matched.push(skill);
      continue;
    }
    missing.push(skill);
  }
  return { ...result, matched_skills: matched, missing_skills: missing };
}
