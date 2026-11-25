import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth.jsx'
import { fieldErrors } from '../api.js'
import { AuthCard, ErrorBanner, Field } from '../components.jsx'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // One handler for every input: the input's name says which field to update.
  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await register({ ...form, name: form.name || undefined })
      navigate('/', { replace: true }) // register also logs you in
    } catch (err) {
      setError(err)
      setSubmitting(false)
    }
  }

  const errors = fieldErrors(error)
  return (
    <AuthCard title="Create your account">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner>{error && !error.details.length ? error.message : null}</ErrorBanner>
        <Field label="Name (optional)" error={errors.name}>
          <input className="input" name="name" autoComplete="name" value={form.name} onChange={update} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input className="input" name="email" type="email" autoComplete="email" required value={form.email} onChange={update} />
        </Field>
        <Field label="Password" error={errors.password}>
          <input className="input" name="password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={update} />
          <span className="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
        </Field>
        <button className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  )
}
