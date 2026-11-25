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
