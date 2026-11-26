import { useState } from 'react'
import { Link } from 'react-router'
import { api } from './api.js'

// Same bands as the prompt's rubric, so the colour means what the model was told.
export function fitBand(score) {
  if (score >= 80) return { label: 'Strong fit', className: 'bg-green-100 text-green-800' }
  if (score >= 60) return { label: 'Good fit', className: 'bg-blue-100 text-blue-800' }
  if (score >= 40) return { label: 'Partial fit', className: 'bg-amber-100 text-amber-800' }
  return { label: 'Weak fit', className: 'bg-red-100 text-red-700' }
}

export function FitBadge({ score }) {
  if (score === null || score === undefined) return null
  const band = fitBand(score)
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${band.className}`}>Fit {score}</span>
}

// The "Analyze fit" panel on the detail page. onUpdated receives the saved application.
export function FitCard({ app, onUpdated, onUnauthorized }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const analysis = app.analysis_result

  async function analyze() {
    setBusy(true)
    setError(null)
    try {
      onUpdated(await api(`/applications/${app.id}/analyze`, { method: 'POST' }))
    } catch (err) {
      if (err.status === 401) return onUnauthorized()
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const needsResume = error?.includes('Profile page')

  return (
    <section className="mb-5 rounded-xl border border-indigo-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">AI fit check</h2>
          <p className="text-xs text-slate-500">
            {analysis
              ? `Analysed ${new Date(app.analyzed_at).toLocaleString('en-GB')} · compares this job with your saved resume`
              : 'Compares this job description with the resume on your Profile page.'}
          </p>
        </div>
        <button onClick={analyze} disabled={busy} className={analysis ? 'btn-secondary' : 'btn-primary'}>
          {busy ? 'Analysing… (about 5–10 s)' : analysis ? 'Re-analyse' : 'Analyze fit'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}{' '}
          {needsResume && <Link to="/profile" className="font-medium underline">Open Profile</Link>}
        </p>
      )}

      {analysis && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold ${fitBand(analysis.fit_score).className}`}>
              {analysis.fit_score}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{fitBand(analysis.fit_score).label}</p>
              <p className="text-sm text-slate-700">{analysis.summary}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SkillList title="You match" items={analysis.matched_skills} className="bg-green-50 text-green-800" empty="No matching skills found." />
            <SkillList title="Missing" items={analysis.missing_skills} className="bg-amber-50 text-amber-800" empty="Nothing obvious missing." />
          </div>
          <p className="text-xs text-slate-400">AI-generated: a starting point for tailoring your resume, not a verdict.</p>
        </div>
      )}
    </section>
  )
}

function SkillList({ title, items, className, empty }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">{title} ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((skill) => (
            <li key={skill} className={`rounded-md px-2 py-0.5 text-xs font-medium ${className}`}>{skill}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
