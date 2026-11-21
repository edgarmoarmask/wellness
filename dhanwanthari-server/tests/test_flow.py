"""End-to-end API tests (same cases as the earlier Bun test suite, plus SQLite-specific checks)."""
import time

UNIQ = str(int(time.time() * 1000))[-4:]


def mykad(n):
    return f"900101-14-{n}"


def test_login_rules(client):
    assert client.post("/api/auth/login", json={"email": "admin@dhanwanthari.test", "password": "nope"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "admin@dhanwanthari.test", "password": "Dhanwanthari@2026"}).json()
    assert client.post("/api/auth/verify", json={"challengeId": r["challengeId"], "code": "000000"}).status_code == 401
    assert client.get("/api/patients").status_code == 401


def test_setup_wellness_offers(api):
    _, s = api("GET", "/api/setup")
    w = [x for x in s["services"] if x["wellness"]]
    assert sorted(x["id"] for x in w) == ["abhy", "destress", "kizhi", "oilm", "swed"]
    d = next(x for x in w if x["id"] == "destress")
    assert (d["price"], d["normal_price"], d["offer_label"]) == (190, 250, "member")


def test_patient_registration(api):
    st, j = api("POST", "/api/patients", {"name": "A", "idNo": "x", "phone": "1"})
    assert st == 400 and j["issues"]
    st, j = api("POST", "/api/patients", {"name": "Siti Aminah", "idNo": mykad("1" + UNIQ[1:]), "phone": "0123456789"})
    assert st == 400 and "PDPA" in j["issues"][0]["message"]
    st, ok = api("POST", "/api/patients", {"name": "Siti Aminah", "idNo": mykad("1" + UNIQ[1:]), "phone": "0123456789", "allergy": "Sesame oil", "flags": ["diabetes"], "pdpaConsent": True})
    assert st == 201 and ok["id"].startswith("DV-")
    st, _ = api("POST", "/api/patients", {"name": "Someone Else", "idNo": mykad("1" + UNIQ[1:]), "phone": "0199999999", "pdpaConsent": True})
    assert st == 409
    _, found = api("GET", "/api/patients?q=aminah")
    assert any(p["id"] == ok["id"] for p in found)


def _walkin(api, pid, unit="opd", prac="d1", svc=None):
    _, v = api("POST", "/api/visits", {"patientId": pid, "unitId": unit, "practitionerId": prac, "serviceId": svc, "kind": "walkin"})
    return v["id"]


def test_full_visit(api):
    _, p = api("POST", "/api/patients", {"name": "Ravi Shankar", "idNo": mykad("2" + UNIQ[1:]), "phone": "0161112222", "allergy": "Sesame oil", "pdpaConsent": True})
    vid = _walkin(api, p["id"])
    assert api("POST", f"/api/visits/{vid}/start")[0] == 200
    st, j = api("POST", f"/api/visits/{vid}/rx", {"itemId": "m1", "qty": 1})        # sesame-based thailam
    assert st == 422 and j["error"] == "safety_block"
    assert api("POST", f"/api/visits/{vid}/rx", {"itemId": "m5", "qty": 2})[0] == 201
    assert api("POST", f"/api/visits/{vid}/complete")[0] == 422                      # diagnosis required
    api("PUT", f"/api/visits/{vid}/notes", {"diagnosis": "M54.5", "dosha": "vata", "notes": "Stiff lower back"})
    assert api("POST", f"/api/visits/{vid}/complete")[1]["status"] == "dispense"
    assert api("POST", f"/api/visits/{vid}/dispense")[0] == 200
    st, paid = api("POST", f"/api/visits/{vid}/pay", {"method": "duitnow"})
    assert st == 201 and paid["total"] == 80 + 2 * 24
    _, rec = api("GET", f"/api/patients/{p['id']}")
    v0 = rec["visits"][0]
    assert (v0["status"], v0["diagnosis"], v0["notes"], v0["invoice_id"]) == ("done", "M54.5", "Stiff lower back", paid["invoice"])
    assert v0["medicines"][0]["item_id"] == "m5" and v0["medicines"][0]["qty"] == 2
    assert rec["invoices"][0]["total"] == 128


def test_wellness_offer_price(api):
    _, p = api("POST", "/api/patients", {"name": "Lee Mei", "idType": "passport", "idNo": "P" + UNIQ + "X1", "phone": "0172223333", "pdpaConsent": True})
    vid = _walkin(api, p["id"], "tx", "t1", "destress")
    api("POST", f"/api/visits/{vid}/start")
    api("POST", f"/api/visits/{vid}/complete")
    _, prev = api("GET", f"/api/visits/{vid}/invoice-preview")
    assert prev["total"] == 190 and "normal RM250" in prev["lines"][0]["d"]


def test_partial_package(api):
    _, p = api("POST", "/api/patients", {"name": "Kamala Devi", "idNo": mykad("3" + UNIQ[1:]), "phone": "0183334444", "pdpaConsent": True})
    assert api("POST", "/api/client-packages", {"patientId": p["id"], "packageId": "sh5", "plan": "partial", "amount": 100, "method": "card"})[0] == 422
    st, k = api("POST", "/api/client-packages", {"patientId": p["id"], "packageId": "sh5", "plan": "partial", "amount": 400, "method": "card"})
    assert st == 201 and k["balance"] == 590
    assert api("POST", f"/api/client-packages/{k['id']}/sessions")[0] == 200
    assert api("POST", f"/api/client-packages/{k['id']}/sessions")[0] == 200
    st, j = api("POST", f"/api/client-packages/{k['id']}/sessions")
    assert st == 409 and j["error"] == "balance_due"
    assert api("POST", f"/api/client-packages/{k['id']}/payments", {"amount": 600, "method": "cash"})[0] == 422
    assert api("POST", f"/api/client-packages/{k['id']}/payments", {"amount": 590, "method": "cash"})[1]["balance"] == 0
    assert api("POST", f"/api/client-packages/{k['id']}/sessions")[0] == 200
    _, lst = api("GET", f"/api/client-packages?patientId={p['id']}")
    assert lst[0]["fully"] and lst[0]["used"] == 3 and lst[0]["paid"] == 990


def test_full_package_visit(api):
    _, p = api("POST", "/api/patients", {"name": "Hafiz Rahman", "idNo": mykad("4" + UNIQ[1:]), "phone": "0194445555", "pdpaConsent": True})
    api("POST", "/api/client-packages", {"patientId": p["id"], "packageId": "kb6", "plan": "full", "method": "duitnow"})
    vid = _walkin(api, p["id"], "tx", "t2", "session")
    api("POST", f"/api/visits/{vid}/start")
    api("POST", f"/api/visits/{vid}/complete")
    st, paid = api("POST", f"/api/visits/{vid}/pay", {"method": "package"})
    assert st == 201 and paid["total"] == 0


def test_expenses_pnl_dashboard(api):
    assert api("POST", "/api/expenses", {"code": "6030", "amount": 3500, "method": "transfer", "note": "Nov rent"})[0] == 201
    assert api("POST", "/api/expenses", {"code": "9999", "amount": 1, "method": "cash"})[0] == 400
    _, pnl = api("GET", "/api/reports/profit-and-loss?period=this-month")
    assert any(e["code"] == "6030" and e["amount"] >= 3500 for e in pnl["opex"])
    assert pnl["totalRevenue"] > 0 and any(e["code"] == "5010" for e in pnl["cogs"])
    _, d = api("GET", "/api/dashboard?days=7")
    assert len(d["perDay"]) == 7 and d["money_received"] > 0


def test_sst_non_citizen(api):
    assert api("PUT", "/api/settings/sst", {"registered": True, "regNo": "", "rate": 6})[0] == 422
    assert api("PUT", "/api/settings/sst", {"registered": True, "regNo": "W10-1808-32000123", "rate": 6})[0] == 200
    _, nc = api("POST", "/api/patients", {"name": "Sarah Thompson", "idType": "passport", "idNo": "P" + UNIQ + "SST", "phone": "0178882211", "pdpaConsent": True})
    vid = _walkin(api, nc["id"])
    api("POST", f"/api/visits/{vid}/start")
    api("POST", f"/api/visits/{vid}/rx", {"itemId": "m5", "qty": 1})
    api("PUT", f"/api/visits/{vid}/notes", {"diagnosis": "M54.5"})
    api("POST", f"/api/visits/{vid}/complete")
    api("POST", f"/api/visits/{vid}/dispense")
    _, prev = api("GET", f"/api/visits/{vid}/invoice-preview")
    assert [x["taxCode"] for x in prev["lines"]] == ["EXCON", "SV6"]
    assert prev["sst"] == 1.44 and prev["total"] == 105.44
    _, paid = api("POST", f"/api/visits/{vid}/pay", {"method": "card"})
    assert (paid["subtotal"], paid["sst"], paid["total"], paid["status"]) == (104, 1.44, 105.44, "paid")
    _, pk = api("POST", "/api/client-packages", {"patientId": nc["id"], "packageId": "sh5", "plan": "partial", "amount": 400, "method": "card"})
    assert (pk["paid"], pk["sst"], pk["charged"]) == (400, 24, 424)
    _, sst = api("GET", "/api/reports/sst-02?period=this-month")
    assert sst["taxableValue"] >= 424 and sst["serviceTax"] >= 25.44 and sst["exemptConsultation"] >= 80
    api("PUT", "/api/settings/sst", {"registered": False, "regNo": "", "rate": 6})


def test_pending_transfer_refund_balanced(api):
    _, p = api("POST", "/api/patients", {"name": "Anand Kumar", "idNo": mykad("5" + UNIQ[1:]), "phone": "0123456789", "pdpaConsent": True})
    vid = _walkin(api, p["id"], "tx", "t1", "absd")
    api("POST", f"/api/visits/{vid}/start")
    api("POST", f"/api/visits/{vid}/complete")
    _, paid = api("POST", f"/api/visits/{vid}/pay", {"method": "transfer"})
    assert paid["total"] == 220 and paid["status"] == "pending"
    _, pend = api("GET", "/api/transactions?status=pending")
    assert any(t["id"] == paid["transaction"] for t in pend["rows"])
    assert api("POST", f"/api/transactions/{paid['transaction']}/status", {"status": "failed"})[0] == 200
    assert api("POST", f"/api/transactions/{paid['transaction']}/status", {"status": "paid", "method": "transfer"})[0] == 200
    assert api("POST", f"/api/transactions/{paid['transaction']}/status", {"status": "pending"})[0] == 409
    _, r = api("POST", "/api/payments", {"description": "Retail sale – Murivenna", "kind": "med", "amount": 32, "method": "cash"})
    assert api("POST", f"/api/transactions/{r['id']}/status", {"status": "cancelled"})[0] == 200
    _, bill = api("POST", "/api/expenses", {"code": "6040", "amount": 420, "method": "transfer", "status": "pending", "reference": "TNB-11/26"})
    api("POST", f"/api/transactions/{bill['id']}/status", {"status": "paid"})
    _, tb = api("GET", "/api/reports/trial-balance")
    assert tb["balanced"]
    _, bs = api("GET", "/api/reports/balance-sheet")
    assert bs["balanced"]
    assert next((a["amount"] for a in bs["assets"] if a["code"] == "1100"), 0) == 0


def test_opening_and_exports(api):
    assert api("POST", "/api/opening-balances", {"date": "2026-11-01", "balances": {"1010": 25000, "2000": 1200}})[0] == 201
    assert api("POST", "/api/opening-balances", {"date": "2026-11-01", "balances": {"1010": 1}})[0] == 409
    _, gl = api("GET", "/api/reports/general-ledger?account=1010")
    assert gl[0]["code"] == "1010" and gl[0]["debit"] == 25000
    x = api.c.get("/api/exports/accountant-pack.xlsx?period=this-year", headers=api.headers)
    assert x.status_code == 200 and "spreadsheetml" in x.headers["content-type"] and x.content[:2] == b"PK"
    csv = api.c.get("/api/exports/general-ledger.csv?period=this-year", headers=api.headers)
    assert csv.text.split("\n")[0].lstrip("﻿").startswith("Code,Account,Date")
    assert api.c.get("/api/exports/nope.xlsx", headers=api.headers).status_code == 404


def test_audit_and_append_only(api):
    _, a = api("GET", "/api/audit")
    assert any(e["action"] == "patient.view" for e in a)
    import sqlite3, os
    con = sqlite3.connect(os.environ["DATABASE_URL"].removeprefix("sqlite:///"))
    for sql in ("UPDATE audit_log SET action='x'", "DELETE FROM journal"):
        try:
            con.execute(sql)
            raise AssertionError("append-only trigger missing")
        except sqlite3.IntegrityError as e:
            assert "append-only" in str(e)
    con.close()


def test_state_shape(api):
    st, s = api("GET", "/api/state")
    assert st == 200
    for k in ["P", "Q", "rx", "INV", "PK", "INVC", "J", "TX", "SET"]:
        assert k in s
    assert "citizenship" in s["P"][0] and s["INV"][0]["id"] == "m1" and s["INV"][1]["id"] == "m2"
    assert "dr" in s["J"][0] and "status" in s["TX"][0]
    assert api("GET", "/api/state", auth=False)[0] == 401
