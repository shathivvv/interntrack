import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './auth.jsx'
import { statusInfo } from './constants.js'

// Wraps pages that need a login. While /auth/me is still answering, show a spinner;
// if nobody is logged in, go to /login and remember where they were heading.
export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageMessage>Loading…</PageMessage>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

// The opposite: logged-in users don't need the login and register pages.
export function GuestOnly() {
  const { user, loading } = useAuth()
  if (loading) return <PageMessage>Loading…</PageMessage>
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}

export function Layout() {
  const { user, logout } = useAuth()
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-lg font-bold text-slate-900">
            Intern<span className="text-indigo-600">Track</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 md:inline">{user.email}</span>
            {/* Real buttons, not plain text: people only click what looks clickable.
                NavLink highlights the one for the page you're on. */}
            {[
              ['/ask', 'Ask'],
              ['/assistant', 'Assistant'],
              ['/profile', 'Profile'],
            ].map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `btn-secondary px-3 py-1.5 ${isActive ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : ''}`
                }
              >
                {label}
              </NavLink>
            ))}
            <button onClick={logout} className="btn-secondary px-3 py-1.5">
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

// The narrow centred card used by the login and register pages.
export function AuthCard({ title, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-2xl font-bold text-slate-900">
          Intern<span className="text-indigo-600">Track</span>
        </p>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-lg font-semibold text-slate-900">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  )
}

export function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

export function ErrorBanner({ children }) {
  if (!children) return null
  return <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div>
}

export function StatusBadge({ status }) {
  const info = statusInfo(status)
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${info.badge}`}>{info.label}</span>
}

export function PageMessage({ children }) {
  return <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">{children}</div>
}
