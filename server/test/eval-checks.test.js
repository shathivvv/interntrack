// Tests for the eval rules themselves: if a check is wrong, every eval score built on it is wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCase, isGrounded, isSoftSkill, costUsd } from "../evals/checks.js";

const JD = "We need React, Node.js and REST APIs. Docker is a plus. Good communication skills.";
const result = (overrides) => ({ fit_score: 70, matched_skills: ["React"], missing_skills: ["Docker"], summary: "ok", ...overrides });
const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c.pass]));

test("grounding: skills must come from the job description", () => {
  assert.equal(isGrounded("React", JD), true);
  assert.equal(isGrounded("REST API Development", JD), true); // half the words are enough
  assert.equal(isGrounded("Kubernetes", JD), false); // invented requirement
});

test("checker bugs found in the first real run stay fixed", () => {
  // "Java" must not match "JavaScript".
  assert.equal(byName(checkCase({ never_match: ["Java"] }, result({ matched_skills: ["JavaScript"] }), "JavaScript"))['does not claim "Java"'], true);
  assert.equal(byName(checkCase({ never_match: ["Java"] }, result({ matched_skills: ["Java"] }), "Java"))['does not claim "Java"'], false);
  // Synonyms with "|".
  const rag = checkCase({ must_miss: ["RAG|Retrieval-Augmented Generation"] }, result({ missing_skills: ["Retrieval-Augmented Generation"] }), "Retrieval-Augmented Generation");
  assert.equal(rag[0].pass, true);
  // Stems: "Testing" is grounded by "test", ".NET Core" by ".NET".
  assert.equal(isGrounded("Testing", "Debug, test and deploy"), true);
  assert.equal(isGrounded(".NET Core", "SQL or NoSQL, .NET Core"), true);
});

test("soft-skill detector", () => {
  assert.equal(isSoftSkill("Communication & Collaboration"), true);
  assert.equal(isSoftSkill("Problem-solving"), true);
  assert.equal(isSoftSkill("PostgreSQL"), false);
});

test("expected-answer checks pass and fail correctly", () => {
  const expect = { score_range: [60, 80], must_match: ["React"], must_miss: ["Docker"], never_match: ["Java"] };
  assert.ok(checkCase(expect, result(), JD).every((c) => c.pass));

  const bad = byName(checkCase(expect, result({ fit_score: 95, matched_skills: ["Java", "Kubernetes"], missing_skills: [] }), JD));
  assert.equal(bad["score in range"], false);
  assert.equal(bad['matches "React"'], false);
  assert.equal(bad['lists "Docker" as missing'], false);
  assert.equal(bad['does not claim "Java"'], false);
  assert.equal(bad["skills come from the JD"], false); // Java and Kubernetes aren't in the JD
});

test("soft-skill padding is flagged", () => {
  const padded = result({ matched_skills: ["React", "Communication", "Teamwork", "Leadership", "Problem solving"] });
  assert.equal(byName(checkCase({}, padded, JD + " teamwork leadership problem solving"))["≤ 3 soft skills in matched"], false);
});

test("cost uses Haiku 5.5 prices", () => {
  assert.equal(costUsd({ input_tokens: 1_000_000, output_tokens: 0 }), 0.1);
  assert.equal(costUsd({ input_tokens: 2000, output_tokens: 400 }), 0.0004);
});

test("every eval case is well-formed", async () => {
  const { readFile } = await import("node:fs/promises");
  const suite = JSON.parse(await readFile(new URL("../evals/cases.json", import.meta.url), "utf8"));
  const ids = new Set();
  for (const c of suite.cases) {
    assert.ok(c.id && !ids.has(c.id), `unique id: ${c.id}`);
    ids.add(c.id);
    assert.ok(c.company && c.role && c.job_description.length > 100, `${c.id}: company, role and a real JD`);
    const [lo, hi] = c.expect.score_range;
    assert.ok(lo >= 0 && hi <= 100 && lo < hi, `${c.id}: valid score_range`);
  }
  assert.ok(suite.cases.length >= 10);
});
