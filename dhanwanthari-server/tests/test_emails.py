"""Emails: sign-in code, invoice when a visit is finished, receipt after payment (Amazon SES / memory outbox in tests)."""
import email
import email.policy
import time

N = str(int(time.time() * 1000))[-5:]


def outbox():
    from app import mailer
    return mailer.OUTBOX


def finish_visit(api, pid, unit="opd", prac="d1", svc=None, med=True):
    _, v = api("POST", "/api/visits", {"patientId": pid, "unitId": unit, "practitionerId": prac, "serviceId": svc, "kind": "walkin"})
    api("POST", f"/api/visits/{v['id']}/start")
    if med:
        api("POST", f"/api/visits/{v['id']}/rx", {"itemId": "m5", "qty": 2})
    api("PUT", f"/api/visits/{v['id']}/notes", {"diagnosis": "M54.5"})
    st, c = api("POST", f"/api/visits/{v['id']}/complete")
    assert st == 200
    if med:
        api("POST", f"/api/visits/{v['id']}/dispense")
    return v["id"], c["invoice"]


def test_otp_email(client):
    n = len(outbox())
    r = client.post("/api/auth/login", json={"email": "admin@dhanwanthari.test", "password": "Dhanwanthari@2026"}).json()
    m = outbox()[n]
    assert m["to"] == "admin@dhanwanthari.test" and r["devCode"] in m["subject"] and r["devCode"] in m["text"] and m["images"] == ["dvlogo", "dvwordmark"]


def test_invoice_then_receipt_same_number(api):
    _, p = api("POST", "/api/patients", {"name": "Mail Patient", "idType": "passport", "idNo": "PM" + N, "phone": "0171231234", "email": "mail.patient@example.com", "pdpaConsent": True})
    n = len(outbox())
    vid, inv_no = finish_visit(api, p["id"])
    assert inv_no.startswith("INV-")
    inv = [m for m in outbox()[n:] if m["to"] == "mail.patient@example.com"]
    assert len(inv) == 1 and inv[0]["subject"].startswith(f"Invoice {inv_no}") and "AMOUNT DUE" in inv[0]["html"] and "RM 128.00" in inv[0]["html"]
    assert "One Hundred Twenty-Eight Only" in inv[0]["text"]
    st, paid = api("POST", f"/api/visits/{vid}/pay", {"method": "cash"})
    assert st == 201 and paid["invoice"] == inv_no                                   # same number as the emailed invoice
    rc = [m for m in outbox()[n:] if m["subject"].startswith("Receipt ")]
    assert len(rc) == 1 and paid["transaction"] in rc[0]["subject"] and "OFFICIAL RECEIPT" in rc[0]["html"] and inv_no in rc[0]["html"] and "Cash" in rc[0]["html"]
    _, s = api("GET", "/api/state")
    row = next(i for i in s["INVC"] if i["id"] == inv_no)
    assert row["emails"]["invoice"]["status"] == "sent" and row["emails"]["receipt"]["status"] == "sent"
    # resend
    assert api("POST", f"/api/invoices/{inv_no}/email", {"kind": "receipt"})[1]["status"] == "sent"


def test_no_email_skipped_and_transfer_receipt_on_confirm(api):
    _, p = api("POST", "/api/patients", {"name": "No Mail", "idType": "passport", "idNo": "PN" + N, "phone": "0171231235", "pdpaConsent": True})
    vid, inv_no = finish_visit(api, p["id"], med=False)
    _, log = api("GET", f"/api/emails?ref={inv_no}")
    assert log[0]["status"] == "skipped" and "No email" in log[0]["error"]
    # patient adds an email; pays by transfer → no receipt until confirmed
    api("PUT", f"/api/patients/{p['id']}", {"name": "No Mail", "idType": "passport", "idNo": "PN" + N, "phone": "0171231235", "email": "later@example.com", "pdpaConsent": True})
    n = len(outbox())
    _, paid = api("POST", f"/api/visits/{vid}/pay", {"method": "transfer"})
    assert paid["status"] == "pending" and not [m for m in outbox()[n:] if m["to"] == "later@example.com"]
    assert api("POST", f"/api/invoices/{inv_no}/email", {"kind": "receipt"})[1]["error"] == "not_paid"
    api("POST", f"/api/transactions/{paid['transaction']}/status", {"status": "paid"})
    rc = [m for m in outbox()[n:] if m["to"] == "later@example.com"]
    assert len(rc) == 1 and rc[0]["subject"].startswith("Receipt ") and "Bank transfer" in rc[0]["html"]


def test_package_payment_receipts(api):
    _, p = api("POST", "/api/patients", {"name": "Pkg Mail", "idType": "passport", "idNo": "PK" + N, "phone": "0171231236", "email": "pkg@example.com", "pdpaConsent": True})
    n = len(outbox())
    _, k = api("POST", "/api/client-packages", {"patientId": p["id"], "packageId": "plan2", "plan": "partial", "amount": 400, "method": "card"})
    api("POST", f"/api/client-packages/{k['id']}/payments", {"amount": 599, "method": "cash"})
    rc = [m for m in outbox()[n:] if m["to"] == "pkg@example.com"]
    assert len(rc) == 2 and "RM 400.00" in rc[0]["html"] and "Balance RM 599.00" in rc[0]["html"] and "Balance RM 0.00" in rc[1]["html"]


def test_package_session_visit_no_invoice_email(api):
    _, p = api("POST", "/api/patients", {"name": "Prepaid Mail", "idType": "passport", "idNo": "PP" + N, "phone": "0171231237", "email": "prepaid@example.com", "pdpaConsent": True})
    api("POST", "/api/client-packages", {"patientId": p["id"], "packageId": "kb6", "plan": "full", "method": "card"})
    n = len(outbox())
    vid, inv_no = finish_visit(api, p["id"], unit="tx", prac="t1", svc="session", med=False)
    assert not [m for m in outbox()[n:] if m["subject"].startswith("Invoice")]
    _, log = api("GET", f"/api/emails?ref={inv_no}")
    assert log[0]["status"] == "skipped" and "Nothing to pay" in log[0]["error"]


def test_ses_provider_builds_raw_mime(monkeypatch):
    from app import mailer
    from app.config import settings
    sent = {}

    class FakeSES:
        def send_email(self, **kw):
            sent.update(kw)
            return {"MessageId": "0100-abc"}
    monkeypatch.setattr(settings, "email_provider", "ses")
    monkeypatch.setattr(settings, "ses_from_email", "billing@clinic.example")
    monkeypatch.setattr(settings, "ses_reply_to", "hello@clinic.example")
    monkeypatch.setattr(mailer, "_client", FakeSES())
    from app.emails import _images, receipt_email
    subj, html, text = receipt_email({"no": "RC-00009", "billNo": "INV-2026-00009", "date": "2026-11-21", "time": "5:30 pm", "patient": "Test",
                                      "method": "Cash", "lines": [{"d": "Consultation", "amt": 80}], "total": 80})
    r = mailer.send("p@example.com", subj, html, text, _images())
    assert r == {"status": "sent", "messageId": "0100-abc"} and sent["Destination"] == {"ToAddresses": ["p@example.com"]}
    msg = email.message_from_bytes(sent["Content"]["Raw"]["Data"], policy=email.policy.default)
    assert "billing@clinic.example" in msg["From"] and msg["Reply-To"] == "hello@clinic.example" and msg["Subject"] == subj
    cids = [part["Content-ID"] for part in msg.walk() if part.get("Content-ID")]
    assert cids == ["<dvlogo>", "<dvwordmark>"]

    class Broken:
        def send_email(self, **kw):
            class E(Exception):
                response = {"Error": {"Code": "MessageRejected", "Message": "Email address is not verified."}}
            raise E("rejected")
    monkeypatch.setattr(mailer, "_client", Broken())
    assert mailer.send("p@example.com", subj, html, text) == {"status": "failed", "error": "Email address is not verified."}
    monkeypatch.setattr(settings, "ses_from_email", "")
    assert mailer.send("p@example.com", subj, html, text)["status"] == "not_configured"
