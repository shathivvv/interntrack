Day 1 
Architecture
- Frontend(React)- Runs in user browser hosted on Vercel
- Backend(Express) - Runs a persistent Web Service on Render and all secret keys live safely here
- Database (Postgres + pgvector) - Runs on Neon and only accepts connection from Express

Three things I learned tonight
- Calling /api/health instead of http://localhost:3000/api/health lets Vite's proxy forward requests locally and Vercel's rewrite proxy requests in production—making cookies first-party so browsers like Safari don't block logins.
- Database design comes before routes: Defining required fields, user_id ownership locks, and TEXT + CHECK status rules upfront prevents messy schema changes and security bugs later.
- How useEffect(..., []) controls API calls: Passing an empty dependency array [] ensures startup checks (like /api/health or /api/auth/me) run once when the page mounts instead of looping on every render.

3. Why package-lock.json Is Committed and node_modules/ Isn't
• node_modules/ is ignored (.gitignore): It contains thousands of downloaded files that can take up hundreds of megabytes, slowing down Git and bloating the repository. Anyone can recreate it anytime by running npm install.
• package-lock.json is committed: It is a tiny file that records the exact version of every package installed. Committing it guarantees that my laptop, teammates, and Render's build server install the exact same dependency versions so the app doesn't break from unexpected updates.
4. One Thing I'm Still Unsure About

ession cookies vs. JWTs across Vercel's rewrite: While I understand why proxying /api/* through Vercel keeps cookies first-party, I want to verify the exact express-session / cookie settings (secure, sameSite, httpOnly) in B2 so login works smoothly both on localhost and live on Vercel + Render.