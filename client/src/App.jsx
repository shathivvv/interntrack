import { Navigate, Route, Routes } from 'react-router'
import { GuestOnly, Layout, RequireAuth } from './components.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import ApplicationsList from './pages/ApplicationsList.jsx'
import ApplicationForm from './pages/ApplicationForm.jsx'
import ApplicationDetail from './pages/ApplicationDetail.jsx'
import Profile from './pages/Profile.jsx'
import Ask from './pages/Ask.jsx'

// Which page shows for which URL. Vercel sends every URL to index.html
// (the second rule in vercel.json), and this decides what to render.
export default function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<ApplicationsList />} />
          <Route path="/applications/new" element={<ApplicationForm />} />
          <Route path="/applications/:id" element={<ApplicationDetail />} />
          <Route path="/applications/:id/edit" element={<ApplicationForm />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/ask" element={<Ask />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
