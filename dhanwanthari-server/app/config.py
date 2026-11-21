"""Settings from environment variables (see .env.example)."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


class Settings:
    env = _env("APP_ENV", "development")                       # development | production
    database_url = _env("DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'clinic.db'}")
    jwt_secret = _env("JWT_SECRET", "")
    otp_pepper = _env("OTP_PEPPER", "dev-pepper")
    otp_delivery = _env("OTP_DELIVERY", "")                    # "" | log | response (dev/tests only)
    # ---- email (Amazon SES). EMAIL_PROVIDER: log (prints to the server console) | ses | memory (tests)
    email_provider = _env("EMAIL_PROVIDER", "log")
    aws_region = _env("AWS_REGION", "ap-southeast-1")
    ses_from_email = _env("SES_FROM_EMAIL", "")                 # a verified SES identity, e.g. billing@yourdomain.com
    ses_from_name = _env("SES_FROM_NAME", "Dhanwanthari Vilasam")
    ses_reply_to = _env("SES_REPLY_TO", "")
    ses_configuration_set = _env("SES_CONFIGURATION_SET", "")
    invoice_emails = _env("INVOICE_EMAILS", "on").lower() not in ("off", "0", "false", "no")
    demo_fixed_otp = _env("DEMO_FIXED_OTP", "")
    allowed_origins = [o for o in _env("ALLOWED_ORIGINS", "").split(",") if o]
    frontend_dir = _env("FRONTEND_DIR", str(BASE_DIR / "frontend"))   # built web app (index.html) served at /
    frontend_mode = _env("FRONTEND_MODE", "live")              # what /config.json tells the web app: live | auto | demo
    session_hours = int(_env("SESSION_HOURS", "8"))
    tz_offset_hours = 8                                        # Malaysia (UTC+8) for "today"

    @property
    def production(self) -> bool:
        return self.env == "production"

    def secret(self) -> str:
        if self.jwt_secret:
            return self.jwt_secret
        if self.production:
            raise RuntimeError("JWT_SECRET is required in production")
        return "dev-only-secret-change-me-please-32b"


settings = Settings()
