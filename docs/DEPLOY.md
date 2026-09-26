# Deploying Solhustle

The backend is a long-running Express server with a local SQLite database.
Vercel's serverless functions can't durably run it (ephemeral filesystem, no
`app.listen()`), so the supported setup is **split hosting**:

## Frontend → Vercel (static)

This repo ships a `vercel.json` that deploys `frontend/` as a static site —
no build step needed. Just import the repo in Vercel and deploy.

Pages: `/landing.html`, `/buyer.html`, `/seller.html`, `/admin.html`
(`/` serves the dev panel `index.html`.)

## Backend → Railway (or Render / Fly / any VPS)

1. New project from this repo. Start command: `npm start` (already in `package.json`).
2. Set env vars:
   - `JWT_SECRET` — any long random string (required-ish; default is a dev placeholder)
   - `FRONTEND_ORIGIN` — your Vercel URL, e.g. `https://solhustle.vercel.app`
     (the backend's CORS middleware uses this; without it, cross-origin API
     calls from the Vercel frontend are blocked)
   - `DATABASE_URL` — Neon Postgres URL if you want the cloud mirror (optional;
     the app runs fine on SQLite alone)
   - `CHAIN=devnet` (default)
3. Run `npm run seed` once (Railway one-off command) to create demo actors,
   then restart the service once so demo login credentials are generated.
4. Copy the public backend URL, e.g. `https://solhustle-api.up.railway.app`.

## Connect them

In `frontend/config.js`, set:

```js
window.SOLHUSTLE_API_BASE = "https://solhustle-api.up.railway.app";
```

Commit + push — Vercel redeploys the frontend automatically. Every API call
(login, jobs, escrow, price ticker) goes through the shared `api()` helper in
`frontend/common.js`, which prepends this base URL. Leave it as `""` when
frontend and backend share an origin.

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
`src/neon.ts` is a backup mirror, not the primary store. Making Neon primary
is possible but is a larger refactor; the split setup above is the reliable
hackathon path.
