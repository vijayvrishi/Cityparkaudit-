import os
import json
import asyncio
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from pywebpush import webpush, WebPushException
from py_vapid import Vapid01

VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@cityparkhotel.in")
HISTORY_RETENTION_DAYS = 60
# pywebpush's from_string() fallback strips newlines but keeps the PEM BEGIN/END
# markers, so it can never actually parse a full PEM string - build a real
# Vapid01 object via from_pem() instead. See backend/DEPLOYMENT.md Gotcha #12.
_vapid = Vapid01.from_pem(os.environ["VAPID_PRIVATE_KEY"].encode())


def today_str() -> str:
    return datetime.now(timezone.utc).date().isoformat()


async def send_push_to_all(db, title: str, body: str, url: str = "/"):
    payload = json.dumps({"title": title, "body": body, "url": url})
    subs = await db.push_subscriptions.find({}, {"_id": 0}).to_list(2000)
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=payload,
                vapid_private_key=_vapid,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):
                await db.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
            else:
                print(f"Push send failed for {sub['endpoint'][:60]}: {e}")
        except Exception as e:
            # pywebpush's send() calls requests.post() with no exception wrapping, so a
            # genuinely unreachable endpoint raises a raw requests exception here, not
            # WebPushException - never let one bad subscription abort the whole run.
            print(f"Push send errored for {sub['endpoint'][:60]}: {e}")


async def purge_old_audits(db) -> int:
    # Guarded to run at most once/day (like last_notified_date below) - a full
    # collection scan on every hourly invocation isn't worth it for a job that
    # only needs day-level granularity.
    today = today_str()
    meta = await db.meta.find_one({"key": "last_purge_date"})
    if meta and meta.get("value") == today:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(days=HISTORY_RETENTION_DAYS)).isoformat()
    result = await db.audits.delete_many({"status": "completed", "completed_at": {"$lt": cutoff}})
    await db.meta.update_one({"key": "last_purge_date"}, {"$set": {"value": today}}, upsert=True)
    return result.deleted_count


async def run_checks():
    # Fresh client scoped to this single invocation only - never reused across
    # warm Lambda invocations, so there's no risk of the "MongoClient after
    # close" event-loop-reuse bug the main API Lambda has to work around.
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    try:
        today = today_str()

        due_schedules = await db.schedules.find({
            "active": True,
            "next_due": today,
            "last_notified_date": {"$ne": today},
        }, {"_id": 0}).to_list(500)
        for s in due_schedules:
            loc = s.get("location")
            await send_push_to_all(
                db,
                "Audit Due Today",
                f"'{s['template_name']}' is due" + (f" at {loc}" if loc else ""),
                "/schedules",
            )
            await db.schedules.update_one({"id": s["id"]}, {"$set": {"last_notified_date": today}})

        overdue_items = await db.action_items.find({
            "status": {"$in": ["open", "in_progress"]},
            "due_date": {"$lt": today},
            "overdue_notified": {"$ne": True},
        }, {"_id": 0}).to_list(500)
        for it in overdue_items:
            await send_push_to_all(db, "Action Item Overdue", it["title"], "/actions")
            await db.action_items.update_one({"id": it["id"]}, {"$set": {"overdue_notified": True}})

        purged = await purge_old_audits(db)

        print(f"Notifier run: {len(due_schedules)} due schedules, {len(overdue_items)} overdue items, {purged} audits purged")
    finally:
        client.close()


def handler(event, context):
    asyncio.run(run_checks())
    return {"status": "ok"}
