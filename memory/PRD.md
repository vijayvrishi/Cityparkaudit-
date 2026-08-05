# PRD — CityPark Audit (GoAudit-style Hotel Audit App)

## Original Problem Statement
"Build a mobile app: can you make same as goaudit app for hotels"

## User Choices
- Roles: Auditors + Admin/Manager (admin creates templates, auditors perform audits)
- Features: checklists (pass/fail/NA + photo + notes) + scheduled/action items + analytics dashboard
- Auth: None (open app)
- AI: Audit report summaries via Emergent LLM key (gpt-5.4, emergentintegrations)
- Design: Cityparkhotel.in theme → dark luxe (#121212) + champagne gold (#D4AF37), Cormorant Garamond display font

## Architecture
- Frontend: Expo (SDK 54) + expo-router, tabs: Home / Templates / Actions / Analytics
- Backend: FastAPI + MongoDB (motor), all routes prefixed /api, uuid string ids, _id excluded
- AI: emergentintegrations LlmChat (openai gpt-5.4), EMERGENT_LLM_KEY in backend/.env
- Photos: expo-image-picker → base64 stored in Mongo audit items

## Implemented (June 2026 — MVP)
- 8 LQA-standard seed templates (Arrival & Check-In, Guest Room Experience w/ Turndown, In-Room Dining, Restaurant & Breakfast, Bar Service, Telephone & Concierge, Check-Out & Departure, Spa/Pool/Fitness) — seed versioning (v2) preserves user-created templates
- Hotel locations: rooms by floor (400, 402-412, 414-416 / 500-series / 600-series / 700-series) + areas (Main Kitchen, Cafe Kitchen, Yellow Mirchi Restaurant, Cafe24); location picker in start-audit sheet; location shown on audits, history, action items; GET /api/locations
- Template CRUD + create-template screen (sections + check items)
- Audit flow: start (auditor name), pass/fail/NA per item, notes, photo evidence (camera/library with permission handling), progress bar, Save & Exit, Complete with score = pass/(pass+fail)*100
- Auto-created action items (priority high) for every failed check on completion
- Action items: manual create, filter chips, status transitions open/in_progress/resolved via bottom sheet
- Analytics: portfolio avg score, score trend bars (last 10), department score bars, completed history → read-only detail
- AI report summary: POST /api/audits/{id}/summary (streams internally, stored on audit)
- Scheduled/recurring audits (once/daily/weekly): /api/schedules CRUD + /start (advances next_due); "Due Today" section on Home + /schedules management screen with create sheet (template, recurrence, room/area, auditor)
- PDF export of completed audit + AI summary: expo-print + expo-sharing (native share sheet; web print dialog), branded report HTML with photos, notes, colored results
- Testing: iteration 2 — 35/35 passed (backend regression + schedules + PDF); tests at /app/backend/tests/test_schedules_and_pdf.py
- Testing: iteration 1 — backend 16/16 passed, all frontend flows verified; regression tests at /app/backend/tests/test_audit_flow.py

- Auth (June 2026): JWT email/password login with admin approval — register creates pending users, admin approves via Profile screen; all /api/* protected (HTTPBearer + get_current_user); seeded admin admin@citypark.com (creds in /app/memory/test_credentials.md); token in SecureStore; AuthProvider route guard (src/auth.tsx)
- Room coverage: GET /api/analytics/room-coverage?days=7 + Coverage tab in Analytics (per-floor room grid, audited rooms green)
- Action items: assignee + due_date fields (create form inputs + due chips, overdue shown red); auto-created items from failed checks get due_date = +24 hours; overdue open action items blink on the Home screen
- Testing: iteration 3 — auth/coverage/assignee flows passed; 2 bugs found & fixed (auto action-item due_date, profile button untappable on hero); tests at /app/backend/tests/test_auth_and_coverage.py

## User Personas
- Auditor: performs daily inspections, attaches evidence, submits
- Admin/Manager: builds templates, tracks action items, reviews analytics + AI reports

## Backlog (prioritized)
- P0: none outstanding
- P1: Multi-hotel/property support; assign action items to registered users (dropdown instead of free text)
- P2: Offline mode; photo annotations; password reset flow; role management (promote auditor to admin)

## Next Tasks
- Password reset / change password
- "My Tasks" filter (action items assigned to logged-in user)
