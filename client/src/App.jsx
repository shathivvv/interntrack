import { useEffect, useState } from 'react'

function App() {
  // 'checking' until the request finishes, then 'ok' or 'unreachable'.
  const [apiStatus, setApiStatus] = useState('checking')

  // Runs once after the first render: ask Express whether it is up.
  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => setApiStatus(data.status))
      .catch(() => setApiStatus('unreachable'))
  }, [])

  return (
    <main>
      <h1>InternTrack</h1>
      <p>API: {apiStatus}</p>
    </main>
  )
}

export default App
