import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from './api.js'

// Holds "who is logged in" for the whole app.
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Called when any request comes back 401 (session expired): forget the user,
  // and RequireAuth sends them to the login page. useCallback keeps it the same
  // function between renders, so pages can list it in useEffect dependencies safely.
  const expire = useCallback(() => setUser(null), [])

  // On page load (including a refresh), ask the server who we are.
  // React can't read the httpOnly cookie, but the browser sends it with this request,
  // so the server can answer: 200 with the user, or 401 if not logged in.
  useEffect(() => {
    api('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const value = {
    user,
    loading,
    login: async (email, password) => setUser(await api('/auth/login', { method: 'POST', body: { email, password } })),
    register: async (fields) => setUser(await api('/auth/register', { method: 'POST', body: fields })),
    logout: async () => {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
    },
    expire,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
