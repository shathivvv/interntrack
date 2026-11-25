// The one place the app talks to the server.
// Paths are relative ("/api/..."), so the request goes to whatever site the page came from:
// the Vite proxy in development, the Vercel rewrite in production. The browser attaches
// the httpOnly session cookie automatically; this code never sees or touches it.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.details = body?.details ?? []; // [{ path, message }] from validation errors
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return null // e.g. DELETE, logout: no body

  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

// Turns validation details into { fieldName: message } for showing under each input.
export function fieldErrors(error) {
  return Object.fromEntries((error?.details ?? []).map((d) => [d.path, d.message]))
}
