import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBanner, PageMessage, StatusBadge } from '../components.jsx'
import { INTERVIEW_ROUNDS, METHODS } from '../constants.js'
import { hints } from './ApplicationsList.jsx'
import { FitCard } from '../FitCard.jsx'
import SimilarApplications from '../SimilarApplications.jsx'

const labelOf = (list, value) => list.find((o) => o.value === value)?.label ?? value

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { expire } = useAuth()
  const [app, setApp] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let ignore = false
    api(`/applications/${id}`)
      .then((row) => !ignore && setApp(row))
      .catch((err) => {
        if (ignore) return
        if (err.status === 401) return expire()
        setError(err)
      })
    return () => {
      ignore = true
    }
  }, [id, expire])

  async function remove() {
    if (!window.confirm(`Delete ${app.company_name} – ${app.role}? This can't be undone.`)) return
    try {
      await api(`/applications/${app.id}`, { method: 'DELETE' })
      navigate('/')
    } catch (err) {
      if (err.status === 401) return expire()
      setError(err)
    }
  }

  if (error?.status === 404) {
    return (
      <PageMessage>
        Application not found. <Link to="/" className="ml-1 text-indigo-600 hover:underline">Back to the list</Link>
      </PageMessage>
    )
  }
  if (!app && !error) return <PageMessage>Loading…</PageMessage>
  if (!app) return <ErrorBanner>{error.message}</ErrorBanner>

  // Only show the rows that have a value.
  const facts = [
    ['Applied', app.date_applied],
    ['Follow up', app.follow_up_date],
    ['Applied via', app.application_method && labelOf(METHODS, app.application_method)],
    ['Interview round', app.interview_round && labelOf(INTERVIEW_ROUNDS, app.interview_round)],
    ['Location', app.location],
    ['Salary', app.salary],
    ['Resume version', app.resume_version],
    ['Contact', [app.contact_name, app.contact_email, app.contact_phone].filter(Boolean).join(' · ')],
  ].filter(([, value]) => value)

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">← All applications</Link>

      <div className="mt-2 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{app.company_name}</h1>
          <p className="text-slate-600">{app.role}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={app.status} />
            {hints(app).map((h) => (
              <span key={h.text} className={`rounded-full px-2 py-0.5 text-xs font-medium ${h.className}`}>{h.text}</span>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/applications/${app.id}/edit`} className="btn-primary">Edit</Link>
          <button onClick={remove} className="btn-secondary text-red-600 hover:bg-red-50">Delete</button>
        </div>
      </div>

      <ErrorBanner>{error?.message}</ErrorBanner>

      <FitCard app={app} onUpdated={setApp} onUnauthorized={expire} />

      {facts.length > 0 && (
        <dl className="mb-5 grid gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
              <dd className="text-sm text-slate-900">{value}</dd>
            </div>
          ))}
          {app.job_url && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">Job link</dt>
              <dd className="truncate text-sm">
                {/* rel="noopener noreferrer": the opened page can't control this tab or see where it came from. */}
                <a href={app.job_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{app.job_url}</a>
              </dd>
            </div>
          )}
        </dl>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Job description</h2>
        {/* whitespace-pre-wrap keeps the line breaks from the pasted ad. React escapes the text,
            so anything HTML-like in an ad is shown as text, never run. */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">{app.job_description}</p>
      </section>

      <SimilarApplications id={app.id} />

      <p className="mt-4 text-xs text-slate-400">
        Added {new Date(app.created_at).toLocaleDateString('en-GB')} · Last updated {new Date(app.updated_at).toLocaleDateString('en-GB')}
      </p>
    </div>
  )
}
