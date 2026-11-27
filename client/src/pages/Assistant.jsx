import { useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBanner } from '../components.jsx'

const EXAMPLES = [
  'Which of my applications need a follow-up this week?',
  'Draft a short follow-up email for my WORQ application',
  'Set a follow-up date one week after each application I sent yesterday',
]

const TOOL_LABELS = {
  search_applications: 'Searched your applications',
  get_application: 'Read an application',
  update_status: 'Status change',
  set_follow_up_date: 'Follow-up date change',
}

// The assistant: it reads your applications freely, but every change it wants to make
// shows up as a card that you approve or reject. Nothing is changed without your click.
export default function Assistant() {
  const { expire } = useAuth()
  const [message, setMessage] = useState('')
  const [asked, setAsked] = useState(null)
  const [run, setRun] = useState(null)
  const [choices, setChoices] = useState({}) // tool_use_id → true (approve) / false (reject)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function call(fn) {
    setBusy(true)
    setError(null)
    try {
      const next = await fn()
      setRun(next)
      setChoices({})
    } catch (err) {
      if (err.status === 401) return expire()
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function start(text) {
    const m = (text ?? message).trim()
    if (m.length < 3) return
    setAsked(m)
    setMessage('')
    setRun(null)
    call(() => api('/agent/runs', { method: 'POST', body: { message: m } }))
  }

  function choose(id, approve) {
    const next = { ...choices, [id]: approve }
    setChoices(next)
    // Once every pending action has a decision, send them all together.
    if (run.pending.every((p) => p.tool_use_id in next)) {
      const decisions = run.pending.map((p) => ({ tool_use_id: p.tool_use_id, approve: next[p.tool_use_id] }))
      call(() => api(`/agent/runs/${run.id}/decide`, { method: 'POST', body: { decisions } }))
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900">Assistant</h1>
      <p className="mb-5 text-sm text-slate-500">
        It can search your applications, draft follow-ups and propose changes. <b>Every change waits for your approval.</b>
      </p>

      <form onSubmit={(e) => { e.preventDefault(); start() }} className="flex flex-col gap-3 sm:flex-row">
        <input className="input sm:flex-1" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000}
          placeholder="e.g. Mark Tyrell as rejected and tell me what's due this week" aria-label="Message to the assistant" />
        <button className="btn-primary" disabled={busy || message.trim().length < 3}>{busy && !run ? 'Working…' : 'Send'}</button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => start(ex)} disabled={busy}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">{ex}</button>
        ))}
      </div>

      <div className="mt-5"><ErrorBanner>{error}</ErrorBanner></div>

      {asked && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm"><span className="font-medium text-slate-900">You:</span> <span className="text-slate-700">{asked}</span></p>

          {run?.log.length > 0 && (
            <ul className="space-y-1 border-l-2 border-slate-200 pl-3">
              {run.log.map((entry, i) => (
                <li key={i} className="text-xs text-slate-500">
                  {entry.kind === 'approval'
                    ? `${entry.approved ? '✅ Approved' : '⛔ Rejected'}: ${entry.summary}`
                    : `${entry.ok ? '🔎' : '⚠️'} ${TOOL_LABELS[entry.name] ?? entry.name}${entry.note ? ` (${entry.note})` : ''}`}
                </li>
              ))}
            </ul>
          )}

          {busy && <p className="text-sm text-slate-500">Working…</p>}

          {run?.status === 'awaiting_approval' && !busy && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">The assistant wants to make {run.pending.length === 1 ? 'this change' : 'these changes'}:</p>
              {run.pending.map((p) => (
                <div key={p.tool_use_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-amber-800">{TOOL_LABELS[p.name] ?? p.name}</p>
                    <p className="text-sm text-slate-900">{p.summary}</p>
                  </div>
                  {p.tool_use_id in choices ? (
                    <span className="text-xs text-slate-500">{choices[p.tool_use_id] ? 'Approved' : 'Rejected'} — waiting for the others</span>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => choose(p.tool_use_id, true)} className="btn-primary px-3 py-1.5">Approve</button>
                      <button onClick={() => choose(p.tool_use_id, false)} className="btn-secondary px-3 py-1.5">Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {run?.status === 'done' && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-800">
              <span className="font-medium text-slate-900">Assistant:</span> {run.reply}
            </p>
          )}
          {run?.status === 'failed' && <ErrorBanner>{run.error}</ErrorBanner>}
        </section>
      )}
    </div>
  )
}
