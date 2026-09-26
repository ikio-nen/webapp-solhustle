# Deploying Solhustle

The backend is a long-running Express server with a local SQLite database
(`data/app.db`). Vercel's serverless functions can't durably run it (ephemeral
filesystem, no `app.listen()`), so the backend needs a host like Railway,
Render, Fly, or any VPS.

## Option A — everything on Railway (recommended, simplest)

The backend already serves the frontend statically (`backend/server.ts`
serves `frontend/` and routes `/`, `/buyer`, `/seller`, `/admin`, `/signup`),
so one Railway service gives you the whole app on a single URL — no CORS
setup, no config changes.

1. Railway → New Project → Deploy from GitHub → `ikio-nen/webapp-solhustle`.
2. Start command: `npm start` (already in `package.json`).
3. Variables:
   - `JWT_SECRET` — any long random string (**required**; the default is a
     dev placeholder — generate one, e.g. `openssl rand -base64 48`)
   - `CHAIN=devnet` (default)
   - `DATABASE_URL` — Neon Postgres URL only if you want the cloud mirror
     (optional; the app runs fine on SQLite alone)
4. Add a **Volume** mounted at `/app/data` so the SQLite database survives
   restarts/redeploys. Without this, all users and jobs vanish on redeploy.
5. Run `npm run seed` once (Railway one-off command / run tab) to create the
   demo actors, then restart the service.
6. Open the public URL — done. Leave `window.SOLHUSTLE_API_BASE` as `""` in
   `frontend/js/config.js` (same-origin default).

With this option you don't need the Vercel deployment at all.

## Option B — split hosting (frontend on Vercel, backend on Railway)

Use this if you want the frontend on Vercel's CDN.

1. Deploy the backend on Railway exactly as steps 1–5 of Option A, plus:
   - `FRONTEND_ORIGIN` — your Vercel URL, e.g. `https://solhustle.vercel.app`
     (the backend's CORS middleware uses this; without it, cross-origin API
     calls from the Vercel frontend are blocked)
2. Copy the public backend URL, e.g. `https://solhustle-api.up.railway.app`.
3. In `frontend/js/config.js`, set:

```js
window.SOLHUSTLE_API_BASE = "https://solhustle-api.up.railway.app";
```

4. Commit + push — Vercel redeploys the frontend automatically. Every API
   call (login, jobs, escrow, price ticker) goes through the shared `api()`
   helper in `frontend/js/common.js`, which prepends this base URL.

## Demo credentials

| Role   | Username | Password   |
| ------ | -------- | ---------- |
| Buyer  | `buyer`  | `buyer123` |
| Seller | `seller` | `seller123` |
| Admin  | `admin`  | `admin 123` |

## Why not backend-on-Vercel?

Vercel functions have an ephemeral filesystem: the SQLite database and the
`keys/` escrow keypairs would vanish between invocations, and each cold start
would generate new keys — breaking escrow release/refund. The Neon sync in
`backend/neon.ts` is a backup mirror, not the primary store. Making Neon
primary is possible but is a larger refactor; the setups above are the
reliable hackathon path.
