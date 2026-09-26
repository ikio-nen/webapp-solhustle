/* Solhustle frontend config — loaded BEFORE common.js.
   Set window.SOLHUSTLE_API_BASE to your backend URL when the frontend and
   backend are deployed separately (e.g. frontend on Vercel, backend on Railway):

     window.SOLHUSTLE_API_BASE = "https://your-backend.railway.app";

   Leave it as "" (default) when frontend + backend are served from the same
   origin (local dev, single Railway/Render/VPS deploy) — everything then
   works exactly as before with same-origin relative requests. */
window.SOLHUSTLE_API_BASE = "";
