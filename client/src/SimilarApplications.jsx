import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from './api.js'
import { StatusBadge } from './components.jsx'
import { FitBadge } from './FitCard.jsx'

// "Similar applications": my other jobs closest in meaning to this one, found by comparing
// embeddings in the database. Shows nothing if embeddings aren't available or there are no others.
export default function SimilarApplications({ id }) {
  const [items, setItems] = useState(null)

  useEffect(() => {
    let ignore = false
    setItems(null)
    api(`/applications/${id}/similar?limit=3`)
      .then((res) => !ignore && setItems(res.available ? res.items : []))
      .catch(() => !ignore && setItems([])) // a nice-to-have panel: fail quietly
    return () => {
      ignore = true
    }
  }, [id])

  if (!items || items.length === 0) return null

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Similar applications</h2>
      <p className="mb-3 text-xs text-slate-500">Closest in meaning to this job description, found with embeddings.</p>
      <ul className="divide-y divide-slate-100">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <Link to={`/applications/${a.id}`} className="min-w-0 text-sm hover:text-indigo-600">
              <span className="font-medium text-slate-900">{a.company_name}</span>
              <span className="text-slate-500"> · {a.role}</span>
            </Link>
            <div className="flex items-center gap-2">
              <StatusBadge status={a.status} />
              <FitBadge score={a.fit_score} />
              <span className="w-12 text-right text-xs text-slate-500 tabular-nums" title="Cosine similarity">
                {Math.round(a.similarity * 100)}%
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
