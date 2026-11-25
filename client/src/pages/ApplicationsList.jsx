import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBanner, PageMessage, StatusBadge } from '../components.jsx'
import { daysBetween, todayInMalaysia } from '../constants.js'

const ACTIVE = ['saved', 'applied', 'interviewing', 'offer']

// Small labels worked out from the data, never stored (SPEC: ghosted is derived).
function hints(app, today) {
  const out = []
  if (app.status === 'applied' && app.date_applied && daysBetween(app.date_applied, today) > 30) {
    out.push({ text: 'Ghosted?', className: 'bg-slate-200 text-slate-600' })
  }
  if (app.follow_up_date && ACTIVE.includes(app.status)) {
    const days = daysBetween(today, app.follow_up_date)
    if (days < 0) out.push({ text: 'Follow-up overdue', className: 'bg-red-100 text-red-700' })
    else if (days <= 3) out.push({ text: days === 0 ? 'Follow up today' : `Follow up in ${days}d`, className: 'bg-amber-100 text-amber-800' })
  }
  return out
}

export default function ApplicationsList() {
  const { expire } = useAuth()
  const [apps, setApps] = useState(null) // null = still loading
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/applications')
      .then(setApps)
      .catch((err) => (err.status === 401 ? expire() : setError(err.message)))
  }, [expire])

  async function remove(app) {
    if (!window.confirm(`Delete ${app.company_name} – ${app.role}? This can't be undone.`)) return
    try {
      await api(`/applications/${app.id}`, { method: 'DELETE' })
      setApps(apps.filter((a) => a.id !== app.id)) // update the screen without re-fetching
    } catch (err) {
      if (err.status === 401) return expire()
      setError(err.message)
    }
  }

  if (apps === null && !error) return <PageMessage>Loading applications…</PageMessage>

  const today = todayInMalaysia()
  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">My applications</h1>
          {apps && <p className="text-sm text-slate-500">{apps.length} tracked</p>}
        </div>
        <Link to="/applications/new" className="btn-primary">
          + Add application
        </Link>
      </div>

      <ErrorBanner>{error}</ErrorBanner>

      {apps?.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="font-medium text-slate-800">No applications yet</p>
          <p className="mt-1 text-sm text-slate-500">Add the first job you've applied to, or one you're planning to.</p>
        </div>
      )}

      <ul className="space-y-3">
        {apps?.map((app) => (
          <li key={app.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/applications/${app.id}`} className="font-semibold text-slate-900 hover:text-indigo-600">
                  {app.company_name}
                </Link>
                <p className="text-sm text-slate-600">{app.role}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={app.status} />
                  {hints(app, today).map((h) => (
                    <span key={h.text} className={`rounded-full px-2 py-0.5 text-xs font-medium ${h.className}`}>
                      {h.text}
                    </span>
                  ))}
                  {app.location && <span className="text-xs text-slate-500">{app.location}</span>}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                {app.date_applied ? <p>Applied {app.date_applied}</p> : <p>Not applied yet</p>}
                {app.follow_up_date && <p>Follow up {app.follow_up_date}</p>}
                <div className="mt-2 flex justify-end gap-2">
                  <Link to={`/applications/${app.id}`} className="btn-secondary px-3 py-1 text-xs">
                    Edit
                  </Link>
                  <button onClick={() => remove(app)} className="btn-secondary px-3 py-1 text-xs text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
