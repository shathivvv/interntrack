// The tools the agent may use. Each has:
//   definition  what Claude sees (name, description, JSON schema; strict = schema-valid input)
//   input       a Zod schema: the input is validated AGAIN here, because model output is untrusted
//   write       true if it changes data → it never runs without your approval
//   run         reads: runs immediately and returns text for the model
//   preview/apply  writes: preview builds the approval card; apply makes the change after approval
// Every query filters by the user id from the session. The model never chooses whose data it sees:
// passing another user's application id simply finds nothing.
import { z } from "zod";
import pool from "../../db.js";
import { STATUSES, checkDates } from "../../validation/applications.js";

const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const id = z.number().int().positive();

async function ownApplication(userId, appId) {
  const { rows } = await pool.query(
    `SELECT id, company_name, role, status, date_applied, follow_up_date, interview_round, salary,
            location, application_method, job_url, contact_name, contact_email, fit_score, job_description
     FROM applications WHERE id = $1 AND user_id = $2`,
    [appId, userId],
  );
  return rows[0] ?? null;
}

const line = (a) =>
  `#${a.id} ${a.company_name} – ${a.role} | status ${a.status} | applied ${a.date_applied ?? "-"} | ` +
  `follow-up ${a.follow_up_date ?? "-"} | fit ${a.fit_score ?? "-"}`;

export const TOOLS = {
  search_applications: {
    write: false,
    definition: {
      name: "search_applications",
      description:
        "Search the user's job applications. Returns one line per application (id, company, role, status, dates, fit score). " +
        "Use an empty query to list everything. Use this before referring to an application by id.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words to find in company, role or job description; empty for all" },
          status: { type: "string", enum: ["any", ...STATUSES], description: "Only this status, or 'any'" },
        },
        required: ["query", "status"],
        additionalProperties: false,
      },
      strict: true,
    },
    input: z.strictObject({ query: z.string().max(100), status: z.enum(["any", ...STATUSES]) }),
    async run(userId, { query, status }) {
      const params = [userId];
      const where = ["user_id = $1"];
      if (status !== "any") {
        params.push(status);
        where.push(`status = $${params.length}`);
      }
      if (query.trim()) {
        params.push(`%${escapeLike(query.trim())}%`);
        const p = `$${params.length}`;
        where.push(`(company_name ILIKE ${p} OR role ILIKE ${p} OR job_description ILIKE ${p})`);
      }
      const { rows } = await pool.query(
        `SELECT id, company_name, role, status, date_applied, follow_up_date, fit_score
         FROM applications WHERE ${where.join(" AND ")} ORDER BY id LIMIT 30`,
        params,
      );
      return rows.length ? rows.map(line).join("\n") : "No applications match.";
    },
  },

  get_application: {
    write: false,
    definition: {
      name: "get_application",
      description: "Get the full details of one of the user's applications, including the job description and contact.",
      input_schema: {
        type: "object",
        properties: { id: { type: "integer", description: "Application id from search_applications" } },
        required: ["id"],
        additionalProperties: false,
      },
      strict: true,
    },
    input: z.strictObject({ id }),
    async run(userId, { id: appId }) {
      const a = await ownApplication(userId, appId);
      if (!a) return `No application with id ${appId}.`;
      const { job_description: jd, ...rest } = a;
      // The job description is someone else's text: data for the model, never instructions.
      return `${JSON.stringify(rest)}\n<job_description>\n${jd.slice(0, 4000)}\n</job_description>`;
    },
  },

  update_status: {
    write: true,
    definition: {
      name: "update_status",
      description: "Change an application's status. Needs the user's approval before it takes effect.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "integer" },
          status: { type: "string", enum: STATUSES },
        },
        required: ["id", "status"],
        additionalProperties: false,
      },
      strict: true,
    },
    input: z.strictObject({ id, status: z.enum(STATUSES) }),
    async preview(userId, { id: appId, status }) {
      const a = await ownApplication(userId, appId);
      if (!a) return { error: `No application with id ${appId}.` };
      if (a.status === status) return { error: `${a.company_name} is already "${status}".` };
      return { summary: `Change ${a.company_name} (${a.role}) status: ${a.status} → ${status}` };
    },
    async apply(userId, { id: appId, status }) {
      const { rowCount } = await pool.query(
        "UPDATE applications SET status = $3, updated_at = now() WHERE id = $1 AND user_id = $2",
        [appId, userId, status],
      );
      return rowCount ? `Done: status is now "${status}".` : `No application with id ${appId}.`;
    },
  },

  set_follow_up_date: {
    write: true,
    definition: {
      name: "set_follow_up_date",
      description: "Set the date to follow up on an application (YYYY-MM-DD). Needs the user's approval.",
      input_schema: {
        type: "object",
        properties: { id: { type: "integer" }, date: { type: "string", description: "YYYY-MM-DD" } },
        required: ["id", "date"],
        additionalProperties: false,
      },
      strict: true,
    },
    input: z.strictObject({ id, date: z.iso.date() }),
    async preview(userId, { id: appId, date }) {
      const a = await ownApplication(userId, appId);
      if (!a) return { error: `No application with id ${appId}.` };
      const problems = checkDates({ date_applied: a.date_applied, follow_up_date: date });
      if (problems.length) return { error: problems.map((p) => `${p.path}: ${p.message}`).join("; ") };
      return { summary: `Set ${a.company_name} (${a.role}) follow-up date: ${a.follow_up_date ?? "none"} → ${date}` };
    },
    async apply(userId, { id: appId, date }) {
      const { rowCount } = await pool.query(
        "UPDATE applications SET follow_up_date = $3, updated_at = now() WHERE id = $1 AND user_id = $2",
        [appId, userId, date],
      );
      return rowCount ? `Done: follow-up date is now ${date}.` : `No application with id ${appId}.`;
    },
  },
};

export const TOOL_DEFINITIONS = Object.values(TOOLS).map((t) => t.definition);
