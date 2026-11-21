"""Pharmacy products: add / edit / delete / CSV import, with the journal entries they post."""
import time

N = str(int(time.time() * 1000))[-5:]


def jrows(api, ref):
    _, j = api("GET", "/api/journal")
    return [(e["d"].split(" · ")[0], e["dr"], e["cr"], e["amt"]) for e in j if e["ref"] == ref]


def test_add_edit_delete_product(api):
    st, j = api("POST", "/api/inventory", {"name": "x", "form": "thailam", "unit": "bottle", "price": 10})
    assert st == 400 and j["message"] == "Enter the product name"
    assert api("POST", "/api/inventory", {"name": "Pinda " + N, "form": "potion", "unit": "bottle", "price": 10})[1]["message"].startswith("Form must be")
    assert api("POST", "/api/inventory", {"name": "Pinda " + N, "form": "thailam", "unit": "bottle", "price": 10, "exp": "31/02/2027"})[0] == 400
    st, p = api("POST", "/api/inventory", {"name": "Pinda Thailam " + N, "form": "thailam", "unit": "bottle", "stock": 10, "reorder": 4, "price": 36, "cost": 20,
                                          "exp": "31/12/2027", "base": "sesame", "contra": ["pregnancy"]})
    assert st == 201 and p["id"].startswith("m") and p["exp"] == "2027-12-31" and p["base"] == "sesame"
    assert jrows(api, p["id"]) == [("Opening stock", "1200", "3000", 200)]
    assert api("POST", "/api/inventory", {"name": "pinda thailam " + N, "form": "thailam", "unit": "bottle", "price": 1})[0] == 400   # duplicate name

    # count 8 (−2 at RM20 = 40), then cost 20 → 22 revalues 8 × 2 = 16
    st, e = api("PUT", f"/api/inventory/{p['id']}", {**p, "stock": 8, "cost": 22})
    assert st == 200 and e["stock"] == 8 and e["cost"] == 22
    got = jrows(api, p["id"])
    assert ("Stock count adjustment", "5030", "1200", 40) in got and ("Stock revalued", "1200", "5030", 16) in got

    # cannot delete while on a prescription waiting to be dispensed
    _, pt = api("POST", "/api/patients", {"name": "Stock Tester", "idType": "passport", "idNo": "P" + N + "ST", "phone": "0170000000", "pdpaConsent": True})
    _, v = api("POST", "/api/visits", {"patientId": pt["id"], "unitId": "opd", "practitionerId": "d1", "kind": "walkin"})
    api("POST", f"/api/visits/{v['id']}/start")
    st, rx = api("POST", f"/api/visits/{v['id']}/rx", {"itemId": p["id"], "qty": 1})
    assert st == 201
    st, j = api("DELETE", f"/api/inventory/{p['id']}")
    assert st == 409 and j["error"] == "in_use"
    api("DELETE", f"/api/visits/{v['id']}/rx/{rx['id']}")

    assert api("DELETE", f"/api/inventory/{p['id']}")[0] == 200
    assert ("Product deleted", "5030", "1200", 176) in jrows(api, p["id"])          # 8 × 22 written off
    _, active = api("GET", "/api/inventory")
    assert all(i["id"] != p["id"] for i in active)
    _, everything = api("GET", "/api/inventory?all=true")
    assert next(i for i in everything if i["id"] == p["id"])["archived"] is True
    assert api("PUT", f"/api/inventory/{p['id']}", {**p})[0] == 404
    assert api("POST", f"/api/inventory/{p['id']}/receive", {"qty": 1, "cost": 1})[0] == 404
    # the name is free again after delete
    assert api("POST", "/api/inventory", {"name": "Pinda Thailam " + N, "form": "thailam", "unit": "bottle", "price": 36})[0] == 201
    _, tb = api("GET", "/api/reports/trial-balance")
    assert tb["balanced"]


def test_csv_import_all_or_nothing(api):
    _, before = api("GET", "/api/inventory")
    m3 = next(i for i in before if i["id"] == "m3")
    rows = [
        {"line": 2, "name": "Balaswagandhadi " + N, "form": "thailam", "unit": "bottle", "stock": 12, "price": 40, "cost": 21, "exp": "2027-06-30", "base": "sesame"},
        {"line": 3, "id": "m3", **{k: m3[k] for k in ("name", "form", "unit", "reorder", "price", "cost", "batch", "exp", "base", "sugar", "contra", "use")}, "stock": m3["stock"] + 2},
        {"line": 4, "name": "Bad Row " + N, "form": "thailam", "unit": "bottle", "price": "abc"},
        {"line": 5, "id": "m999", "name": "Ghost", "form": "thailam", "unit": "bottle", "price": 1},
    ]
    st, j = api("POST", "/api/inventory/import", {"rows": rows})
    assert st == 400 and [e["row"] for e in j["errors"]] == [4, 5] and "Nothing was imported" in j["message"]
    _, same = api("GET", "/api/inventory")
    assert len(same) == len(before) and next(i for i in same if i["id"] == "m3")["stock"] == m3["stock"]

    st, j = api("POST", "/api/inventory/import", {"rows": rows[:2]})
    assert st == 200 and (j["added"], j["updated"]) == (1, 1)
    _, after = api("GET", "/api/inventory")
    assert next(i for i in after if i["id"] == "m3")["stock"] == m3["stock"] + 2
    assert any(i["name"] == "Balaswagandhadi " + N and i["stock"] == 12 for i in after)
    dup = {"line": 2, "name": "Dup " + N, "form": "kashayam", "unit": "bottle", "price": 5}
    assert api("POST", "/api/inventory/import", {"rows": [dup, {**dup, "line": 3}]})[1]["errors"][0]["row"] == 3
    _, tb = api("GET", "/api/reports/trial-balance")
    assert tb["balanced"]


def test_products_need_pharmacy_role(client, api):
    from app.seed import add_user
    add_user(f"front{N}@clinic.test", "Front@2026x", "Front Desk", "cashier")
    r = client.post("/api/auth/login", json={"email": f"front{N}@clinic.test", "password": "Front@2026x"}).json()
    tok = client.post("/api/auth/verify", json={"challengeId": r["challengeId"], "code": r["devCode"]}).json()["token"]
    h = {"authorization": "Bearer " + tok}
    assert client.post("/api/inventory", json={"name": "Nope", "form": "thailam", "unit": "bottle", "price": 1}, headers=h).status_code == 403
    assert client.delete("/api/inventory/m1", headers=h).status_code == 403
