"""
Iteration 3 backend tests:
- JWT auth on /api/*
- register/login/approve/delete users
- room-coverage endpoint
- action items with assignee/due_date + auto-created action items get +3 days
Regression: templates/audits/analytics/action-items still work with token.
"""
import os
import uuid
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE:
    # fall back to reading frontend .env
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE = ln.split("=", 1)[1].strip().strip('"').rstrip("/")
                break
assert BASE, "EXPO_PUBLIC_BACKEND_URL missing"
API = f"{BASE}/api"

ADMIN = {"email": "admin@citypark.com", "password": "CityPark2026!"}


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def admin_hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _rand_email(prefix="test"):
    # backend lowercases email on register, so keep it lowercase to match later
    return f"test_{prefix}_{uuid.uuid4().hex[:8]}@example.com"


# ---------- Auth guard ----------
class TestAuthGuard:
    def test_templates_requires_auth(self):
        r = requests.get(f"{API}/templates", timeout=10)
        assert r.status_code == 403

    def test_audits_requires_auth(self):
        r = requests.get(f"{API}/audits", timeout=10)
        assert r.status_code == 403

    def test_action_items_requires_auth(self):
        r = requests.get(f"{API}/action-items", timeout=10)
        assert r.status_code == 403

    def test_analytics_requires_auth(self):
        r = requests.get(f"{API}/analytics", timeout=10)
        assert r.status_code == 403

    def test_schedules_requires_auth(self):
        r = requests.get(f"{API}/schedules", timeout=10)
        assert r.status_code == 403

    def test_room_coverage_requires_auth(self):
        r = requests.get(f"{API}/analytics/room-coverage", timeout=10)
        assert r.status_code == 403

    def test_register_is_public(self):
        r = requests.post(f"{API}/auth/register", json={
            "name": "TEST_public", "email": _rand_email("pub"), "password": "abcdef",
        }, timeout=10)
        assert r.status_code == 200, r.text

    def test_login_is_public_wrong_password(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADMIN["email"], "password": "wrong"}, timeout=10)
        assert r.status_code == 401


# ---------- Register/login/approve flow ----------
class TestUserApproval:
    email = None
    user_id = None
    token = None

    def test_register_pending(self, admin_hdr):
        TestUserApproval.email = _rand_email("approve")
        r = requests.post(f"{API}/auth/register", json={
            "name": "TEST_pending", "email": TestUserApproval.email, "password": "pass123",
        }, timeout=10)
        assert r.status_code == 200
        assert "approv" in r.json()["message"].lower()

    def test_pending_cannot_login(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": TestUserApproval.email, "password": "pass123"},
                          timeout=10)
        assert r.status_code == 403
        assert "approval" in r.json()["detail"].lower()

    def test_list_users_admin(self, admin_hdr):
        r = requests.get(f"{API}/users", headers=admin_hdr, timeout=10)
        assert r.status_code == 200
        users = r.json()
        match = [u for u in users if u["email"] == TestUserApproval.email]
        assert match, "pending user not returned"
        assert match[0]["approved"] is False
        TestUserApproval.user_id = match[0]["id"]

    def test_approve_user(self, admin_hdr):
        r = requests.post(f"{API}/users/{TestUserApproval.user_id}/approve",
                          headers=admin_hdr, timeout=10)
        assert r.status_code == 200
        assert r.json()["approved"] is True

    def test_login_after_approval(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": TestUserApproval.email, "password": "pass123"},
                          timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["approved"] is True
        assert body["user"]["role"] == "auditor"
        TestUserApproval.token = body["access_token"]

    def test_me_with_token(self):
        r = requests.get(f"{API}/auth/me",
                         headers={"Authorization": f"Bearer {TestUserApproval.token}"},
                         timeout=10)
        assert r.status_code == 200
        assert r.json()["email"] == TestUserApproval.email

    def test_auditor_cannot_list_users(self):
        r = requests.get(f"{API}/users",
                         headers={"Authorization": f"Bearer {TestUserApproval.token}"},
                         timeout=10)
        assert r.status_code == 403

    def test_admin_delete_user(self, admin_hdr):
        r = requests.delete(f"{API}/users/{TestUserApproval.user_id}",
                            headers=admin_hdr, timeout=10)
        assert r.status_code == 200

    def test_admin_cannot_delete_self(self, admin_hdr, admin_token):
        me = requests.get(f"{API}/auth/me", headers=admin_hdr, timeout=10).json()
        r = requests.delete(f"{API}/users/{me['id']}", headers=admin_hdr, timeout=10)
        assert r.status_code == 400


# ---------- Room coverage ----------
class TestRoomCoverage:
    def test_coverage_shape(self, admin_hdr):
        r = requests.get(f"{API}/analytics/room-coverage?days=7",
                         headers=admin_hdr, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["days"] == 7
        assert isinstance(d["floors"], list) and len(d["floors"]) == 4
        assert d["total_rooms"] > 0
        # every room has boolean audited flag
        room = d["floors"][0]["rooms"][0]
        assert "audited" in room and isinstance(room["audited"], bool)
        assert "room" in room

    def test_completing_audit_flips_room(self, admin_hdr):
        # pick a template
        t = requests.get(f"{API}/templates", headers=admin_hdr, timeout=10).json()[0]
        # create audit for Room 403
        c = requests.post(f"{API}/audits", headers=admin_hdr, json={
            "template_id": t["id"], "auditor_name": "TEST_cov", "location": "Room 403",
        }, timeout=10)
        assert c.status_code == 200
        audit = c.json()
        items = [{**it, "result": "pass"} for it in audit["items"]]
        u = requests.put(f"{API}/audits/{audit['id']}", headers=admin_hdr,
                         json={"items": items, "status": "completed"}, timeout=15)
        assert u.status_code == 200
        # verify room 403 audited
        r = requests.get(f"{API}/analytics/room-coverage?days=7",
                         headers=admin_hdr, timeout=10)
        floors = r.json()["floors"]
        rooms_403 = [
            room for f in floors for room in f["rooms"] if room["room"] == "403"
        ]
        assert rooms_403 and rooms_403[0]["audited"] is True
        assert rooms_403[0]["last_audit"] is not None
        # cleanup
        requests.delete(f"{API}/audits/{audit['id']}", headers=admin_hdr, timeout=10)


# ---------- Action items assignee / due_date ----------
class TestActionItemsExtras:
    created_id = None

    def test_create_with_assignee_due(self, admin_hdr):
        r = requests.post(f"{API}/action-items", headers=admin_hdr, json={
            "title": "TEST_assignee_due",
            "description": "check assignee",
            "department": "Front Office",
            "priority": "medium",
            "assignee": "Anita",
            "due_date": "2026-02-01",
        }, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["assignee"] == "Anita"
        assert body["due_date"] == "2026-02-01"
        TestActionItemsExtras.created_id = body["id"]

    def test_patch_assignee_due(self, admin_hdr):
        r = requests.patch(
            f"{API}/action-items/{TestActionItemsExtras.created_id}",
            headers=admin_hdr,
            json={"assignee": "Ravi", "due_date": "2026-03-15"},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["assignee"] == "Ravi"
        assert r.json()["due_date"] == "2026-03-15"

    def test_cleanup(self, admin_hdr):
        r = requests.delete(f"{API}/action-items/{TestActionItemsExtras.created_id}",
                            headers=admin_hdr, timeout=10)
        assert r.status_code == 200

    def test_auto_action_item_from_failed_check(self, admin_hdr):
        # NOTE: per spec, auto-created items from failed audit checks should get due_date = +3 days
        t = requests.get(f"{API}/templates", headers=admin_hdr, timeout=10).json()[0]
        c = requests.post(f"{API}/audits", headers=admin_hdr, json={
            "template_id": t["id"], "auditor_name": "TEST_autoact",
            "location": "Room 500",
        }, timeout=10).json()
        items = [{**it, "result": "pass"} for it in c["items"]]
        items[0]["result"] = "fail"
        items[0]["note"] = "TEST_fail_note"
        u = requests.put(f"{API}/audits/{c['id']}", headers=admin_hdr,
                         json={"items": items, "status": "completed"}, timeout=15)
        assert u.status_code == 200
        # find the auto-created action item
        acts = requests.get(f"{API}/action-items", headers=admin_hdr, timeout=10).json()
        auto = [a for a in acts if a.get("audit_id") == c["id"]]
        assert auto, "auto action item not created"
        # per spec, due_date should be +3 days
        if auto[0].get("due_date"):
            expected = (datetime.now(timezone.utc).date() + timedelta(days=3)).isoformat()
            assert auto[0]["due_date"] == expected, \
                f"expected +3 days ({expected}), got {auto[0]['due_date']}"
        else:
            pytest.fail("auto-created action item has no due_date (spec requires +3 days)")
        # cleanup
        for a in auto:
            requests.delete(f"{API}/action-items/{a['id']}", headers=admin_hdr, timeout=10)
        requests.delete(f"{API}/audits/{c['id']}", headers=admin_hdr, timeout=10)


# ---------- Regression ----------
class TestRegression:
    def test_templates_with_token(self, admin_hdr):
        r = requests.get(f"{API}/templates", headers=admin_hdr, timeout=10)
        assert r.status_code == 200
        assert len(r.json()) >= 6

    def test_analytics_with_token(self, admin_hdr):
        r = requests.get(f"{API}/analytics", headers=admin_hdr, timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ["total_audits", "completed_audits", "avg_score", "dept_scores", "trend"]:
            assert k in d
