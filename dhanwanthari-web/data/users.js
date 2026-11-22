// Staff roles and demo sign-in. Live mode uses the clinic server's /api/auth (hashed passwords + emailed code).
export const DEMO_USERS = [
  { email: "admin@dhanwanthari.test", password: "Dhanwanthari@2026", otp: "246810", name: "Clinic Admin", role: "admin" },
]
/** demo mode keeps users in this browser; passwords as SHA-256 of "dvc-demo:" + password (demo only) */
export const DEMO_USER_SEED = [{ id: "u1", email: "admin@dhanwanthari.test", name: "Clinic Admin", role: "admin", active: true, pwHash: "6f125dafe650b2a32f0f728364c08630d46cdf8b6a0a71362f28cf37a102967b", createdAt: "2026-11-01T00:00:00Z" }]
export const ROLES = {
  admin: { en: "Admin", ms: "Pentadbir" },
  bams: { en: "BAMS doctor (Ayurvedic Practitioner)", ms: "Doktor BAMS (Pengamal Ayurveda)" },
  therapist: { en: "Therapist", ms: "Ahli terapi" },
  cashier: { en: "Cashier", ms: "Juruwang" },
}
