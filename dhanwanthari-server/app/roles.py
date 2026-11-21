"""Staff roles. Admin can do everything; the others are listed on each endpoint with can(...)."""
ROLES = {
    "admin": "Admin",
    "bams": "BAMS doctor (Ayurvedic Practitioner)",   # consultation, prescriptions, dispensing, pharmacy & stock
    "therapist": "Therapist",     # therapy visits, package sessions
    "cashier": "Cashier",         # registration, queue, billing, package sales, payments & expenses, reports
}
# roles from earlier versions → new role (migration 0004 converts stored users)
OLD_ROLES = {"vaidya": "bams", "pharmacist": "bams", "front": "cashier", "finance": "cashier"}
