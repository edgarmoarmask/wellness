"""Therapy menu and packages (packages = several therapies), sessions per therapy, CSV import."""
import time

N = str(int(time.time() * 1000))[-5:]


def test_therapy_add_edit_delete(api):
    assert api("POST", "/api/services", {"name": "x", "group": "walk-in", "price": 10})[1]["message"] == "Enter the therapy name"
    assert api("POST", "/api/services", {"name": "Shirodhara", "group": "walk-in", "price": 10})[1]["message"] == 'A therapy called "Shirodhara" already exists'
    assert api("POST", "/api/services", {"name": "New " + N, "code": "sd", "group": "walk-in", "price": 10})[1]["message"] == "Code SD is already used"
    assert api("POST", "/api/services", {"name": "New " + N, "group": "spa", "price": 10})[1]["message"].startswith("Group must be")
    assert api("POST", "/api/services", {"name": "New " + N, "group": "wellness", "price": 100, "normal": 90})[0] == 400
    st, t = api("POST", "/api/services", {"name": "Marma therapy " + N, "code": "MT" + N[-3:], "group": "wellness", "mins": 45, "price": 150, "normal": 180, "label": "member", "benefits": "Pressure points"})
    assert st == 201 and t["id"].startswith("th") and t["wellness"] and t["group"] == "Wellness offer"
    st, e = api("PUT", f"/api/services/{t['id']}", {**t, "name": t["name"], "price": 160, "group": "walk-in", "normal": None, "label": None})
    assert st == 200 and e["price"] == 160 and not e["wellness"] and e["normal"] is None
    _, svcs = api("GET", "/api/services")
    assert any(x["id"] == t["id"] for x in svcs)
    assert api("DELETE", f"/api/services/{t['id']}")[0] == 200
    _, svcs = api("GET", "/api/services")
    assert all(x["id"] != t["id"] for x in svcs)
    _, st_ = api("GET", "/api/state")
    assert next(x for x in st_["SVC"] if x["id"] == t["id"])["archived"] is True      # kept for history
    assert api("PUT", f"/api/services/{t['id']}", {**t})[0] == 404


def test_package_of_therapies_sold_and_used(api):
    assert api("POST", "/api/packages", {"name": "Empty " + N, "price": 100, "items": []})[1]["message"] == "Add at least one therapy, or enter the total sessions for a flexible package"
    assert api("POST", "/api/packages", {"name": "Bad " + N, "price": 100, "items": [{"svc": "nope", "n": 2}]})[0] == 400
    assert api("POST", "/api/packages", {"name": "Dup " + N, "price": 100, "items": [{"svc": "SD", "n": 2}, {"svc": "sd", "n": 1}]})[1]["message"].endswith("Put all its sessions on one line.")
    st, g = api("POST", "/api/packages", {"name": "Back care " + N, "price": 800, "items": [{"svc": "KTV", "n": 2}, {"svc": "sd", "n": 2}]})
    assert st == 201 and g["sessions"] == 4 and g["items"] == [{"svc": "ktv", "n": 2}, {"svc": "sd", "n": 2}]
    st, j = api("DELETE", "/api/services/ktv")
    assert st == 409 and "Back care" in j["message"]

    _, p = api("POST", "/api/patients", {"name": "Pkg Tester", "idType": "passport", "idNo": "P" + N + "PK", "phone": "0171112223", "pdpaConsent": True})
    st, k = api("POST", "/api/client-packages", {"patientId": p["id"], "packageId": g["id"], "plan": "full", "method": "card"})
    assert st == 201
    # edit after sale: client keeps the terms bought
    api("PUT", f"/api/packages/{g['id']}", {"name": "Back care " + N, "price": 999, "items": [{"svc": "sd", "n": 5}]})
    _, s = api("GET", "/api/state")
    mine = next(x for x in s["PK"] if x["id"] == k["id"])
    assert mine["terms"]["price"] == 800 and mine["terms"]["items"] == [{"svc": "ktv", "n": 2}, {"svc": "sd", "n": 2}]

    st, j = api("POST", f"/api/client-packages/{k['id']}/sessions", {})
    assert st == 409 and j["error"] == "choose_therapy"
    assert api("POST", f"/api/client-packages/{k['id']}/sessions", {"serviceId": "abhy"})[1]["error"] == "not_in_package"
    assert api("POST", f"/api/client-packages/{k['id']}/sessions", {"serviceId": "ktv"})[0] == 200
    assert api("POST", f"/api/client-packages/{k['id']}/sessions", {"serviceId": "ktv"})[0] == 200
    assert api("POST", f"/api/client-packages/{k['id']}/sessions", {"serviceId": "ktv"})[1]["error"] == "therapy_used_up"
    # visit-based session: book Shirodhara from the package, pay with the package
    st, v = api("POST", "/api/visits", {"patientId": p["id"], "unitId": "tx", "practitionerId": "t1", "serviceId": "session", "packageServiceId": "sd", "kind": "walkin"})
    assert st == 201
    assert api("POST", "/api/visits", {"patientId": p["id"], "unitId": "tx", "practitionerId": "t1", "serviceId": "session", "packageServiceId": "ktv", "kind": "walkin"})[1]["error"] == "therapy_used_up"
    api("POST", f"/api/visits/{v['id']}/start")
    api("POST", f"/api/visits/{v['id']}/complete")
    _, prev = api("GET", f"/api/visits/{v['id']}/invoice-preview")
    assert prev["lines"][0]["d"] == "Package session (prepaid) · Shirodhara"
    st, paid = api("POST", f"/api/visits/{v['id']}/pay", {"method": "package"})
    assert st == 201 and paid["total"] == 0
    _, pk = api("GET", f"/api/client-packages?patientId={p['id']}")
    assert pk[0]["used"] == 3 and {i["svc"]: i["left"] for i in pk[0]["items"]} == {"ktv": 0, "sd": 1}
    # deleting the package stops new sales only
    assert api("DELETE", f"/api/packages/{g['id']}")[0] == 200
    assert api("POST", "/api/client-packages", {"patientId": p["id"], "packageId": g["id"], "plan": "full", "method": "card"})[0] == 404
    assert api("POST", f"/api/client-packages/{k['id']}/sessions", {"serviceId": "sd"})[0] == 200
    _, tb = api("GET", "/api/reports/trial-balance")
    assert tb["balanced"]


def test_catalog_csv_import(api):
    rows = [{"line": 2, "name": "Kizhi Special " + N, "code": "KS" + N[-3:], "group": "walk-in", "mins": 60, "price": 140},
            {"line": 3, "id": "fm", "name": "Face massage", "code": "FM", "group": "add-on", "mins": 30, "price": 65},
            {"line": 4, "name": "Broken " + N, "group": "walk-in", "price": "x"}]
    st, j = api("POST", "/api/services/import", {"rows": rows})
    assert st == 400 and [e["row"] for e in j["errors"]] == [4]
    st, j = api("POST", "/api/services/import", {"rows": rows[:2]})
    assert (j["added"], j["updated"]) == (1, 1)
    _, svcs = api("GET", "/api/services")
    assert next(x for x in svcs if x["id"] == "fm")["price"] == 65 and next(x for x in svcs if x["id"] == "fm")["group"] == "Walk-in treatment"
    prow = [{"line": "2, 3", "name": "Combo " + N, "price": 300, "items": [{"svc": "KS" + N[-3:], "n": 1}, {"svc": "FM", "n": 2}]},
            {"line": "4", "name": "Combo " + N, "price": 300, "items": [{"svc": "FM", "n": 1}]}]
    st, j = api("POST", "/api/packages/import", {"rows": prow})
    assert st == 400 and j["errors"][0]["row"] == "4"
    st, j = api("POST", "/api/packages/import", {"rows": prow[:1]})
    assert j["added"] == 1
    _, pk = api("GET", "/api/packages")
    assert next(g for g in pk if g["name"]["en"] == "Combo " + N)["sessions"] == 3


def test_catalog_editing_needs_role(client, api):
    from app.seed import add_user
    add_user(f"desk{N}@clinic.test", "Desk@2026xx", "Desk", "cashier")
    r = client.post("/api/auth/login", json={"email": f"desk{N}@clinic.test", "password": "Desk@2026xx"}).json()
    h = {"authorization": "Bearer " + client.post("/api/auth/verify", json={"challengeId": r["challengeId"], "code": r["devCode"]}).json()["token"]}
    assert client.post("/api/services", json={"name": "Nope", "group": "walk-in", "price": 1}, headers=h).status_code == 403
    assert client.delete("/api/packages/sh5", headers=h).status_code == 403
    assert client.get("/api/services", headers=h).status_code == 200


def test_seed_keeps_clinic_edits(api):
    api("PUT", "/api/services/hdm", {"name": "Head massage", "code": "HDM", "group": "walk-in", "mins": 30, "price": 75})
    from app.seed import run
    run("admin@dhanwanthari.test", "Dhanwanthari@2026")
    _, svcs = api("GET", "/api/services")
    assert next(x for x in svcs if x["id"] == "hdm")["price"] == 75
