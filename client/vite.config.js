import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In development, forward /api/* to Express on port 3000.
    // The browser only ever talks to localhost:5173, so there is one origin:
    // no CORS setup and no third-party cookies. In production the Vercel
    // rewrite (vercel.json) does the same job.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
