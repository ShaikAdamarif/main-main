# AV PROP MISSION — Vercel + Neon

## Deploy
1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. In Vercel → Settings → Environment Variables add:
   - `DATABASE_URL` = your Neon connection string (e.g. `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`)
4. Deploy. Visit your `*.vercel.app` URL.

## Local dev
```
npm install
echo "DATABASE_URL=postgres://..." > .env
npm start
# http://localhost:3000
```

## Notes
- Real-time `/api/stream` (SSE) works locally. On Vercel serverless, long-lived connections close after the function timeout; the UI still works via direct API calls.
- All time-log / login data is stored in Neon's `kv_store` table.
