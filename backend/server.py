import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import bcrypt
import jwt
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Auth ----------
auth_router = APIRouter(prefix="/api/auth")
bearer_scheme = HTTPBearer()
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1)
    email: str
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    email: str
    password: str


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def create_token(user: dict) -> str:
    payload = {"sub": user["id"], "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def public_user(u: dict) -> dict:
    return {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"],
            "approved": u["approved"], "created_at": u["created_at"]}


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    if not user.get("approved"):
        raise HTTPException(403, "Account pending admin approval")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return user


@auth_router.post("/register")
async def register(body: RegisterRequest):
    email = body.email.strip().lower()
    if "@" not in email or "." not in email:
        raise HTTPException(400, "Invalid email address")
    allowed_domain = os.environ.get("STAFF_EMAIL_DOMAIN", "cityparkhotel.in").lower()
    if not email.endswith("@" + allowed_domain):
        raise HTTPException(400, f"Registration is restricted to @{allowed_domain} staff email addresses")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(400, "Email already registered")
    user = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "email": email,
        "password_hash": hash_password(body.password),
        "role": "auditor",
        "approved": False,
        "created_at": now_iso(),
    }
    await db.users.insert_one({**user})
    return {"message": "Registration submitted. An admin must approve your account before you can sign in."}


@auth_router.post("/login")
async def login(body: LoginRequest):
    user = await db.users.find_one({"email": body.email.strip().lower()}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect email or password")
    if not user.get("approved"):
        raise HTTPException(403, "Your account is awaiting admin approval")
    return {"access_token": create_token(user), "user": public_user(user)}


@auth_router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return public_user(user)


async def seed_admin():
    email = os.environ['ADMIN_EMAIL'].strip().lower()
    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Admin",
            "email": email,
            "password_hash": hash_password(os.environ['ADMIN_PASSWORD']),
            "role": "admin",
            "approved": True,
            "created_at": now_iso(),
        })
        logger.info("Seeded admin user %s", email)


# ---------- Models ----------
class ChecklistItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    text: str


class Section(BaseModel):
    name: str
    items: List[ChecklistItem]


class TemplateCreate(BaseModel):
    name: str
    department: str
    icon: str = "clipboard-outline"
    sections: List[Section]


class AuditItemState(BaseModel):
    id: str
    text: str
    section: str
    result: Optional[str] = None  # "pass" | "fail" | "na"
    note: str = ""
    photo_base64: Optional[str] = None


class AuditCreate(BaseModel):
    template_id: str
    auditor_name: str = "Auditor"
    location: Optional[str] = None


class AuditUpdate(BaseModel):
    items: List[AuditItemState]
    status: str  # "in_progress" | "completed"


class ActionItemCreate(BaseModel):
    title: str
    description: str = ""
    department: str = "General"
    priority: str = "medium"  # low | medium | high
    audit_id: Optional[str] = None
    location: Optional[str] = None
    assignee: Optional[str] = None
    due_date: Optional[str] = None  # YYYY-MM-DD


class ActionItemUpdate(BaseModel):
    status: Optional[str] = None  # open | in_progress | resolved
    priority: Optional[str] = None
    assignee: Optional[str] = None
    due_date: Optional[str] = None


class ScheduleCreate(BaseModel):
    template_id: str
    location: Optional[str] = None
    auditor_name: str = "Auditor"
    recurrence: str = "daily"  # once | daily | weekly
    start_date: Optional[str] = None  # YYYY-MM-DD


class ScheduleUpdate(BaseModel):
    active: Optional[bool] = None


# ---------- Seed templates (LQA — Leading Quality Assurance standards) ----------
SEED_TEMPLATES = [
    {
        "name": "Arrival & Check-In",
        "department": "Front Office",
        "icon": "key-outline",
        "sections": [
            {"name": "Doorman & Bellman", "items": [
                "Guest acknowledged within 30 seconds of arrival at entrance",
                "Doorman opened door and offered assistance with a warm greeting",
                "Luggage assistance offered and delivered to room within 10 minutes",
                "Staff well groomed in clean uniform with name badge",
                "Entrance and driveway spotless with no congestion",
            ]},
            {"name": "Check-In / Reception", "items": [
                "Guest greeted immediately with eye contact and a smile",
                "Guest name used at least twice during check-in",
                "Check-in completed within 5 minutes",
                "Room features and hotel facilities clearly explained",
                "Escort to the room offered",
                "Registration process discreet — no room number announced aloud",
            ]},
            {"name": "Emotional Engagement", "items": [
                "Staff displayed genuine warmth and personalized the interaction",
                "Staff anticipated guest needs without being asked",
                "Conversation was engaging, confident and unscripted",
                "Staff exhibited pride and belief in the hotel",
            ]},
        ],
    },
    {
        "name": "Room Checklist",
        "department": "Housekeeping",
        "icon": "bed-outline",
        "sections": [
            {"name": "Room", "items": [
                "Room number plate, doorbell, lock, DND & Clean my room signage, and fire map should be clean & in working order.",
                "Main door clean with entrance area free of dust & debris; peephole, safety latch, and door in good condition.",
                "ESD & light sockets should be clean, presentable & in working order.",
                "Room at a comfortable temperature and free of odour.",
                "Room freshener sprayed.",
                "Luggage rack free of dust; wardrobe cleaned properly with correct number of hangers, shoe shiner, slippers, and safe in working condition.",
                "Kettle set up properly with cleaned base, filter, cup, saucer & spoon.",
                "TV should be clean and in working order.",
                "Minibar cabinet & freezer cleaned properly.",
                "Writing table presentable with lamp clean & in working condition.",
                "Dustbin and insert clean and in good condition.",
                "Guest stationery folder in crisp condition; letterheads, envelopes, pen, postcards, and service directory contains maintained inserts.",
                "All window ledges and glass clean and free of smears.",
                "Curtains should be stain-free, with straight fall and proper fitting.",
                "Upholstered furniture clean and free of stains.",
                "All furniture/surfaces clean, free of dust and stains.",
                "Carpet freshly vacuumed; floor cleaned and free of stains.",
                "Bed made professionally with clean, stain-free, and tear-free linen; runner & cushion in proper condition.",
                "Bedside table properly cleaned along with clean glasses, water bottle, phone, and TV remote in working order with crisp notepad and pencil.",
                "All light fixtures in working condition and fittings clean and dust-free.",
            ]},
            {"name": "Bathroom", "items": [
                "Bathroom door clean, free of dust; mirror free of any smears.",
                "Vanity counter area properly cleaned with amenity tray, waste bin clean, full tissue box & other supplies.",
                "All equipment, light fixtures & power sockets in working condition and fittings clean and dust-free.",
                "Rain shower & shower fittings should be in working condition.",
                "Shower area glass free of water marks, wall free of soap scum & drain clean.",
                "Bathtub & curtain should be clean & in proper working condition.",
                "Shower controls cleaned & working.",
                "WC clean and in good condition along with dustbin and insert.",
                "Exhaust vent should be clean & in working order.",
                "Bathroom floor clean and free of debris.",
            ]},
        ],
    },
    {
        "name": "In-Room Dining",
        "department": "Food & Beverage",
        "icon": "fast-food-outline",
        "sections": [
            {"name": "Order Taking", "items": [
                "Telephone answered within 3 rings with appropriate greeting",
                "Order accurately repeated and delivery time quoted",
                "Staff made a suggestion or offered an accompaniment (upsell)",
                "Guest name used during the call",
            ]},
            {"name": "Delivery & Service", "items": [
                "Order delivered within quoted time (max 30 minutes)",
                "Waiter asked where the guest would like the tray/table set",
                "Dishes described upon placement",
                "Hot items covered and beverages correctly presented",
                "Bill accurate and signature obtained discreetly",
            ]},
            {"name": "Food Quality", "items": [
                "Food served at correct temperature",
                "Presentation appealing and consistent with menu description",
                "Portion size and taste meet standard",
            ]},
            {"name": "Tray Collection", "items": [
                "Tray/table collected within 15 minutes of request or proactively",
            ]},
        ],
    },
    {
        "name": "Restaurant & Breakfast",
        "department": "Food & Beverage",
        "icon": "restaurant-outline",
        "sections": [
            {"name": "Arrival & Seating", "items": [
                "Guest greeted and seated within 1 minute of arrival",
                "Hostess warm and friendly with eye contact and smile",
                "Table fully set, clean, aligned and wobble free",
            ]},
            {"name": "Service Standards", "items": [
                "Order taken within 5 minutes of seating",
                "Beverage served within 3 minutes of order",
                "Staff knowledgeable on menu, ingredients and dietary needs",
                "Guest name used during the meal",
                "Coffee/tea refills offered proactively",
                "Bill accurate and presented within 3 minutes of request",
            ]},
            {"name": "Food & Buffet Quality", "items": [
                "Buffet fully stocked, labelled and replenished",
                "Food served at correct temperature",
                "À la carte dishes served within 15 minutes",
                "Presentation appealing and portion consistent",
            ]},
        ],
    },
    {
        "name": "Bar Service",
        "department": "Food & Beverage",
        "icon": "wine-outline",
        "sections": [
            {"name": "Arrival & Order", "items": [
                "Guest acknowledged within 30 seconds of arrival",
                "Drink order taken within 3 minutes of seating",
                "Staff knowledgeable on cocktails, wines and spirits",
            ]},
            {"name": "Beverage Quality & Service", "items": [
                "Drink served in correct glassware with correct garnish",
                "Bar snacks offered with the first drink",
                "Table kept clear — empties removed promptly",
                "Further drinks offered when glass is nearly empty",
                "Bill accurate and payment handled discreetly",
            ]},
        ],
    },
    {
        "name": "Telephone & Concierge",
        "department": "Front Office",
        "icon": "call-outline",
        "sections": [
            {"name": "Telephone Standards", "items": [
                "Telephone answered within 3 rings with proper greeting",
                "No hold longer than 30 seconds without option to call back",
                "Wake-up call delivered within 2 minutes of requested time",
                "Staff tone warm, clear and unhurried",
            ]},
            {"name": "Concierge Service", "items": [
                "Directions and recommendations knowledgeable and confident",
                "Bookings confirmed in writing or with a confirmation card",
                "Suggestions personalized to the guest's interests",
                "Follow-up made to check guest satisfaction",
            ]},
        ],
    },
    {
        "name": "Check-Out & Departure",
        "department": "Front Office",
        "icon": "log-out-outline",
        "sections": [
            {"name": "Check-Out", "items": [
                "Queue time less than 2 minutes",
                "Bill accurate, clearly explained and discreetly presented",
                "Feedback on the stay sought",
                "Guest name used during check-out",
            ]},
            {"name": "Departure", "items": [
                "Luggage collected and brought down within 10 minutes",
                "Transport arranged or doorman assistance offered",
                "Warm farewell given and guest invited to return",
            ]},
        ],
    },
    {
        "name": "Spa, Pool & Fitness",
        "department": "Wellness",
        "icon": "fitness-outline",
        "sections": [
            {"name": "Reception & Service", "items": [
                "Guest greeted within 30 seconds at facility reception",
                "Facility orientation / tour offered",
                "Therapist consulted guest on pressure and preferences",
                "Treatment started and finished on time",
            ]},
            {"name": "Facility Standards", "items": [
                "Pool water chlorine/pH levels logged today",
                "Pool deck clean, dry and safety equipment in place",
                "Fresh towels stacked and replenished",
                "Gym equipment sanitized and fully functional",
                "Changing rooms spotless with amenities stocked",
            ]},
        ],
    },
    {
        "name": "PPM Room Maintenance",
        "department": "Maintenance",
        "icon": "construct-outline",
        "sections": [
            {"name": "Electrical", "items": [
                "All sockets, switches and dimmers functional",
                "No exposed or loose wiring visible",
                "All lighting fixtures and bulbs working",
                "AC filter cleaned and unit serviced per PPM schedule",
                "TV, minibar and kettle operational with no fault codes",
            ]},
            {"name": "Plumbing", "items": [
                "No leaks under sink, WC or behind panels",
                "Drainage flowing freely in sink, shower and floor trap",
                "Hot water within 30 seconds at correct pressure",
                "Shower head descaled and spray uniform",
                "Flush mechanism working, no continuous running water",
            ]},
            {"name": "HVAC & Ventilation", "items": [
                "AC cooling to setpoint within 10 minutes",
                "No unusual noise or vibration from AC unit",
                "Thermostat calibrated and responsive",
                "Bathroom exhaust fan working and clean",
            ]},
            {"name": "Furniture & Fixtures", "items": [
                "Door lock, latch and self-closer aligned and smooth",
                "Hinges lubricated, no squeaks on doors/wardrobes",
                "Furniture stable with no wobble or damage",
                "Curtain tracks and blinds operating smoothly",
                "Walls, paint and ceiling free of damp patches or peeling",
            ]},
            {"name": "Safety", "items": [
                "Smoke detector tested and indicator light on",
                "Emergency evacuation card present behind door",
                "Window / balcony locks secure and functional",
                "No trip hazards from carpet edges or cables",
            ]},
        ],
    },
]

OLD_SEED_NAMES = ["Guest Room Inspection", "Kitchen & F&B Hygiene", "Front Office & Lobby", "Pool, Gym & Wellness"]
SEED_VERSION = 4


async def seed_templates():
    meta = await db.meta.find_one({"key": "seed_version"})
    if meta and meta.get("value", 0) >= SEED_VERSION:
        return
    # Remove previous seeded templates (keeps user-created ones)
    await db.templates.delete_many({"name": {"$in": OLD_SEED_NAMES}})
    await db.templates.delete_many({"seeded": True})
    for t in SEED_TEMPLATES:
        doc = {
            "id": str(uuid.uuid4()),
            "name": t["name"],
            "department": t["department"],
            "icon": t["icon"],
            "sections": [
                {"name": s["name"], "items": [{"id": str(uuid.uuid4()), "text": it} for it in s["items"]]}
                for s in t["sections"]
            ],
            "seeded": True,
            "created_at": now_iso(),
        }
        await db.templates.insert_one(doc)
    await db.meta.update_one({"key": "seed_version"}, {"$set": {"value": SEED_VERSION}}, upsert=True)
    logger.info("Seeded LQA templates (v%s)", SEED_VERSION)


@app.on_event("startup")
async def on_startup():
    await seed_templates()
    await seed_admin()


# ---------- Locations ----------
ROOM_FLOORS = [
    {"floor": "4th Floor", "rooms": [400] + list(range(402, 413)) + list(range(414, 417))},
    {"floor": "5th Floor", "rooms": [500] + list(range(502, 513)) + list(range(514, 517))},
    {"floor": "6th Floor", "rooms": [600] + list(range(602, 613)) + [614, 615]},
    {"floor": "7th Floor", "rooms": [700] + list(range(702, 713)) + [714, 715]},
]
AREAS = ["Main Kitchen", "Cafe Kitchen", "Yellow Mirchi Restaurant", "Cafe24"]


@api_router.get("/locations")
async def get_locations():
    return {
        "floors": [{"floor": f["floor"], "rooms": [str(r) for r in f["rooms"]]} for f in ROOM_FLOORS],
        "areas": AREAS,
    }


# ---------- Templates ----------
@api_router.get("/templates")
async def list_templates():
    return await db.templates.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)


@api_router.post("/templates")
async def create_template(body: TemplateCreate):
    doc = body.dict()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.templates.insert_one({**doc})
    doc.pop("_id", None)
    return doc


@api_router.delete("/templates/{template_id}")
async def delete_template(template_id: str):
    res = await db.templates.delete_one({"id": template_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Template not found")
    return {"ok": True}


# ---------- Audits ----------
async def _create_audit_from_template(template_id: str, auditor_name: str, location: Optional[str]):
    template = await db.templates.find_one({"id": template_id}, {"_id": 0})
    if not template:
        raise HTTPException(404, "Template not found")
    items = []
    for section in template["sections"]:
        for it in section["items"]:
            items.append({
                "id": it["id"], "text": it["text"], "section": section["name"],
                "result": None, "note": "", "photo_base64": None,
            })
    audit = {
        "id": str(uuid.uuid4()),
        "template_id": template["id"],
        "template_name": template["name"],
        "department": template["department"],
        "icon": template.get("icon", "clipboard-outline"),
        "auditor_name": auditor_name,
        "location": location,
        "status": "in_progress",
        "items": items,
        "score": None,
        "ai_summary": None,
        "started_at": now_iso(),
        "completed_at": None,
    }
    await db.audits.insert_one({**audit})
    audit.pop("_id", None)
    return audit


@api_router.post("/audits")
async def create_audit(body: AuditCreate):
    return await _create_audit_from_template(body.template_id, body.auditor_name, body.location)


@api_router.get("/audits")
async def list_audits(status: Optional[str] = None):
    query = {"status": status} if status else {}
    return await db.audits.find(query, {"_id": 0, "items.photo_base64": 0, "ai_summary": 0}).sort("started_at", -1).to_list(500)


@api_router.get("/audits/{audit_id}")
async def get_audit(audit_id: str):
    audit = await db.audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(404, "Audit not found")
    return audit


def compute_score(items):
    passed = sum(1 for i in items if i["result"] == "pass")
    failed = sum(1 for i in items if i["result"] == "fail")
    scored = passed + failed
    return round(passed / scored * 100, 1) if scored else None


@api_router.put("/audits/{audit_id}")
async def update_audit(audit_id: str, body: AuditUpdate):
    audit = await db.audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit:
        raise HTTPException(404, "Audit not found")
    items = [i.dict() for i in body.items]
    update = {"items": items, "status": body.status}
    if body.status == "completed":
        update["score"] = compute_score(items)
        update["completed_at"] = now_iso()
        # Auto-create action items for failed checks
        for it in items:
            if it["result"] == "fail":
                exists = await db.action_items.find_one({"audit_id": audit_id, "source_item_id": it["id"]})
                if not exists:
                    loc = audit.get("location")
                    await db.action_items.insert_one({
                        "id": str(uuid.uuid4()),
                        "title": it["text"],
                        "description": it["note"] or f"Failed during '{audit['template_name']}' audit" + (f" at {loc}" if loc else ""),
                        "department": audit["department"],
                        "priority": "high",
                        "status": "open",
                        "audit_id": audit_id,
                        "location": loc,
                        "assignee": None,
                        "due_date": (datetime.now(timezone.utc) + timedelta(days=3)).date().isoformat(),
                        "source_item_id": it["id"],
                        "created_at": now_iso(),
                    })
    await db.audits.update_one({"id": audit_id}, {"$set": update})
    return await db.audits.find_one({"id": audit_id}, {"_id": 0})


@api_router.delete("/audits/{audit_id}")
async def delete_audit(audit_id: str):
    res = await db.audits.delete_one({"id": audit_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Audit not found")
    return {"ok": True}


# ---------- AI Summary ----------
@api_router.post("/audits/{audit_id}/summary")
async def generate_summary(audit_id: str):
    audit = await db.audits.find_one({"id": audit_id}, {"_id": 0, "items.photo_base64": 0})
    if not audit:
        raise HTTPException(404, "Audit not found")
    if audit["status"] != "completed":
        raise HTTPException(400, "Audit must be completed first")

    lines = []
    loc_line = f" | Location: {audit.get('location')}" if audit.get("location") else ""
    for it in audit["items"]:
        note = f" — note: {it['note']}" if it["note"] else ""
        lines.append(f"[{it['section']}] {it['text']}: {(it['result'] or 'not answered').upper()}{note}")
    prompt = (
        f"Audit: {audit['template_name']} | Department: {audit['department']} | "
        f"Auditor: {audit['auditor_name']}{loc_line} | Score: {audit['score']}%\n\n"
        "Checklist results:\n" + "\n".join(lines) +
        "\n\nWrite a concise professional audit report summary (max 180 words) with: "
        "1) Overall assessment, 2) Key strengths, 3) Critical issues found, 4) Recommended corrective actions. "
        "Use short paragraphs with clear section labels. No markdown symbols like # or *."
    )

    try:
        from google import genai
        from google.genai import types as genai_types
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set in backend/.env")
        client = genai.Client(api_key=api_key)
        resp = await client.aio.models.generate_content(
            model=os.environ.get("GEMINI_SUMMARY_MODEL", "gemini-3-flash-preview"),
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction="You are a hotel quality assurance expert who writes crisp, actionable audit report summaries.",
            ),
        )
        summary = (resp.text or "").strip()
    except Exception as e:
        logger.error(f"AI summary failed: {e}")
        raise HTTPException(502, f"AI summary generation failed: {e}")

    await db.audits.update_one({"id": audit_id}, {"$set": {"ai_summary": summary}})
    return {"summary": summary}


# ---------- Action Items ----------
@api_router.get("/action-items")
async def list_action_items(status: Optional[str] = None):
    query = {"status": status} if status else {}
    return await db.action_items.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/action-items")
async def create_action_item(body: ActionItemCreate):
    doc = body.dict()
    doc.update({"id": str(uuid.uuid4()), "status": "open", "source_item_id": None, "created_at": now_iso()})
    await db.action_items.insert_one({**doc})
    doc.pop("_id", None)
    return doc


@api_router.patch("/action-items/{item_id}")
async def update_action_item(item_id: str, body: ActionItemUpdate):
    update = {k: v for k, v in body.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nothing to update")
    res = await db.action_items.update_one({"id": item_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Action item not found")
    return await db.action_items.find_one({"id": item_id}, {"_id": 0})


@api_router.delete("/action-items/{item_id}")
async def delete_action_item(item_id: str):
    res = await db.action_items.delete_one({"id": item_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Action item not found")
    return {"ok": True}


# ---------- Schedules ----------
def today_str() -> str:
    return datetime.now(timezone.utc).date().isoformat()


@api_router.get("/schedules")
async def list_schedules():
    schedules = await db.schedules.find({}, {"_id": 0}).sort("next_due", 1).to_list(500)
    today = today_str()
    for s in schedules:
        if not s["active"]:
            s["due_status"] = "paused"
        elif s["next_due"] < today:
            s["due_status"] = "overdue"
        elif s["next_due"] == today:
            s["due_status"] = "due_today"
        else:
            s["due_status"] = "upcoming"
    return schedules


@api_router.post("/schedules")
async def create_schedule(body: ScheduleCreate):
    template = await db.templates.find_one({"id": body.template_id}, {"_id": 0})
    if not template:
        raise HTTPException(404, "Template not found")
    doc = {
        "id": str(uuid.uuid4()),
        "template_id": template["id"],
        "template_name": template["name"],
        "department": template["department"],
        "icon": template.get("icon", "clipboard-outline"),
        "location": body.location,
        "auditor_name": body.auditor_name,
        "recurrence": body.recurrence,
        "next_due": body.start_date or today_str(),
        "active": True,
        "created_at": now_iso(),
    }
    await db.schedules.insert_one({**doc})
    doc.pop("_id", None)
    return doc


@api_router.post("/schedules/{schedule_id}/start")
async def start_scheduled_audit(schedule_id: str):
    s = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Schedule not found")
    audit = await _create_audit_from_template(s["template_id"], s["auditor_name"], s["location"])
    today = datetime.now(timezone.utc).date()
    if s["recurrence"] == "daily":
        update = {"next_due": (today + timedelta(days=1)).isoformat()}
    elif s["recurrence"] == "weekly":
        update = {"next_due": (today + timedelta(days=7)).isoformat()}
    else:
        update = {"active": False}
    await db.schedules.update_one({"id": schedule_id}, {"$set": update})
    return {"audit": audit}


@api_router.patch("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, body: ScheduleUpdate):
    update = {k: v for k, v in body.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nothing to update")
    res = await db.schedules.update_one({"id": schedule_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Schedule not found")
    return await db.schedules.find_one({"id": schedule_id}, {"_id": 0})


@api_router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str):
    res = await db.schedules.delete_one({"id": schedule_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Schedule not found")
    return {"ok": True}


# ---------- Users (admin) ----------
@api_router.get("/team")
async def list_team():
    """Approved team members — available to any authenticated user for assignee pickers."""
    return await db.users.find(
        {"approved": True}, {"_id": 0, "id": 1, "name": 1, "role": 1}
    ).sort("name", 1).to_list(500)


@api_router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return users


@api_router.post("/users/{user_id}/approve")
async def approve_user(user_id: str, admin: dict = Depends(require_admin)):
    res = await db.users.update_one({"id": user_id}, {"$set": {"approved": True}})
    if res.matched_count == 0:
        raise HTTPException(404, "User not found")
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "You cannot remove your own account")
    res = await db.users.delete_one({"id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True}


# ---------- Analytics ----------
@api_router.get("/analytics/room-coverage")
async def room_coverage(days: int = 7):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    audits = await db.audits.find(
        {"status": "completed", "completed_at": {"$gte": since}, "location": {"$regex": "^Room "}},
        {"_id": 0, "location": 1, "completed_at": 1, "score": 1},
    ).to_list(2000)
    latest: dict = {}
    for a in audits:
        room = a["location"].replace("Room ", "")
        if room not in latest or a["completed_at"] > latest[room]["completed_at"]:
            latest[room] = a
    floors_out = []
    total = 0
    audited = 0
    for f in ROOM_FLOORS:
        rooms = []
        for r in f["rooms"]:
            rs = str(r)
            total += 1
            info = latest.get(rs)
            if info:
                audited += 1
            rooms.append({
                "room": rs,
                "audited": bool(info),
                "last_audit": info["completed_at"] if info else None,
                "score": info["score"] if info else None,
            })
        floors_out.append({"floor": f["floor"], "rooms": rooms})
    return {
        "days": days,
        "total_rooms": total,
        "audited_rooms": audited,
        "coverage_pct": round(audited / total * 100, 1) if total else 0,
        "floors": floors_out,
    }


@api_router.get("/analytics")
async def analytics():
    completed = await db.audits.find({"status": "completed"}, {"_id": 0, "items.photo_base64": 0, "ai_summary": 0}).sort("completed_at", 1).to_list(1000)
    in_progress_count = await db.audits.count_documents({"status": "in_progress"})
    open_actions = await db.action_items.count_documents({"status": {"$in": ["open", "in_progress"]}})

    scores = [a["score"] for a in completed if a.get("score") is not None]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None

    dept_map = {}
    for a in completed:
        if a.get("score") is None:
            continue
        d = dept_map.setdefault(a["department"], {"total": 0.0, "count": 0})
        d["total"] += a["score"]
        d["count"] += 1
    dept_scores = [
        {"department": k, "avg_score": round(v["total"] / v["count"], 1), "count": v["count"]}
        for k, v in dept_map.items()
    ]
    dept_scores.sort(key=lambda x: x["avg_score"], reverse=True)

    trend = [
        {"date": a["completed_at"], "score": a["score"], "name": a["template_name"]}
        for a in completed[-10:] if a.get("score") is not None
    ]

    return {
        "total_audits": len(completed) + in_progress_count,
        "completed_audits": len(completed),
        "in_progress_audits": in_progress_count,
        "avg_score": avg_score,
        "open_actions": open_actions,
        "dept_scores": dept_scores,
        "trend": trend,
    }


app.include_router(auth_router)
app.include_router(api_router, dependencies=[Depends(get_current_user)])

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
