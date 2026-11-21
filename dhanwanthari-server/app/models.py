"""Database tables (SQLModel on SQLite). Dates are ISO strings 'YYYY-MM-DD'; money is RM rounded to 2 decimals.
Single clinic per database file. Schema changes go through Alembic (alembic/versions)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Column, ForeignKey, String, UniqueConstraint
from sqlmodel import Field, SQLModel


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def J(default: Any = None) -> Any:  # JSON column helper
    return Field(default_factory=(lambda: list(default)) if isinstance(default, list) else (lambda: dict(default or {})), sa_column=Column(JSON, nullable=False))


# --------------------------------------------------------------------------- users & sign-in
class User(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(default_factory=_uuid, primary_key=True)
    email: str = Field(index=True, unique=True)
    name: str
    password_hash: str
    role: str  # admin | bams | therapist | cashier  (see app/roles.py)
    active: bool = True
    token_version: int = Field(default=0, sa_column_kwargs={"server_default": "0"})   # +1 on password reset / deactivate → old sign-ins stop working
    last_login_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=_now)


class LoginChallenge(SQLModel, table=True):
    __tablename__ = "login_challenges"
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str = Field(foreign_key="users.id")
    code_hash: str
    expires_at: datetime
    tries: int = 0
    used: bool = False


# --------------------------------------------------------------------------- clinic setup
class Unit(SQLModel, table=True):
    __tablename__ = "units"
    id: str = Field(primary_key=True)
    type: str  # consult | therapy
    name: dict = J({})


class Practitioner(SQLModel, table=True):
    __tablename__ = "practitioners"
    id: str = Field(primary_key=True)
    unit_id: str = Field(foreign_key="units.id")
    name: str
    role: str


class Service(SQLModel, table=True):
    __tablename__ = "services"
    id: str = Field(primary_key=True)
    unit_type: str  # consult | therapy
    code: Optional[str] = None
    group: Optional[str] = Field(default=None, sa_column=Column("grp", String, nullable=True))
    name: dict = J({})
    price: float
    normal_price: Optional[float] = None     # wellness offers: normal price
    offer_label: Optional[str] = None        # promo | member | special
    wellness: bool = False
    mins: Optional[int] = None
    benefits: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    advance_booking: bool = False
    active: bool = True


class Package(SQLModel, table=True):
    __tablename__ = "packages"
    id: str = Field(primary_key=True)
    name: dict = J({})
    sessions: int                      # total of items[].n
    price: float
    items: list = J([])                # [{"svc": service id, "n": sessions}] — the therapies; empty = flexible (any therapy, `sessions` total)
    code: Optional[str] = None         # e.g. "PLAN 1"
    duration: Optional[str] = None     # e.g. "3 weeks" (as on the brochure)
    validity_months: Optional[int] = None   # sessions usable until sale date + N months
    inclusions: list = J([])           # brochure bullet points
    active: bool = Field(default=True, sa_column_kwargs={"server_default": "1"})   # False = deleted (no longer sold)


class ClinicSettings(SQLModel, table=True):
    __tablename__ = "clinic_settings"
    id: int = Field(default=1, primary_key=True)
    clinic: dict = J({})
    sst: dict = J({})
    attendance: dict = J({})          # shift start / end, grace minutes, working days (app/attendance.py DEFAULT)
    updated_at: datetime = Field(default_factory=_now)


class Counter(SQLModel, table=True):
    __tablename__ = "counters"
    name: str = Field(primary_key=True)
    value: int


# --------------------------------------------------------------------------- patients
class Patient(SQLModel, table=True):
    __tablename__ = "patients"
    id: str = Field(primary_key=True)  # DV-00001
    name: str = Field(index=True)
    citizenship: str = "citizen"       # citizen | non-citizen  (decides SST)
    id_type: str = "mykad"             # mykad | passport
    id_no: str = Field(unique=True)
    dob: Optional[str] = None
    sex: Optional[str] = None          # F | M
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None
    allergy: str = ""
    flags: list = J([])                # diabetes | hypertension | pregnant
    emergency_name: Optional[str] = None
    emergency_phone: Optional[str] = None
    notes: Optional[str] = None
    height_cm: Optional[float] = None   # vitals at registration
    weight_kg: Optional[float] = None
    bp: Optional[str] = None            # "120/80"
    pdpa_consent_at: datetime
    created_at: datetime = Field(default_factory=_now)
    created_by: Optional[str] = None
    updated_at: Optional[datetime] = None


# --------------------------------------------------------------------------- visits & prescriptions
class Visit(SQLModel, table=True):
    __tablename__ = "visits"
    id: str = Field(default_factory=_uuid, primary_key=True)
    patient_id: str = Field(foreign_key="patients.id", index=True)
    unit_id: str = Field(foreign_key="units.id")
    practitioner_id: str
    room: Optional[str] = None
    visit_date: str = Field(index=True)
    slot: str                          # HH:MM
    kind: str                          # walkin | appt
    status: str = "booked"             # booked | waiting | consult | dispense | billing | done | cancelled
    service_id: Optional[str] = None   # service, or "session" for a package session
    client_package_id: Optional[str] = Field(default=None, foreign_key="client_packages.id")
    package_service_id: Optional[str] = None   # package session: which therapy of the package
    cleared_at: Optional[datetime] = None      # finished visit hidden from the queue by "Clear queue" (still in records)
    bill_no: Optional[str] = None              # INV-YYYY-NNNNN, reserved when the visit is completed (used on the emailed invoice, the bill and the receipt)
    diagnosis: Optional[str] = None
    dosha: Optional[str] = None
    notes: Optional[str] = None
    mc_days: int = 0
    checked_in_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=_now)


class RxItem(SQLModel, table=True):
    __tablename__ = "rx_items"
    id: str = Field(default_factory=_uuid, primary_key=True)
    visit_id: str = Field(sa_column=Column(String, ForeignKey("visits.id", ondelete="CASCADE"), nullable=False, index=True))
    item_id: str = Field(foreign_key="inventory.id")
    qty: int
    warning: Optional[str] = None


# --------------------------------------------------------------------------- pharmacy
class InventoryItem(SQLModel, table=True):
    __tablename__ = "inventory"
    id: str = Field(primary_key=True)
    name: str
    form: str
    unit: str
    stock: int
    reorder_level: int
    price: float
    cost: float = 0                    # unit purchase cost → cost of sales (5010) and stock value (1200)
    batch: Optional[str] = None
    expiry: Optional[str] = None
    base_oil: Optional[str] = None     # sesame | coconut
    contra: list = J([])               # e.g. ["pregnancy"]
    has_sugar: bool = False
    used_for: str = "both"             # both | dispense | therapy
    sort: int = 0
    archived: bool = Field(default=False, sa_column_kwargs={"server_default": "0"})   # deleted: hidden, kept for history


class StockMove(SQLModel, table=True):
    __tablename__ = "stock_moves"
    id: Optional[int] = Field(default=None, primary_key=True)
    item_id: str = Field(foreign_key="inventory.id")
    qty: int
    reason: str                        # dispense | receive | opening | adjust | delete | import
    ref: Optional[str] = None
    at: datetime = Field(default_factory=_now)


# --------------------------------------------------------------------------- packages sold
class ClientPackage(SQLModel, table=True):
    __tablename__ = "client_packages"
    id: str = Field(default_factory=_uuid, primary_key=True)
    patient_id: str = Field(foreign_key="patients.id", index=True)
    package_id: str = Field(foreign_key="packages.id")
    used: int = 0
    sessions: int
    price: float
    sold_on: str
    plan: str                          # full | partial
    name: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))    # package as sold (later edits don't change it)
    items: Optional[list] = Field(default=None, sa_column=Column(JSON, nullable=True))
    validity_months: Optional[int] = None   # as sold


class PackagePayment(SQLModel, table=True):
    __tablename__ = "package_payments"
    id: Optional[int] = Field(default=None, primary_key=True)
    client_package_id: str = Field(foreign_key="client_packages.id", index=True)
    paid_on: str
    amount: float
    method: str
    received_by: Optional[str] = None


class PackageSession(SQLModel, table=True):
    __tablename__ = "package_sessions"
    id: Optional[int] = Field(default=None, primary_key=True)
    client_package_id: str = Field(foreign_key="client_packages.id", index=True)
    visit_id: Optional[str] = None
    used_on: str
    service_id: Optional[str] = None   # which therapy of the package


# --------------------------------------------------------------------------- billing & accounting
class Invoice(SQLModel, table=True):
    __tablename__ = "invoices"
    id: str = Field(primary_key=True)  # INV-2026-00001
    visit_id: Optional[str] = Field(default=None, foreign_key="visits.id")
    patient_id: str = Field(foreign_key="patients.id", index=True)
    unit_id: Optional[str] = None
    issued_on: str
    subtotal: float
    sst: float = 0
    total: float
    method: str                        # cash | card | duitnow | transfer | package
    status: str                        # paid | pending | failed | cancelled
    lines: list = J([])
    tx_id: Optional[str] = None


class Account(SQLModel, table=True):
    __tablename__ = "accounts"
    code: str = Field(primary_key=True)
    name: str
    type: str                          # asset | liability | equity | income | cogs | expense
    grp: str
    active: bool = True


class JournalEntry(SQLModel, table=True):
    __tablename__ = "journal"
    id: Optional[int] = Field(default=None, primary_key=True)
    entry_date: str = Field(index=True)
    description: str
    debit: str = Field(foreign_key="accounts.code")
    credit: str = Field(foreign_key="accounts.code")
    amount: float
    ref: Optional[str] = Field(default=None, index=True)


class MoneyTransaction(SQLModel, table=True):
    """What Accounting → Transactions lists. Its postings are journal rows with ref = id."""
    __tablename__ = "transactions"
    id: str = Field(primary_key=True)  # RC-00001 (in) / PV-00001 (out)
    tx_date: str = Field(index=True)
    type: str                          # in | out
    description: str
    account_code: str
    method: str                        # cash | card | duitnow | transfer
    reference: str = ""
    patient_id: Optional[str] = None
    status: str                        # paid | pending | failed | cancelled
    net: float
    tax: float = 0
    tax_code: str = "NR"
    amount: float
    parts: list = J([])                # [{acc, net, tax, taxCode}]
    log: list = J([])
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
    seq: int = 0


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"
    id: Optional[int] = Field(default=None, primary_key=True)
    at: datetime = Field(default_factory=_now)
    actor: Optional[str] = None
    action: str
    entity: Optional[str] = None
    entity_id: Optional[str] = None
    detail: dict = J({})


__all__ = [n for n in dir() if n[0].isupper()] + ["UniqueConstraint"]


class AttendanceEntry(SQLModel, table=True):
    """One clock-in/out session, or a day of leave. Times are clinic-local "HH:MM"."""
    __tablename__ = "attendance"
    id: str = Field(default_factory=_uuid, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    work_date: str = Field(index=True)            # YYYY-MM-DD (Malaysia)
    kind: str = "work"                            # work | leave
    time_in: Optional[str] = None
    time_out: Optional[str] = None
    leave_type: Optional[str] = None              # annual | medical | emergency | unpaid | public
    note: Optional[str] = None
    source: str = "clock"                         # clock | manual
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class EmailLog(SQLModel, table=True):
    """Every email attempt (sign-in codes, invoices, receipts). Codes themselves are never stored."""
    __tablename__ = "email_log"
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str                                     # otp | invoice | receipt
    to_email: str = ""
    subject: str = ""
    ref: str = Field(default="", index=True)      # INV-… / RC-… / visit id
    status: str                                   # sent | logged | skipped | failed | not_configured
    error: Optional[str] = None
    message_id: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
