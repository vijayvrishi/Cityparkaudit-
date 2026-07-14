"""Backend tests for iteration 2: schedules + regression for audits/templates/actions/analytics."""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def a_template(s):
    r = s.get(f"{API}/templates", timeout=20)
    assert r.status_code == 200
    templates = r.json()
    assert len(templates) >= 8, f"Expected 8 LQA templates, got {len(templates)}"
    # Pick "Room Checklist" if present
    for t in templates:
        if t["name"] == "Room Checklist":
            return t
    return templates[0]


# ---------- Regression: templates + locations ----------
class TestRegressionBasics:
    def test_templates_seeded_lqa(self, s):
        r = s.get(f"{API}/templates", timeout=20)
        assert r.status_code == 200
        names = {t["name"] for t in r.json()}
        expected = {"Room Checklist", "Arrival & Check-In", "In-Room Dining",
                    "Restaurant & Breakfast", "Bar Service", "Telephone & Concierge",
                    "Check-Out & Departure", "Spa, Pool & Fitness"}
        assert expected.issubset(names), f"Missing LQA templates. Got: {names}"

    def test_locations(self, s):
        r = s.get(f"{API}/locations", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "floors" in data and "areas" in data
        assert len(data["floors"]) == 4
        assert "405" in data["floors"][0]["rooms"] or any("405" in f["rooms"] for f in data["floors"])
        assert "Main Kitchen" in data["areas"]


# ---------- Schedules ----------
class TestSchedules:
    def test_create_schedule_daily_due_today(self, s, a_template):
        payload = {
            "template_id": a_template["id"],
            "location": "TEST_Room 405",
            "auditor_name": "TEST_Auditor",
            "recurrence": "daily",
        }
        r = s.post(f"{API}/schedules", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        sched = r.json()
        assert sched["id"]
        assert sched["template_name"] == a_template["name"]
        assert sched["recurrence"] == "daily"
        assert sched["active"] is True
        assert sched["next_due"] == datetime.now(timezone.utc).date().isoformat()
        assert "_id" not in sched
        pytest.daily_id = sched["id"]

    def test_list_shows_due_today(self, s):
        r = s.get(f"{API}/schedules", timeout=20)
        assert r.status_code == 200
        items = r.json()
        found = next((x for x in items if x["id"] == pytest.daily_id), None)
        assert found, "Created schedule not returned in list"
        assert found["due_status"] == "due_today", f"Expected due_today, got {found['due_status']}"

    def test_create_schedule_missing_template_404(self, s):
        r = s.post(f"{API}/schedules", json={"template_id": "does-not-exist", "recurrence": "daily"}, timeout=20)
        assert r.status_code == 404

    def test_start_daily_creates_audit_and_advances(self, s):
        r = s.post(f"{API}/schedules/{pytest.daily_id}/start", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "audit" in data
        audit = data["audit"]
        assert audit["status"] == "in_progress"
        assert audit["location"] == "TEST_Room 405"
        assert audit["auditor_name"] == "TEST_Auditor"
        pytest.audit_id = audit["id"]

        # Verify next_due advanced by 1 day
        r2 = s.get(f"{API}/schedules", timeout=20)
        found = next((x for x in r2.json() if x["id"] == pytest.daily_id), None)
        expected = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
        assert found["next_due"] == expected, f"Expected next_due={expected}, got {found['next_due']}"
        assert found["due_status"] == "upcoming"

    def test_pause_and_resume(self, s):
        r = s.patch(f"{API}/schedules/{pytest.daily_id}", json={"active": False}, timeout=20)
        assert r.status_code == 200
        assert r.json()["active"] is False

        r2 = s.get(f"{API}/schedules", timeout=20)
        found = next((x for x in r2.json() if x["id"] == pytest.daily_id), None)
        assert found["due_status"] == "paused"

        # resume
        r3 = s.patch(f"{API}/schedules/{pytest.daily_id}", json={"active": True}, timeout=20)
        assert r3.status_code == 200
        assert r3.json()["active"] is True

    def test_once_recurrence_deactivates_on_start(self, s, a_template):
        r = s.post(f"{API}/schedules", json={
            "template_id": a_template["id"], "recurrence": "once",
            "auditor_name": "TEST_Once", "location": "TEST_Once"
        }, timeout=20)
        assert r.status_code == 200
        once_id = r.json()["id"]

        r2 = s.post(f"{API}/schedules/{once_id}/start", timeout=30)
        assert r2.status_code == 200

        r3 = s.get(f"{API}/schedules", timeout=20)
        found = next((x for x in r3.json() if x["id"] == once_id), None)
        assert found["active"] is False
        assert found["due_status"] == "paused"

        # cleanup
        s.delete(f"{API}/schedules/{once_id}", timeout=20)

    def test_weekly_recurrence_advances_7_days(self, s, a_template):
        r = s.post(f"{API}/schedules", json={
            "template_id": a_template["id"], "recurrence": "weekly", "auditor_name": "TEST_Weekly"
        }, timeout=20)
        wid = r.json()["id"]
        r2 = s.post(f"{API}/schedules/{wid}/start", timeout=30)
        assert r2.status_code == 200
        r3 = s.get(f"{API}/schedules", timeout=20)
        found = next((x for x in r3.json() if x["id"] == wid), None)
        expected = (datetime.now(timezone.utc).date() + timedelta(days=7)).isoformat()
        assert found["next_due"] == expected
        s.delete(f"{API}/schedules/{wid}", timeout=20)

    def test_delete_schedule(self, s):
        r = s.delete(f"{API}/schedules/{pytest.daily_id}", timeout=20)
        assert r.status_code == 200
        # Verify gone
        r2 = s.get(f"{API}/schedules", timeout=20)
        ids = {x["id"] for x in r2.json()}
        assert pytest.daily_id not in ids

    def test_delete_missing_schedule_404(self, s):
        r = s.delete(f"{API}/schedules/does-not-exist", timeout=20)
        assert r.status_code == 404

    def test_patch_missing_schedule_404(self, s):
        r = s.patch(f"{API}/schedules/does-not-exist", json={"active": False}, timeout=20)
        assert r.status_code == 404

    def test_start_missing_schedule_404(self, s):
        r = s.post(f"{API}/schedules/does-not-exist/start", timeout=20)
        assert r.status_code == 404


# ---------- Regression: audits/action-items/analytics ----------
class TestRegressionFlows:
    def test_create_audit_direct_uses_helper(self, s, a_template):
        r = s.post(f"{API}/audits", json={
            "template_id": a_template["id"], "auditor_name": "TEST_direct", "location": "TEST_Room 500"
        }, timeout=20)
        assert r.status_code == 200
        audit = r.json()
        assert audit["status"] == "in_progress"
        assert audit["location"] == "TEST_Room 500"
        assert audit["auditor_name"] == "TEST_direct"
        assert len(audit["items"]) > 0
        assert audit["items"][0]["result"] is None
        pytest.reg_audit_id = audit["id"]

    def test_complete_audit_score_and_action_items(self, s):
        # answer: pass, fail, pass, fail, na (rotate)
        r = s.get(f"{API}/audits/{pytest.reg_audit_id}", timeout=20)
        audit = r.json()
        results = ["pass", "fail", "pass", "fail", "na"]
        for i, it in enumerate(audit["items"]):
            it["result"] = results[i % len(results)]
            it["note"] = "TEST_note" if it["result"] == "fail" else ""

        r2 = s.put(f"{API}/audits/{pytest.reg_audit_id}", json={
            "items": audit["items"], "status": "completed"
        }, timeout=20)
        assert r2.status_code == 200, r2.text
        completed = r2.json()
        assert completed["status"] == "completed"
        assert completed["score"] is not None
        assert 0 <= completed["score"] <= 100
        assert completed["completed_at"]

        # Verify action items auto-created for failures
        r3 = s.get(f"{API}/action-items", timeout=20)
        assert r3.status_code == 200
        for_this = [a for a in r3.json() if a.get("audit_id") == pytest.reg_audit_id]
        fail_count = sum(1 for it in completed["items"] if it["result"] == "fail")
        assert len(for_this) == fail_count, f"Expected {fail_count} action items, got {len(for_this)}"

    def test_analytics_endpoint(self, s):
        r = s.get(f"{API}/analytics", timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_audits", "completed_audits", "in_progress_audits",
                  "avg_score", "open_actions", "dept_scores", "trend"):
            assert k in d
        assert d["completed_audits"] >= 1
        assert isinstance(d["dept_scores"], list)

    def test_cleanup(self, s):
        # delete the reg audit
        s.delete(f"{API}/audits/{pytest.reg_audit_id}", timeout=20)
        # remove action items created for it
        r = s.get(f"{API}/action-items", timeout=20)
        for it in r.json():
            if it.get("audit_id") == pytest.reg_audit_id or (it.get("title", "").startswith("TEST_")):
                s.delete(f"{API}/action-items/{it['id']}", timeout=20)
