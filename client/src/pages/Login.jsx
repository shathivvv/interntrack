import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth.jsx'
import { fieldErrors } from '../api.js'
import { AuthCard, ErrorBanner, Field } from '../components.jsx'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault() // stop the browser's own full-page form submit
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      // Back to the page they were trying to open, or the list.
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setError(err)
      setSubmitting(false)
    }
  }

  const errors = fieldErrors(error)
  return (
    <AuthCard title="Log in">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner>{error && !error.details.length ? error.message : null}</ErrorBanner>
        <Field label="Email" error={errors.email}>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" error={errors.password}>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        No account?{' '}
        <Link to="/register" className="font-medium text-indigo-600 hover:underline">
          Create one
        </Link>
      </p>
    </AuthCard>
  )
}
