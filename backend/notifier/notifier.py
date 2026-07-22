import os
import json
import asyncio
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from pywebpush import webpush, WebPushException

VAPID_PRIVATE_KEY = os.environ["VAPID_PRIVATE_KEY"]
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@cityparkhotel.in")


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
                vapid_private_key=VAPID_PRIVATE_KEY,
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

        print(f"Notifier run: {len(due_schedules)} due schedules, {len(overdue_items)} overdue items")
    finally:
        client.close()


def handler(event, context):
    asyncio.run(run_checks())
    return {"status": "ok"}
