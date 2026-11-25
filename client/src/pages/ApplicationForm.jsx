import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, fieldErrors } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorBanner, Field, PageMessage } from '../components.jsx'
import { INTERVIEW_ROUNDS, METHODS, STATUSES, todayInMalaysia } from '../constants.js'

const EMPTY = {
  company_name: '', role: '', status: 'saved', job_description: '',
  location: '', salary: '', date_applied: '', application_method: '', job_url: '',
  resume_version: '', follow_up_date: '', interview_round: '',
  contact_name: '', contact_email: '', contact_phone: '',
}

// Inputs hold strings; the API wants null for "no value" (e.g. an empty date isn't a date).
const toApi = (value) => (value === '' ? null : value)
// And the other way: null from the API shows as an empty input.
const fromApi = (row) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, row[k] ?? '']))

// One form for both "new" (/applications/new) and "edit" (/applications/:id).
export default function ApplicationForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { expire } = useAuth()

  const [form, setForm] = useState(EMPTY)
  const [original, setOriginal] = useState(null) // what the server has, for sending only changes
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isEdit) return
    api(`/applications/${id}`)
      .then((row) => {
        setForm(fromApi(row))
        setOriginal(fromApi(row))
      })
      .catch((err) => (err.status === 401 ? expire() : setError(err)))
      .finally(() => setLoading(false))
  }, [id, isEdit, expire])

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    let body
    if (isEdit) {
      // PATCH sends only what changed, which is exactly what the API's PATCH expects.
      body = Object.fromEntries(
        Object.keys(form).filter((k) => form[k] !== original[k]).map((k) => [k, toApi(form[k])]),
      )
      if (Object.keys(body).length === 0) return navigate('/')
    } else {
      body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, toApi(v)]))
    }

    setSubmitting(true)
    try {
      await api(isEdit ? `/applications/${id}` : '/applications', { method: isEdit ? 'PATCH' : 'POST', body })
      navigate('/')
    } catch (err) {
      if (err.status === 401) return expire()
      setError(err)
      setSubmitting(false)
    }
  }

  if (loading) return <PageMessage>Loading…</PageMessage>
  if (isEdit && error?.status === 404) {
    return (
      <PageMessage>
        Application not found. <Link to="/" className="ml-1 text-indigo-600 hover:underline">Back to the list</Link>
      </PageMessage>
    )
  }

  const errors = fieldErrors(error)
  const select = (name, options, placeholder) => (
    <select className="input" name={name} value={form[name]} onChange={update}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
  const text = (name, props = {}) => <input className="input" name={name} value={form[name]} onChange={update} {...props} />

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">← Back</Link>
      <h1 className="mt-2 mb-5 text-xl font-semibold text-slate-900">{isEdit ? 'Edit application' : 'Add application'}</h1>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <ErrorBanner>{error && !error.details?.length ? error.message : error ? 'Please fix the highlighted fields.' : null}</ErrorBanner>

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Company *" error={errors.company_name}>{text('company_name', { required: true })}</Field>
          <Field label="Role *" error={errors.role}>{text('role', { required: true })}</Field>
          <Field label="Status" error={errors.status}>{select('status', STATUSES)}</Field>
          <Field label="Interview round" error={errors.interview_round}>{select('interview_round', INTERVIEW_ROUNDS, 'None')}</Field>
        </section>

        <Field label="Job description *" error={errors.job_description}>
          <textarea className="input min-h-40" name="job_description" required value={form.job_description} onChange={update}
            placeholder="Paste the full job ad. The AI fit score will read this." />
        </Field>

        <section className="grid gap-4 sm:grid-cols-3">
          <Field label="Date applied" error={errors.date_applied}>{text('date_applied', { type: 'date', max: todayInMalaysia() })}</Field>
          <Field label="Follow up on" error={errors.follow_up_date}>{text('follow_up_date', { type: 'date', min: form.date_applied || undefined })}</Field>
          <Field label="Applied via" error={errors.application_method}>{select('application_method', METHODS, 'Not set')}</Field>
          <Field label="Location" error={errors.location}>{text('location', { placeholder: 'e.g. KL · hybrid' })}</Field>
          <Field label="Salary" error={errors.salary}>{text('salary', { placeholder: 'e.g. RM 1,200/month' })}</Field>
          <Field label="Resume version" error={errors.resume_version}>{text('resume_version', { placeholder: 'e.g. v6' })}</Field>
        </section>

        <Field label="Job link" error={errors.job_url}>{text('job_url', { type: 'url', placeholder: 'https://…' })}</Field>

        <section className="grid gap-4 sm:grid-cols-3">
          <Field label="Contact name" error={errors.contact_name}>{text('contact_name')}</Field>
          <Field label="Contact email" error={errors.contact_email}>{text('contact_email', { type: 'email' })}</Field>
          <Field label="Contact phone" error={errors.contact_phone}>{text('contact_phone', { type: 'tel' })}</Field>
        </section>

        <div className="flex justify-end gap-3">
          <Link to="/" className="btn-secondary">Cancel</Link>
          <button className="btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add application'}
          </button>
        </div>
      </form>
    </div>
  )
}
