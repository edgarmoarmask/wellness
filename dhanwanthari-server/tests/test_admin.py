"""Users & roles, patient vitals, appointments on a day, delete appointment, clear queue."""
import time
from datetime import date, timedelta

N = str(int(time.time() * 1000))[-5:]


def signin(client, email, pw):
    r = client.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    v = client.post("/api/auth/verify", json={"challengeId": r.json()["challengeId"], "code": r.json()["devCode"]})
    return {"authorization": "Bearer " + v.json()["token"]}


def test_users_roles_and_signout(client, api):
    assert api("POST", "/api/users", {"name": "Dr Anu", "email": "bad", "role": "bams", "password": "Strong12345"})[1]["message"] == "Enter a valid email address"
    assert api("POST", "/api/users", {"name": "Dr Anu", "email": f"anu{N}@clinic.my", "role": "vaidya", "password": "Strong12345"})[0] == 400
    assert api("POST", "/api/users", {"name": "Dr Anu", "email": f"anu{N}@clinic.my", "role": "bams", "password": "short1"})[1]["error"] == "weak_password"
    st, u = api("POST", "/api/users", {"name": "Dr Anu", "email": f"ANU{N}@clinic.my", "role": "bams", "password": "Strong12345"})
    assert st == 201 and u["email"] == f"anu{N}@clinic.my" and u["roleLabel"] == "BAMS doctor (Ayurvedic Practitioner)"
    assert api("POST", "/api/users", {"name": "Dup", "email": f"anu{N}@clinic.my", "role": "cashier", "password": "Strong12345"})[0] == 409
    h = signin(client, f"anu{N}@clinic.my", "Strong12345")
    assert client.get("/api/users", headers=h).status_code == 403                   # not admin
    assert client.post("/api/inventory", json={"name": "Anu Oil " + N, "form": "thailam", "unit": "bottle", "price": 10}, headers=h).status_code == 201   # bams: stock
    assert client.post("/api/expenses", json={"code": "6030", "amount": 1, "method": "cash"}, headers=h).status_code == 403                             # cashier work
    # role change → signed out at once
    api("PUT", f"/api/users/{u['id']}", {"name": "Dr Anu", "email": u["email"], "role": "cashier", "active": True})
    r = client.get("/api/state", headers=h)
    assert r.status_code == 401 and r.json()["error"] == "signed_out"
    h = signin(client, u["email"], "Strong12345")
    assert client.post("/api/expenses", json={"code": "6030", "amount": 1, "method": "cash"}, headers=h).status_code == 201
    assert client.put("/api/settings/sst", json={"registered": False, "regNo": "", "rate": 6}, headers=h).status_code == 403    # admin only now
    # password reset → old sign-in stops, new password works
    assert api("POST", f"/api/users/{u['id']}/password", {"password": "NewStrong678"})[0] == 200
    assert client.get("/api/state", headers=h).status_code == 401
    assert client.post("/api/auth/login", json={"email": u["email"], "password": "Strong12345"}).status_code == 401
    h = signin(client, u["email"], "NewStrong678")
    # change own password
    assert client.post("/api/me/password", json={"current": "wrong", "password": "Another12345"}, headers=h).json()["error"] == "bad_current"
    assert client.post("/api/me/password", json={"current": "NewStrong678", "password": "Another12345"}, headers=h).status_code == 200
    assert client.get("/api/state", headers=h).status_code == 401
    # deactivate → cannot sign in
    api("PUT", f"/api/users/{u['id']}", {"name": "Dr Anu", "email": u["email"], "role": "cashier", "active": False})
    assert client.post("/api/auth/login", json={"email": u["email"], "password": "Another12345"}).status_code == 401
    _, users = api("GET", "/api/users")
    assert next(x for x in users if x["id"] == u["id"])["active"] is False


def test_admin_cannot_lock_themselves_out(api):
    _, users = api("GET", "/api/users")
    me = next(x for x in users if x["email"] == "admin@dhanwanthari.test")
    st, j = api("PUT", f"/api/users/{me['id']}", {"name": me["name"], "email": me["email"], "role": "cashier", "active": True})
    assert st == 409 and j["error"] == "self"
    assert api("PUT", f"/api/users/{me['id']}", {"name": me["name"], "email": me["email"], "role": "admin", "active": False})[1]["error"] == "self"


def test_patient_vitals(api):
    base = {"name": "Vital Signs", "idType": "passport", "phone": "0170000009", "pdpaConsent": True}
    assert api("POST", "/api/patients", {**base, "idNo": "PV" + N + "A", "heightCm": 20})[1]["issues"][0]["message"].endswith("Height should be in cm, between 30 and 250.")
    assert api("POST", "/api/patients", {**base, "idNo": "PV" + N + "A", "bp": "80/120"})[0] == 400
    assert api("POST", "/api/patients", {**base, "idNo": "PV" + N + "A", "bp": "120-80"})[0] == 400
    st, p = api("POST", "/api/patients", {**base, "idNo": "PV" + N + "A", "heightCm": "162.5", "weightKg": "58,4", "bp": " 118 / 76 "})
    assert st == 201
    _, rec = api("GET", f"/api/patients/{p['id']}")
    assert (rec["patient"]["heightCm"], rec["patient"]["weightKg"], rec["patient"]["bp"]) == (162.5, 58.4, "118/76")
    st, p2 = api("POST", "/api/patients", {**base, "idNo": "PV" + N + "B"})
    assert st == 201                                                                  # vitals optional


def test_appointments_delete_and_clear_queue(api):
    _, p = api("POST", "/api/patients", {"name": "Queue Person", "idType": "passport", "idNo": "PQ" + N, "phone": "0170000010", "pdpaConsent": True})
    later = (date.today() + timedelta(days=3)).isoformat()
    past = (date.today() - timedelta(days=1)).isoformat()
    base = {"patientId": p["id"], "unitId": "opd", "practitionerId": "d1"}
    assert api("POST", "/api/visits", {**base, "kind": "appt", "slot": "10:00", "date": past})[0] == 400
    assert api("POST", "/api/visits", {**base, "kind": "appt", "slot": "10:00", "date": (date.today() + timedelta(days=400)).isoformat()})[0] == 400
    st, a = api("POST", "/api/visits", {**base, "kind": "appt", "slot": "10:30", "date": later})
    assert st == 201
    _, s = api("GET", "/api/state")
    assert next(v for v in s["Q"] if v["id"] == a["id"])["date"] == later
    assert api("DELETE", f"/api/visits/{a['id']}")[0] == 200
    _, s = api("GET", "/api/state")
    assert all(v["id"] != a["id"] for v in s["Q"])
    # walk-in in progress can't be deleted
    _, w = api("POST", "/api/visits", {**base, "kind": "walkin"})
    assert api("DELETE", f"/api/visits/{w['id']}")[1]["error"] == "not_deletable"
    # clear queue (tx unit so earlier tests' OPD visits don't matter): 1 waiting removed, 1 in consult kept
    tx = {"patientId": p["id"], "unitId": "tx", "practitionerId": "t1", "serviceId": "abhy"}
    _, w1 = api("POST", "/api/visits", {**tx, "kind": "walkin"})
    _, w2 = api("POST", "/api/visits", {**tx, "kind": "walkin"})
    api("POST", f"/api/visits/{w2['id']}/start")
    st, r = api("POST", "/api/queue/clear", {"unitId": "tx"})
    assert st == 200 and r["removed"] >= 1 and r["kept"] >= 1
    _, s = api("GET", "/api/state")
    ids = {v["id"] for v in s["Q"]}
    assert w1["id"] not in ids and w2["id"] in ids
    _, a = api("GET", "/api/audit")
    assert any(e["action"] == "queue.clear" for e in a) and any(e["action"] == "visit.delete" for e in a)
