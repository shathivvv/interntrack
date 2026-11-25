import { z } from "zod";

export const STATUSES = ["saved", "applied", "interviewing", "offer", "accepted", "declined", "rejected", "withdrawn"];
export const METHODS = ["job_site", "email", "career_fair", "referral"];
export const INTERVIEW_ROUNDS = ["1", "2", "final"];

// Required text: trimmed, not empty, with a length cap.
const requiredText = (max) => z.string().trim().min(1, "Required").max(max);

// Optional text: may be missing or null. An empty string ("" from a cleared form field) is saved as null.
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional();

const optionalDate = z.iso.date("Use the format YYYY-MM-DD").nullable().optional();

// The full shape of an application as the client may send it.
// strictObject: unknown keys (a typo, or a sneaky "user_id") are rejected with 400, not ignored.
const applicationFields = z.strictObject({
  company_name: requiredText(200),
  role: requiredText(200),
  status: z.enum(STATUSES).optional(),
  // Capped because this text is sent to the LLM in B4: bigger input = higher cost per call.
  job_description: requiredText(20000),

  location: optionalText(200),
  salary: optionalText(100),
  date_applied: optionalDate,
  application_method: z.enum(METHODS).nullable().optional(),
  job_url: z.url({ protocol: /^https?$/ }).nullable().optional(),
  resume_version: optionalText(50),
  follow_up_date: optionalDate,
  interview_round: z.enum(INTERVIEW_ROUNDS).nullable().optional(),
  contact_name: optionalText(200),
  contact_email: z.email().nullable().optional(),
  contact_phone: optionalText(50),
});

// POST: required fields must be present.
export const createApplicationSchema = applicationFields;

// PATCH: every field optional, but at least one must be sent.
export const updateApplicationSchema = applicationFields
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field to update" });

// Query string for GET /api/applications: ?q=bank&status=applied&sort=follow_up
// Everything is optional; unknown values are a 400 rather than silently ignored.
export const SORTS = ["newest", "date_applied", "follow_up", "company"];
export const listQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  sort: z.enum(SORTS).default("newest"),
});

// Today's date in Malaysia as "YYYY-MM-DD" (en-CA formats dates that way).
function todayInMalaysia() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

// Rules that need more than one field, so they run on the final values:
// the request body for POST, and the existing row merged with the changes for PATCH.
// "YYYY-MM-DD" strings compare correctly as plain text, so no Date objects are needed.
export function checkDates({ date_applied, follow_up_date }) {
  const problems = [];
  if (date_applied && date_applied > todayInMalaysia()) {
    problems.push({ path: "date_applied", message: "Cannot be in the future" });
  }
  if (date_applied && follow_up_date && follow_up_date < date_applied) {
    problems.push({ path: "follow_up_date", message: "Cannot be before date_applied" });
  }
  return problems;
}

// Turns a ZodError into the API's error shape: { error, details: [{ path, message }] }.
export function validationError(zodError) {
  return {
    error: "Validation failed",
    details: zodError.issues.map((issue) => ({
      path: issue.path.join(".") || "(body)",
      message: issue.message,
    })),
  };
}
