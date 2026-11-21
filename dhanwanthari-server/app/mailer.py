"""Outgoing email. EMAIL_PROVIDER:
  ses    – Amazon SES (API v2). Needs SES_FROM_EMAIL (a verified identity) and AWS credentials (env vars, ~/.aws, or an IAM role).
  log    – nothing is sent; one line per email is printed to the server console (default; development).
  memory – kept in OUTBOX (tests).
Every attempt is returned as {status: sent|logged|failed|not_configured, messageId?, error?}."""
from __future__ import annotations

import logging
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from .config import settings

log = logging.getLogger("dvc.mail")
OUTBOX: list[dict] = []          # memory provider (tests)
_client = None


def _ses():
    global _client
    if _client is None:
        import os

        import boto3
        for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
            if os.environ.get(k) == "":      # blank lines in .env → use the instance role / ~/.aws instead
                os.environ.pop(k)
        _client = boto3.client("sesv2", region_name=settings.aws_region)
    return _client


def configured() -> bool:
    return settings.email_provider != "ses" or bool(settings.ses_from_email)


def build(to: str, subject: str, html: str, text: str, images: dict[str, tuple[bytes, str]] | None = None) -> EmailMessage:
    """multipart/alternative (text + html); images are attached inline and referenced in the HTML as cid:<name>"""
    m = EmailMessage()
    m["From"] = formataddr((settings.ses_from_name, settings.ses_from_email or "no-reply@localhost"))
    m["To"] = to
    m["Subject"] = subject
    if settings.ses_reply_to:
        m["Reply-To"] = settings.ses_reply_to
    m["Message-ID"] = make_msgid(domain=(settings.ses_from_email.split("@")[-1] if "@" in settings.ses_from_email else "localhost"))
    m.set_content(text)
    m.add_alternative(html, subtype="html")
    if images:
        html_part = m.get_payload()[1]
        for cid, (data, mime) in images.items():
            maintype, subtype = mime.split("/")
            html_part.add_related(data, maintype=maintype, subtype=subtype, cid=f"<{cid}>", filename=f"{cid}.{subtype.replace('jpeg', 'jpg')}")
    return m


def send(to: str, subject: str, html: str, text: str, images: dict | None = None, *, console_note: str = "") -> dict:
    provider = settings.email_provider
    if provider == "memory":
        OUTBOX.append({"to": to, "subject": subject, "html": html, "text": text, "images": sorted((images or {}).keys())})
        return {"status": "sent", "messageId": f"memory-{len(OUTBOX)}"}
    if provider != "ses":
        log.warning("[email] (not sent, EMAIL_PROVIDER=%s) to=%s subject=%r %s", provider, to, subject, console_note)
        return {"status": "logged"}
    if not settings.ses_from_email:
        log.error("[email] SES_FROM_EMAIL is not set: cannot send %r to %s", subject, to)
        return {"status": "not_configured", "error": "Sender not set up (SES_FROM_EMAIL)"}
    try:
        msg = build(to, subject, html, text, images)
        args = {"FromEmailAddress": msg["From"], "Destination": {"ToAddresses": [to]}, "Content": {"Raw": {"Data": msg.as_bytes()}}}
        if settings.ses_configuration_set:
            args["ConfigurationSetName"] = settings.ses_configuration_set
        r = _ses().send_email(**args)
        return {"status": "sent", "messageId": r.get("MessageId")}
    except Exception as e:      # botocore ClientError (MessageRejected: address not verified, sandbox, …), network, credentials
        err = getattr(e, "response", {}).get("Error", {}).get("Message") if hasattr(e, "response") else None
        log.error("[email] SES send failed to=%s subject=%r: %s", to, subject, err or e)
        return {"status": "failed", "error": (err or str(e))[:300]}
