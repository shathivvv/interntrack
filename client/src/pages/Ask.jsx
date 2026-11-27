import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBanner, StatusBadge } from '../components.jsx'

const EXAMPLES = [
  'Which jobs ask for React?',
  'Which applications need a follow-up this week?',
  'Which internships mention AI or machine learning?',
  'What do the Java roles have in common?',
]

// "Ask your applications": a question in plain words, answered from your own data,
// with the applications it used shown as sources.
export default function Ask() {
  const { expire } = useAuth()
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(q) {
    const text = (q ?? question).trim()
    if (text.length < 3) return
    setQuestion(text)
    setBusy(true)
    setError(null)
    try {
      setResult(await api('/ask', { method: 'POST', body: { question: text } }))
    } catch (err) {
      if (err.status === 401) return expire()
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">Ask your applications</h1>
      <p className="mb-5 text-sm text-slate-500">Answers come only from your saved applications, with the ones used listed as sources.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <input
          className="input sm:flex-1"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Which jobs want React and pay over RM 1,500?"
          maxLength={500}
          aria-label="Your question"
        />
        <button className="btn-primary" disabled={busy || question.trim().length < 3}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => submit(ex)} disabled={busy}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <ErrorBanner>{error}</ErrorBanner>
      </div>

      {result && !busy && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-800">{result.answer}</p>

          {result.sources.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Sources ({result.sources.length})</h2>
              <ul className="space-y-1.5">
                {result.sources.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link to={`/applications/${s.id}`} className="font-medium text-indigo-700 hover:underline">{s.company_name}</Link>
                    <span className="text-slate-500">{s.role}</span>
                    <StatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-4 text-xs text-slate-400">
            Searched all your applications' details, plus the {result.retrieved.length} most relevant job descriptions. AI-generated: check the sources.
          </p>
        </section>
      )}
    </div>
  )
}
