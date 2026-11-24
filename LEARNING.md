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


Learning #2

Connection errors: ETIMEDOUT means the connection took too long because packets get dropped usually by a firewall like my uni Wi-Fi on port 5432 ENOTFOUND means the hostname couldn't be found, and ECONNREFUSED means the server refused the connection. I learned that sometimes the issue is my Wi-Fi or network rather than my code.

Rotating a leaked secret: If an API key or secret gets exposed, simply deleting it from the code isn't enough. I need to revoke the old secret, generate a new one and update the environment variables.

PostgreSQL type surprises: I learned that DATE values can shift by a day when timezone conversions happen. Also, BIGINT values from PostgreSQL can come back as strings in JavaScript because JavaScript numbers cannot safely represent every large integer.

Vercel rewrite rules: The order of rewrite rules matters. More specific rules should come before general rules so that API requests don't accidentally get redirected to index.html.

Injectable authentication: Using injectable authentication is similar to using FakeOCR. I can replace the real authentication system with a fake one during testing, making it easier to test different scenarios without depending on the actual service.

404 instead of 403: I learned that returning 404 when someone tries to access another user's application can prevent them from knowing whether that application actually exists. The Bob test proves this by comparing the response with a request for a nonexistent ID.

PATCH validation: PATCH should validate the final updated record, not just the request body. This is because the request might only contain one field, while other existing fields in the database are still important for validation

Still unsure: I want to understand more about how JavaScript handles dates and timezones, especially when working with PostgreSQL.