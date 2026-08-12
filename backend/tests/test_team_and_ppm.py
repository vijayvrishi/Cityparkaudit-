"""Iteration 4 backend tests: /api/team endpoint + PPM Room Maintenance template + assignee updates."""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "https://audit-hotel-check.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@citypark.com"
ADMIN_PASSWORD = "CityPark2026!"
AUDITOR_EMAIL = "auditor@test.com"
AUDITOR_PASSWORD = "test123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auditor_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": AUDITOR_EMAIL, "password": AUDITOR_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"auditor login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def auth(t):
    return {"Authorization": f"Bearer {t}"}


# ----- /api/team -----
class TestTeamEndpoint:
    def test_team_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/team", timeout=15)
        # HTTPBearer returns 403 when no creds provided
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_team_works_for_auditor_not_admin_only(self, auditor_token):
        r = requests.get(f"{BASE_URL}/api/team", headers=auth(auditor_token), timeout=15)
        assert r.status_code == 200, f"auditor should access /api/team, got {r.status_code} {r.text}"
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 2  # admin + auditor at minimum

    def test_team_returns_approved_only_with_fields(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/team", headers=auth(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 2
        for m in data:
            assert set(m.keys()) == {"id", "name", "role"}, f"unexpected keys: {m.keys()}"
            assert isinstance(m["id"], str) and m["id"]
            assert isinstance(m["name"], str) and m["name"]
            assert m["role"] in ("admin", "auditor")

    def test_team_excludes_pending_users(self, admin_token):
        # Register a pending user then confirm they are NOT in team list
        email = "TEST_pending_team@example.com"
        requests.post(f"{BASE_URL}/api/auth/register",
                      json={"name": "TEST Pending", "email": email, "password": "test123"}, timeout=15)
        r = requests.get(f"{BASE_URL}/api/team", headers=auth(admin_token), timeout=15)
        assert r.status_code == 200
        names = [m["name"] for m in r.json()]
        assert "TEST Pending" not in names
        # Cleanup: find id via /api/users then delete
        users = requests.get(f"{BASE_URL}/api/users", headers=auth(admin_token), timeout=15).json()
        for u in users:
            if u["email"] == email.lower():
                requests.delete(f"{BASE_URL}/api/users/{u['id']}", headers=auth(admin_token), timeout=15)


# ----- PPM Room Maintenance template -----
class TestPPMTemplate:
    def test_templates_count_is_9(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/templates", headers=auth(admin_token), timeout=15)
        assert r.status_code == 200
        # Filter to seeded templates only (test templates from prior runs may exist)
        seeded = [t for t in r.json() if t.get("seeded")]
        assert len(seeded) == 9, f"expected 9 seeded templates, got {len(seeded)}: {[t['name'] for t in seeded]}"

    def test_ppm_template_shape(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/templates", headers=auth(admin_token), timeout=15)
        ppm = next((t for t in r.json() if t["name"] == "PPM Room Maintenance"), None)
        assert ppm is not None, "PPM Room Maintenance template missing"
        assert ppm["department"] == "Maintenance"
        section_names = [s["name"] for s in ppm["sections"]]
        for expected in ("Electrical", "Plumbing", "HVAC & Ventilation", "Furniture & Fixtures", "Safety"):
            assert expected in section_names, f"missing section {expected}; got {section_names}"
        assert len(ppm["sections"]) == 5

    def test_ppm_audit_create_and_complete(self, admin_token):
        tpl_resp = requests.get(f"{BASE_URL}/api/templates", headers=auth(admin_token), timeout=15).json()
        ppm = next(t for t in tpl_resp if t["name"] == "PPM Room Maintenance")
        # Create audit at Room 612
        c = requests.post(f"{BASE_URL}/api/audits",
                         headers=auth(admin_token),
                         json={"template_id": ppm["id"], "auditor_name": "TEST_ppm", "location": "Room 612"},
                         timeout=15)
        assert c.status_code == 200, c.text
        audit = c.json()
        assert audit["department"] == "Maintenance"
        assert audit["location"] == "Room 612"
        assert len(audit["items"]) >= 20  # 5+5+4+5+4 = 23

        # Complete: mark all pass
        items = [{**it, "result": "pass"} for it in audit["items"]]
        u = requests.put(f"{BASE_URL}/api/audits/{audit['id']}",
                        headers=auth(admin_token),
                        json={"items": items, "status": "completed"},
                        timeout=15)
        assert u.status_code == 200
        completed = u.json()
        assert completed["status"] == "completed"
        assert completed["score"] == 100.0

        # Cleanup
        requests.delete(f"{BASE_URL}/api/audits/{audit['id']}", headers=auth(admin_token), timeout=15)


# ----- PATCH /api/action-items/{id} assignee -----
class TestAssigneeUpdate:
    def test_assignee_set_and_unset(self, admin_token):
        create = requests.post(f"{BASE_URL}/api/action-items",
                               headers=auth(admin_token),
                               json={"title": "TEST_assignee_test", "department": "Maintenance",
                                     "priority": "medium"},
                               timeout=15)
        assert create.status_code == 200
        item = create.json()
        item_id = item["id"]
        assert item.get("assignee") in (None, "")

        # Assign
        r1 = requests.patch(f"{BASE_URL}/api/action-items/{item_id}",
                            headers=auth(admin_token),
                            json={"assignee": "Test Auditor"},
                            timeout=15)
        assert r1.status_code == 200
        assert r1.json()["assignee"] == "Test Auditor"

        # GET to verify persistence
        g = requests.get(f"{BASE_URL}/api/action-items", headers=auth(admin_token), timeout=15).json()
        found = next(x for x in g if x["id"] == item_id)
        assert found["assignee"] == "Test Auditor"

        # Unassign with empty string
        # NOTE: server currently filters out None values but "" is truthy for {k:v ...}
        # Confirm behavior
        r2 = requests.patch(f"{BASE_URL}/api/action-items/{item_id}",
                            headers=auth(admin_token),
                            json={"assignee": ""},
                            timeout=15)
        assert r2.status_code == 200
        # After unassign, expect empty string or None
        val = r2.json().get("assignee")
        assert val in ("", None), f"assignee should be cleared, got {val!r}"

        # Cleanup
        requests.delete(f"{BASE_URL}/api/action-items/{item_id}",
                        headers=auth(admin_token), timeout=15)
