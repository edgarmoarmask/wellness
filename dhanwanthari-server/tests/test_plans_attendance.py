"""Brochure plans (flexible packages, validity), and staff attendance."""
import time
from datetime import date, timedelta

N = str(int(time.time() * 1000))[-5:]


def signin(client, email, pw):
    r = client.post("/api/auth/login", json={"email": email, "password": pw}).json()
    return {"authorization": "Bearer " + client.post("/api/auth/verify", json={"challengeId": r["challengeId"], "code": r["devCode"]}).json()["token"]}


def test_brochure_plans_seeded(api):
    _, pk = api("GET", "/api/packages")
    plans = {g["code"]: g for g in pk if g.get("code")}
    assert [plans[f"PLAN {i}"]["price"] for i in range(1, 6)] == [399, 999, 1499, 2499, 1999]
    assert [plans[f"PLAN {i}"]["sessions"] for i in range(1, 6)] == [4, 7, 12, 21, 14]
    assert [plans[f"PLAN {i}"]["validityMonths"] for i in range(1, 6)] == [3, 6, 6, 12, 12]
    assert plans["PLAN 2"]["name"]["en"] == "Spine Correction Program" and plans["PLAN 2"]["duration"] == "4 weeks"
    assert plans["PLAN 2"]["items"] == [] and "Physiotherapy Support" in plans["PLAN 2"]["inclusions"]


def test_flexible_package_rules(api):
    assert api("POST", "/api/packages", {"name": "Flex " + N, "price": 100, "items": [], "sessions": "0"})[1]["message"] == "Total sessions must be a whole number, 1 or more"
    assert api("POST", "/api/packages", {"code": "PLAN 1", "name": "Flex " + N, "price": 100, "sessions": 3})[1]["message"] == "Plan code PLAN 1 is already used"
    assert api("POST", "/api/packages", {"name": "Flex " + N, "price": 100, "sessions": 3, "validityMonths": 0})[0] == 400
    st, g = api("POST", "/api/packages", {"code": "plan x" + N[-2:], "name": "Flex " + N, "price": 300, "sessions": 3, "duration": "2 weeks", "validityMonths": 2,
                                         "inclusions": "Consultation; Therapy\nDiet advice"})
    assert st == 201 and g["code"] == "PLAN X" + N[-2:] and g["inclusions"] == ["Consultation", "Therapy", "Diet advice"] and g["sessions"] == 3


def test_validity_and_expiry():
    from app.rules import add_months, package_state
    assert add_months("2026-11-30", 3) == "2027-02-28" and add_months("2026-01-15", 12) == "2027-01-15"
    st = package_state(399, 4, 0, 399, "2026-01-01", date(2026, 4, 2), 3)
    assert st["expiresOn"] == "2026-04-01" and st["expired"] and not st["canUse"]
    st = package_state(399, 4, 0, 399, "2026-01-01", date(2026, 4, 1), 3)
    assert not st["expired"] and st["canUse"]


def test_plan_sold_sessions_and_expiry(api):
    from app.rules import add_months
    _, p = api("POST", "/api/patients", {"name": "Plan Buyer", "idType": "passport", "idNo": "PPL" + N, "phone": "0170000020", "pdpaConsent": True})
    st, k = api("POST", "/api/client-packages", {"patientId": p["id"], "packageId": "plan2", "plan": "full", "method": "card"})
    assert st == 201
    _, ks = api("GET", f"/api/client-packages?patientId={p['id']}")
    assert ks[0]["expiresOn"] == add_months(ks[0]["sold_on"], 6)
    assert api("POST", f"/api/client-packages/{k['id']}/sessions", {})[0] == 200        # flexible: no therapy needed
    # make it expired: move the sale date back
    import sqlite3, os
    con = sqlite3.connect(os.environ["DATABASE_URL"].removeprefix("sqlite:///"))
    con.execute("UPDATE client_packages SET sold_on = '2025-01-01' WHERE id = ?", (k["id"],)); con.commit(); con.close()
    st, j = api("POST", f"/api/client-packages/{k['id']}/sessions", {})
    assert st == 409 and j["error"] == "package_expired" and "2025-07-01" in j["message"]


def test_attendance_rules():
    from app import attendance as R
    c = R.DEFAULT
    mon = "2026-11-16"   # Monday
    assert R.day_status([{"kind": "work", "in": "09:05", "out": "13:00"}, {"kind": "work", "in": "14:00", "out": "18:00"}], mon, "2026-11-20", "10:00", c) | {} == {
        "status": "present", "first": "09:05", "last": "18:00", "minutes": 475, "clockedIn": False, "missingOut": False, "leaveType": None, "lateBy": 0}
    st = R.day_status([{"kind": "work", "in": "09:25", "out": None}], mon, "2026-11-20", "10:00", c)
    assert st["status"] == "late" and st["lateBy"] == 25 and st["missingOut"]
    assert R.day_status([], mon, "2026-11-20", "10:00", c)["status"] == "absent"
    assert R.day_status([], "2026-11-22", "2026-11-22", "10:00", c)["status"] == "off"           # Sunday
    assert R.day_status([], "2026-11-20", "2026-11-20", "10:00", c)["status"] == "not_in"
    assert R.day_status([{"kind": "leave", "leaveType": "medical"}], mon, "2026-11-20", "10:00", c)["status"] == "leave"


def test_attendance_clock_register_and_corrections(client, api):
    api("POST", "/api/users", {"name": "Att Staff", "email": f"att{N}@clinic.my", "role": "therapist", "password": "Strong12345"})
    h = signin(client, f"att{N}@clinic.my", "Strong12345")
    r = client.post("/api/attendance/clock-in", headers=h)
    assert r.status_code == 200 and r.json()["status"]["clockedIn"]
    assert client.post("/api/attendance/clock-in", headers=h).json()["error"] == "already_in"
    assert client.post("/api/attendance/clock-out", headers=h).status_code == 200
    assert client.post("/api/attendance/clock-out", headers=h).json()["error"] == "not_in"
    t = date.today().isoformat()
    # staff sees only themselves; can't add entries or change settings
    reg = client.get(f"/api/attendance?from={t}&to={t}", headers=h).json()
    assert [u["name"] for u in reg["users"]] == ["Att Staff"]
    me = reg["users"][0]["id"]
    assert client.post("/api/attendance", json={"userId": me, "date": t, "kind": "leave", "leaveType": "annual"}, headers=h).status_code == 403
    assert client.put("/api/attendance/settings", json={"start": "08:00", "end": "17:00", "grace": 5, "workdays": [1, 2, 3]}, headers=h).status_code == 403
    # admin: manual work entry, leave range, correction needs a reason
    y = (date.today() - timedelta(days=1)).isoformat()
    assert api("POST", "/api/attendance", {"userId": me, "date": y, "kind": "work", "timeIn": "18:00", "timeOut": "09:00"})[1]["message"] == "Clock-out must be after clock-in"
    assert api("POST", "/api/attendance", {"userId": me, "date": y, "kind": "work", "timeIn": "09:30", "timeOut": "17:30", "note": "Forgot to clock"})[0] == 201
    later = (date.today() + timedelta(days=3)).isoformat()
    st, j = api("POST", "/api/attendance", {"userId": me, "date": (date.today() + timedelta(days=1)).isoformat(), "toDate": later, "kind": "leave", "leaveType": "annual"})
    assert st == 201 and j["created"] == 3
    assert api("POST", "/api/attendance", {"userId": me, "date": later, "kind": "leave", "leaveType": "annual"})[0] == 409
    _, reg = api("GET", f"/api/attendance?from={y}&to={later}&userId={me}")
    work = next(e for e in reg["entries"] if e["date"] == y)
    assert api("PUT", f"/api/attendance/{work['id']}", {"timeIn": "09:00", "timeOut": "17:30"})[1]["message"].startswith("Give a reason")
    assert api("PUT", f"/api/attendance/{work['id']}", {"timeIn": "09:00", "timeOut": "17:30", "reason": "Checked CCTV"})[1]["in"] == "09:00"
    assert api("POST", f"/api/attendance/{work['id']}/delete", {"reason": ""})[0] == 400
    assert api("PUT", "/api/attendance/settings", {"start": "18:00", "end": "09:00", "grace": 5, "workdays": [1]})[1]["message"] == "Shift end must be after shift start"
    assert api("PUT", "/api/attendance/settings", {"start": "09:00", "end": "18:00", "grace": 10, "workdays": [1, 2, 3, 4, 5, 6]})[0] == 200
    _, a = api("GET", "/api/audit")
    assert any(e["action"] == "attendance.edit" for e in a)
