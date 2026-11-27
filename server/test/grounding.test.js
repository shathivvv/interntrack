// Tests for the production guardrails applied to every /analyze result.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGuardrails, isGrounded } from "../src/ai/grounding.js";

const resume = "Skills: JavaScript, React, Node.js, PostgreSQL, Docker, Python. Led a team of 20.";
const jobDescription = "We need Java, React and REST APIs. Spring is a plus. Good communication and teamwork.";

test("whole words and simple stems", () => {
  assert.equal(isGrounded("Java", "JavaScript developer"), false);
  assert.equal(isGrounded("REST APIs", "Build REST API integrations."), true);
  assert.equal(isGrounded("Process mapping", "Map existing processes"), true);
  assert.equal(isGrounded(".NET Core", "Experience with .NET Core."), true);
  assert.equal(isGrounded("HTML", "Frontend (HTML5, CSS3, React)"), true); // version numbers
  assert.equal(isGrounded("CSS", "Frontend (HTML5, CSS3, React)"), true);
});

test("hallucinated matches move to missing; invented requirements are dropped", () => {
  const fixed = applyGuardrails(
    {
      fit_score: 60,
      matched_skills: ["React", "Java", "Docker", "Spring"],
      missing_skills: ["REST APIs", "Kubernetes"],
      summary: "x",
    },
    { jobDescription, resume },
  );
  assert.deepEqual(fixed.matched_skills, ["React"]); // Java and Spring aren't in the resume; Docker isn't in the JD
  assert.deepEqual(fixed.missing_skills, ["Java", "Spring", "REST APIs"]); // Kubernetes isn't in the JD
});

test("a 'missing' skill the resume clearly lists moves to matched; half-matches don't", () => {
  const fixed = applyGuardrails(
    { fit_score: 70, matched_skills: ["React"], missing_skills: ["Laravel", "Distributed systems", "Java"], summary: "x" },
    {
      jobDescription: "React, Laravel or Java. Distributed systems experience.",
      resume: "React, Laravel and JavaScript. Built embedded systems.",
    },
  );
  assert.deepEqual(fixed.matched_skills, ["React", "Laravel"]);
  assert.deepEqual(fixed.missing_skills, ["Distributed systems", "Java"]); // "systems" alone isn't enough; Java ≠ JavaScript
});

test("weasel skill names and generic words don't count as evidence (third eval run)", () => {
  const fixed = applyGuardrails(
    { fit_score: 50, matched_skills: ["Java-adjacent backend development", "REST APIs", "Computer Vision"], missing_skills: [], summary: "x" },
    {
      jobDescription: "Java focus. Backend systems over REST. Computer Science degree required.",
      resume: "Built REST API development and backend development with Node.js. Computer vision project (YOLO).",
    },
  );
  assert.deepEqual(fixed.matched_skills, ["REST APIs"]);
  assert.deepEqual(fixed.missing_skills, ["Java-adjacent backend development"]); // "java" isn't on the resume
  // "Computer Vision" is dropped: only the generic word "computer" is in the JD.
});

test("no skill in both lists, and at most 3 soft skills", () => {
  const fixed = applyGuardrails(
    {
      fit_score: 60,
      matched_skills: ["React", "Communication", "Teamwork", "Leadership", "Problem solving"],
      missing_skills: ["React"],
      summary: "x",
    },
    { jobDescription: jobDescription + " leadership, problem solving", resume: resume + " communication teamwork leadership problem solving" },
  );
  assert.deepEqual(fixed.missing_skills, []);
  assert.equal(fixed.matched_skills.filter((s) => s !== "React").length, 3);
});
