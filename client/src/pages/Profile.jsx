import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, fieldErrors } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBanner, Field, PageMessage } from '../components.jsx'
import { extractPdfText } from '../pdfText.js'

export default function Profile() {
  const { expire } = useAuth()
  const [form, setForm] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [pdfStatus, setPdfStatus] = useState(null) // { kind: 'busy' | 'ok' | 'error', text }

  useEffect(() => {
    api('/profile')
      .then((p) => setForm({ email: p.email, name: p.name ?? '', resume_text: p.resume_text ?? '' }))
      .catch((err) => (err.status === 401 ? expire() : setError(err)))
  }, [expire])

  const update = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    setSavedAt(null)
  }

  // Fills the resume box from a PDF. Nothing is saved until you press "Save profile",
  // so you can check (and fix) the extracted text first.
  async function importPdf(event) {
    const file = event.target.files?.[0]
    event.target.value = '' // lets you pick the same file again later
    if (!file) return
    if (form.resume_text.trim() && !window.confirm('Replace the resume text below with the text from this PDF?')) return

    setPdfStatus({ kind: 'busy', text: `Reading ${file.name}…` })
    try {
      const text = await extractPdfText(file)
      setForm((f) => ({ ...f, resume_text: text.slice(0, 20000) }))
      setSavedAt(null)
      setPdfStatus({ kind: 'ok', text: `Imported ${text.length.toLocaleString()} characters from ${file.name}. Check it, then save.` })
    } catch (err) {
      setPdfStatus({ kind: 'error', text: err.message || "Couldn't read that PDF." })
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const p = await api('/profile', { method: 'PATCH', body: { name: form.name, resume_text: form.resume_text } })
      setForm({ email: p.email, name: p.name ?? '', resume_text: p.resume_text ?? '' })
      setSavedAt(new Date())
    } catch (err) {
      if (err.status === 401) return expire()
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  if (!form && !error) return <PageMessage>Loading…</PageMessage>
  if (!form) return <ErrorBanner>{error.message}</ErrorBanner>

  const errors = fieldErrors(error)
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">← All applications</Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold text-slate-900">Profile</h1>
      <p className="mb-5 text-sm text-slate-500">{form.email}</p>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <ErrorBanner>{error && !error.details?.length ? error.message : null}</ErrorBanner>

        <Field label="Name" error={errors.name}>
          <input className="input" name="name" value={form.name} onChange={update} autoComplete="name" />
        </Field>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
          <label className="btn-secondary cursor-pointer">
            Import from PDF
            <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={importPdf} />
          </label>
          <span
            className={`text-sm ${
              pdfStatus?.kind === 'error' ? 'text-red-600' : pdfStatus?.kind === 'ok' ? 'text-green-700' : 'text-slate-500'
            }`}
            aria-live="polite"
          >
            {pdfStatus?.text ?? 'Read in your browser; the file itself is never uploaded.'}
          </span>
        </div>

        <Field label="Resume" error={errors.resume_text}>
          <textarea
            className="input min-h-80 font-mono text-xs leading-relaxed"
            name="resume_text"
            value={form.resume_text}
            onChange={update}
            placeholder="Paste the text of your resume: summary, skills, projects, experience."
          />
          <span className="mt-1 block text-xs text-slate-500">
            The AI fit score compares each job description against this text. Plain text is fine. {form.resume_text.length.toLocaleString()} / 20,000 characters.
          </span>
        </Field>

        <div className="flex items-center justify-end gap-3">
          {savedAt && <span className="text-sm text-green-700">Saved</span>}
          <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        </div>
      </form>
    </div>
  )
}
