import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBanner, PageMessage, StatusBadge } from '../components.jsx'
import { STATUSES, daysBetween, todayInMalaysia } from '../constants.js'
import { FitBadge } from '../FitCard.jsx'

const ACTIVE = ['saved', 'applied', 'interviewing', 'offer']

const SORT_OPTIONS = [
  { value: 'newest', label: 'Recently added' },
  { value: 'follow_up', label: 'Follow-up date' },
  { value: 'date_applied', label: 'Date applied' },
  { value: 'company', label: 'Company A–Z' },
]

// Small labels worked out from the data, never stored (SPEC: ghosted is derived).
export function hints(app, today = todayInMalaysia()) {
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

  // The filters live in the URL (?q=&status=&sort=), so a refresh, Back/Forward
  // or a bookmark brings back exactly the same view.
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const sort = params.get('sort') ?? 'newest'

  const [apps, setApps] = useState(null) // null = first load not finished
  const [summary, setSummary] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0) // bump to re-fetch after a delete

  // What's typed in the box. It updates the URL 300 ms after typing stops ("debounce"),
  // so we send one request per pause, not one per keystroke.
  const [searchText, setSearchText] = useState(q)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText.trim() !== q) setFilter('q', searchText.trim())
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  function setFilter(key, value) {
    // Function form: start from the URL as it is *now*, not as it was when this
    // function was created (the debounce timer can fire after a chip was clicked).
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value && !(key === 'sort' && value === 'newest')) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: key === 'q' }, // typing shouldn't fill the Back history
    )
  }

  useEffect(() => {
    // If the filters change again before this answer arrives, ignore the old answer.
    // Without this, a slow early response could overwrite a newer one ("race condition").
    let ignore = false
    setRefreshing(true)
    const query = new URLSearchParams()
    if (q) query.set('q', q)
    if (status) query.set('status', status)
    if (sort !== 'newest') query.set('sort', sort)

    Promise.all([api(`/applications?${query}`), api('/applications/summary')])
      .then(([list, counts]) => {
        if (ignore) return
        setApps(list)
        setSummary(counts)
        setError(null)
      })
      .catch((err) => {
        if (ignore) return
        if (err.status === 401) return expire()
        setError(err.message)
      })
      .finally(() => !ignore && setRefreshing(false))
    return () => {
      ignore = true
    }
  }, [q, status, sort, reload, expire])

  async function remove(app) {
    if (!window.confirm(`Delete ${app.company_name} – ${app.role}? This can't be undone.`)) return
    try {
      await api(`/applications/${app.id}`, { method: 'DELETE' })
      setReload((n) => n + 1)
    } catch (err) {
      if (err.status === 401) return expire()
      setError(err.message)
    }
  }

  if (apps === null && !error) return <PageMessage>Loading applications…</PageMessage>

  const filtered = Boolean(q || status)
  const today = todayInMalaysia()

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">My applications</h1>
          {summary && (
            <p className="text-sm text-slate-500">
              {filtered ? `${apps.length} of ${summary.total} shown` : `${summary.total} tracked`}
              {refreshing && <span className="ml-2 text-slate-400">Updating…</span>}
            </p>
          )}
        </div>
        <Link to="/applications/new" className="btn-primary">+ Add application</Link>
      </div>

      {summary?.total > 0 && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="input sm:flex-1"
              type="search"
              placeholder="Search company, role, location or job description…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              aria-label="Search applications"
            />
            <select className="input sm:w-48" value={sort} onChange={(e) => setFilter('sort', e.target.value)} aria-label="Sort by">
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>Sort: {o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            <StatusChip active={!status} onClick={() => setFilter('status', '')} label="All" count={summary.total} />
            {STATUSES.filter((s) => summary.by_status[s.value] > 0 || status === s.value).map((s) => (
              <StatusChip key={s.value} active={status === s.value} onClick={() => setFilter('status', s.value)}
                label={s.label} count={summary.by_status[s.value]} />
            ))}
          </div>
        </div>
      )}

      <ErrorBanner>{error}</ErrorBanner>

      {summary?.total === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="font-medium text-slate-800">No applications yet</p>
          <p className="mt-1 text-sm text-slate-500">Add the first job you've applied to, or one you're planning to.</p>
        </div>
      )}

      {summary?.total > 0 && apps?.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="font-medium text-slate-800">Nothing matches these filters</p>
          <button className="mt-3 btn-secondary" onClick={() => { setSearchText(''); setParams({}) }}>Clear filters</button>
        </div>
      )}

      <ul className={`space-y-3 transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
        {apps?.map((app) => (
          <li key={app.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-200">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/applications/${app.id}`} className="font-semibold text-slate-900 hover:text-indigo-600">
                  {app.company_name}
                </Link>
                <p className="text-sm text-slate-600">{app.role}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={app.status} />
                  <FitBadge score={app.fit_score} />
                  {hints(app, today).map((h) => (
                    <span key={h.text} className={`rounded-full px-2 py-0.5 text-xs font-medium ${h.className}`}>{h.text}</span>
                  ))}
                  {app.location && <span className="text-xs text-slate-500">{app.location}</span>}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                {app.date_applied ? <p>Applied {app.date_applied}</p> : <p>Not applied yet</p>}
                {app.follow_up_date && <p>Follow up {app.follow_up_date}</p>}
                <div className="mt-2 flex justify-end gap-2">
                  <Link to={`/applications/${app.id}/edit`} className="btn-secondary px-3 py-1 text-xs">Edit</Link>
                  <button onClick={() => remove(app)} className="btn-secondary px-3 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusChip({ active, onClick, label, count }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label} <span className={active ? 'text-indigo-100' : 'text-slate-400'}>{count}</span>
    </button>
  )
}
