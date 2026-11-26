import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email"));

// bcrypt only uses the first 72 BYTES of a password and silently ignores the rest,
// so longer passwords are rejected instead of being quietly shortened.
const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Use at most 72 bytes");

export const registerSchema = z.strictObject({
  email,
  password,
  name: z.string().trim().max(100).optional(),
});

// Login doesn't re-check password rules: a wrong password is just a wrong password.
export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, "Required"),
});

// PATCH /api/profile. Email and password changes are left out on purpose: they need
// re-authentication and are on the cut list. An empty name or resume clears the value.
const clearable = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .nullable()
    .optional();

export const profileSchema = z
  .strictObject({
    name: clearable(100),
    // Capped for the same reason as job descriptions: it's sent to the LLM in /analyze.
    resume_text: clearable(20000),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field to update" });
