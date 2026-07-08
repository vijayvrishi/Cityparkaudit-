# CityPark Audit (GoAudits-style Hotel Audit App) — Replit Setup

Exact code export from Emergent. Backend: FastAPI + MongoDB (server.py + 3 test suites). Frontend: Expo, tabs Home/Templates/Actions/Analytics, dark luxe + gold theme.

## 1. Import
Replit → Create App → Import from zip.

## 2. MongoDB Atlas (reuse your existing cluster)
backend/.env → MONGO_URL=<your Atlas connection string>
DB_NAME=citypark_audit (already set — keeps it separate from your other apps)

## 3. Gemini API key (for AI audit-report summaries only)
Same free key as the hotel app (aistudio.google.com) → backend/.env GEMINI_API_KEY=<key>
Everything else works without it; only POST /api/audits/{id}/summary needs it.
(Original used gpt-5.4 via Emergent's key; now uses your Gemini key — override model with GEMINI_SUMMARY_MODEL.)

## 4. Run
Backend:  cd backend  && pip install -r requirements.txt && uvicorn server:app --host 0.0.0.0 --port 8001
Frontend: set frontend/.env EXPO_PUBLIC_BACKEND_URL=<backend public URL>, then
          cd frontend && npm install --legacy-peer-deps && npx expo start --web

## Logins (seeded)
- Admin:   admin@cityparkhotel.in / CityPark2026!  (set in backend/.env before first run)
- Auditor: register in-app → admin approves from Profile screen
8 LQA seed templates + all hotel rooms/areas load automatically on first run.

## Staff email policy
- Registration only accepts @cityparkhotel.in emails (enforced server-side; configurable via STAFF_EMAIL_DOMAIN in backend/.env). Existing seeded admin uses admin@cityparkhotel.in.

## Adaptations vs Emergent (only these; all other code identical)
- AI summary endpoint: emergentintegrations/gpt-5.4 → official google-genai SDK with your GEMINI_API_KEY
- requirements.txt: removed emergentintegrations + Emergent-hosted litellm wheel
- frontend/package.json: removed Emergent preinstall guard
- .env files sanitized; fresh JWT_SECRET
