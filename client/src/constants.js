// Same values as the server's Zod schemas and the database CHECK constraints.
export const STATUSES = [
  { value: 'saved', label: 'Saved', badge: 'bg-slate-100 text-slate-700' },
  { value: 'applied', label: 'Applied', badge: 'bg-blue-100 text-blue-800' },
  { value: 'interviewing', label: 'Interviewing', badge: 'bg-violet-100 text-violet-800' },
  { value: 'offer', label: 'Offer', badge: 'bg-amber-100 text-amber-800' },
  { value: 'accepted', label: 'Accepted', badge: 'bg-green-100 text-green-800' },
  { value: 'declined', label: 'Declined', badge: 'bg-slate-200 text-slate-700' },
  { value: 'rejected', label: 'Rejected', badge: 'bg-red-100 text-red-800' },
  { value: 'withdrawn', label: 'Withdrawn', badge: 'bg-slate-200 text-slate-700' },
]

export const METHODS = [
  { value: 'job_site', label: 'Job site' },
  { value: 'email', label: 'Email' },
  { value: 'career_fair', label: 'Career fair' },
  { value: 'referral', label: 'Referral' },
]

export const INTERVIEW_ROUNDS = [
  { value: '1', label: 'Round 1' },
  { value: '2', label: 'Round 2' },
  { value: 'final', label: 'Final' },
]

export const statusInfo = (value) => STATUSES.find((s) => s.value === value) ?? STATUSES[0]

// Today in Malaysia as "YYYY-MM-DD", the same rule the server uses for "not in the future".
export function todayInMalaysia() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })
}

// Whole days from date a to date b, both "YYYY-MM-DD". Using UTC avoids daylight-saving and timezone shifts.
export function daysBetween(a, b) {
  const toUtc = (s) => Date.UTC(...s.split('-').map((n, i) => (i === 1 ? n - 1 : Number(n))))
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}
