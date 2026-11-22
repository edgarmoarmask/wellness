// Clinic setup: units, practitioners, rooms, services, packages, payers.
// ALL DEMO DATA. Replace names, prices and payers with Dhanwanthari Vilasam's real figures before go-live.
const L = (en, ms) => ({ en, ms })

export const CLINIC = {
  name: "Dhanwanthari Vilasam Ayurveda Vaidyasala",
  short: "Dhanwanthari Vilasam",
  since: 1957,
  location: "Brickfields, Kuala Lumpur",
  address: "No. 241, First Floor, Jalan Tun Sambanthan, Brickfields, 50470 Kuala Lumpur",
  whatsapp: "011-3342 3455",
  phone: "03-8922 3455",
  email: "ayurvedabrickfieldskl@gmail.com",
  currency: "RM",
}

// A "unit" plays the role of a branch in the dashboard filters.
export const UNITS = [
  { id: "opd", type: "consult", name: L("Vaidya consultation (OPD)", "Konsultasi Vaidya (OPD)"), short: L("Consultation", "Konsultasi") },
  { id: "tx", type: "therapy", name: L("Panchakarma & therapy", "Panchakarma & terapi"), short: L("Therapy", "Terapi") },
]

export const PRACTITIONERS = {
  opd: [
    { id: "d1", name: "Dr. Ramesh Nair (BAMS)", role: "vaidya" },
    { id: "d2", name: "Dr. Lakshmi Menon (BAMS)", role: "vaidya" },
  ],
  tx: [
    { id: "t1", name: "Kavitha (therapist)", role: "therapist" },
    { id: "t2", name: "Suresh (therapist)", role: "therapist" },
    { id: "t3", name: "Anitha (therapist)", role: "therapist" },
  ],
}

export const ROOMS = [
  { id: "C1", name: L("Consult room 1", "Bilik konsultasi 1") },
  { id: "C2", name: L("Consult room 2", "Bilik konsultasi 2") },
  { id: "R1", name: L("Therapy room 1 (Droni)", "Bilik terapi 1 (Droni)") },
  { id: "R2", name: L("Therapy room 2 (Droni)", "Bilik terapi 2 (Droni)") },
  { id: "R3", name: L("Shirodhara room", "Bilik Shirodhara") },
]

// Wellness therapies, from the clinic's promotional posters (Dhanwanthari_Vilasam_Packages.xlsx, Nov 2026).
// price = offer price charged; normal = normal price; label = how the poster labels the offer.
// mins: null where the poster does not state a duration. check: open points for the clinic to confirm.
export const WELLNESS = [
  { id: "abhy", name: L("Abhyangam (herbal oil therapy)", "Abhyangam (terapi minyak herba)"), mins: null, price: 110, normal: 130, label: "promo",
    benefits: L("Herbal oil massage. Relieves stress and tension, improves circulation, restores vitality.", "Urutan minyak herba. Melegakan tekanan dan ketegangan, melancarkan peredaran darah, memulihkan tenaga."), check: L("Same treatment type as the 60-min warm oil massage at a different price. Duration not stated.", "Jenis rawatan sama dengan urutan minyak 60 min pada harga berbeza. Tempoh tidak dinyatakan.") },
  { id: "oilm", name: L("Full body medicated warm oil massage (head to toe)", "Urutan minyak ubat suam seluruh badan (kepala hingga kaki)"), mins: 60, price: 130, normal: 160, label: "member",
    benefits: L("Relieves muscle stiffness and body pain; muscle tone and flexibility, circulation, skin glow, stress, sleep, immunity.", "Melegakan kekejangan otot dan sakit badan; kelenturan otot, peredaran darah, kulit berseri, tekanan, tidur, imuniti.") },
  { id: "kizhi", name: L("Abhyangam + hot poultice (Kizhi) therapy", "Abhyangam + terapi tuam panas (Kizhi)"), mins: null, price: 130, normal: 150, label: "special",
    benefits: L("Oil massage with a warm herbal poultice.", "Urutan minyak dengan tuam herba panas."), check: L("Normal price RM150 is below the plain 60-min oil massage (RM160). Duration not stated.", "Harga biasa RM150 lebih rendah daripada urutan minyak 60 min (RM160). Tempoh tidak dinyatakan.") },
  { id: "swed", name: L("Full body medicated oil massage + herbal sudation (Swedana)", "Urutan minyak ubat seluruh badan + wap herba (Swedana)"), mins: 90, price: 150, normal: 190, label: "member", advance: true,
    benefits: L("Warm medicated oil massage, herbal steam, deep muscle relaxation, detox and circulation. For back pain, stress, poor sleep.", "Urutan minyak ubat suam, wap herba, relaksasi otot, detoks dan peredaran darah. Untuk sakit belakang, tekanan, kurang tidur.") },
  { id: "destress", name: L("De-Stress therapy (with Shirodhara)", "Terapi Nyah-Tekanan (dengan Shirodhara)"), mins: 90, price: 190, normal: 250, label: "member",
    benefits: L("Full body warm medicated oil massage + Shirodhara + herbal scrub and bath. Calms the mind; helps concentration, stress, headache, sleep.", "Urutan minyak ubat suam seluruh badan + Shirodhara + scrub dan mandian herba. Menenangkan minda; membantu tumpuan, tekanan, sakit kepala, tidur."), check: L("One poster shows RM220 member price; one Shirodhara poster has no name. Confirm RM190.", "Satu poster menunjukkan RM220; satu poster Shirodhara tiada nama. Sahkan RM190.") },
]

export const SERVICES = {
  consult: [
    { id: "cons", name: L("Vaidya consultation (Nadi pariksha)", "Konsultasi Vaidya (Nadi pariksha)"), price: 80, mins: 30 },
    { id: "fup", name: L("Follow-up consultation", "Konsultasi susulan"), price: 50, mins: 20 },
    { id: "prak", name: L("Prakriti (body-type) assessment", "Penilaian Prakriti (jenis badan)"), price: 120, mins: 45 },
  ],
  // From Dhanwanthari_Vilasam_Price_List.xlsx (Nov 2026): wellness packages, walk-in treatments, add-ons.
  therapy: [
    ...WELLNESS.map(({ id, name, mins, price, normal, label }) => ({ id, group: "Wellness offer", name, mins: mins ?? 60, price, normal, label, wellness: true })),
    { id: "ab", code: "AB", group: "Walk-in treatment", name: L("Abhyangam + face massage + head massage (full body herbal oil massage)", "Abhyangam + face massage + head massage (full body herbal oil massage)"), mins: 60, price: 100 },
    { id: "ab-stb", code: "AB STB", group: "Walk-in treatment", name: L("Abhyangam + face massage + head massage + steam bath", "Abhyangam + face massage + head massage + steam bath"), mins: 75, price: 120 },
    { id: "ab-pk", code: "AB PK", group: "Walk-in treatment", name: L("Abhyangam + Podi Kizhi + hot water bath", "Abhyangam + Podi Kizhi + hot water bath"), mins: 60, price: 100 },
    { id: "ab-pk1", code: "AB PK1", group: "Walk-in treatment", name: L("Abhyangam + Podi Kizhi + hot water bath (90 min)", "Abhyangam + Podi Kizhi + hot water bath (90 min)"), mins: 90, price: 150 },
    { id: "sd", code: "SD", group: "Walk-in treatment", name: L("Shirodhara", "Shirodhara"), mins: 60, price: 120 },
    { id: "absd", code: "ABSD", group: "Walk-in treatment", name: L("Abhyangam + Shirodhara", "Abhyangam + Shirodhara"), mins: 90, price: 220 },
    { id: "abpksd", code: "ABPKSD", group: "Walk-in treatment", name: L("Abhyangam + Kizhi + Shirodhara", "Abhyangam + Kizhi + Shirodhara"), mins: 120, price: 250 },
    { id: "ud", code: "UD", group: "Walk-in treatment", name: L("Abhyangam + Udwartanam", "Abhyangam + Udwartanam"), mins: 60, price: 130 },
    { id: "pk-d", code: "PK D", group: "Walk-in treatment", name: L("Podikizhi (dry, without oil)", "Podikizhi (dry, without oil)"), mins: 60, price: 100 },
    { id: "ek", code: "EK", group: "Walk-in treatment", name: L("Elakizhi", "Elakizhi"), mins: 60, price: 130 },
    { id: "nv", code: "NV", group: "Walk-in treatment", name: L("Naranga Kizhi", "Naranga Kizhi"), mins: 60, price: 130 },
    { id: "abnav", code: "ABNAV", group: "Walk-in treatment", name: L("Abhyangam (10 min) + Navara Kizhi (50 min)", "Abhyangam (10 min) + Navara Kizhi (50 min)"), mins: 60, price: 130 },
    { id: "piz", code: "PIZ", group: "Walk-in treatment", name: L("Pizhichil", "Pizhichil"), mins: 60, price: 200 },
    { id: "pdm", code: "PDM", group: "Walk-in treatment", name: L("Post delivery massage (maternal)", "Post delivery massage (maternal)"), mins: 60, price: 120 },
    { id: "fm", code: "FM", group: "Walk-in treatment", name: L("Face massage", "Face massage"), mins: 30, price: 60 },
    { id: "ftm", code: "FTM", group: "Walk-in treatment", name: L("Foot massage", "Foot massage"), mins: 30, price: 60 },
    { id: "hdm", code: "HDM", group: "Walk-in treatment", name: L("Head massage", "Head massage"), mins: 30, price: 60 },
    { id: "lom", code: "LOM", group: "Walk-in treatment", name: L("Local massage", "Local massage"), mins: 30, price: 60 },
    { id: "ktv", code: "KTV", group: "Walk-in treatment", name: L("Kati Vasti", "Kati Vasti"), mins: 30, price: 120 },
    { id: "kv", code: "KV", group: "Walk-in treatment", name: L("Kashaya Vasti", "Kashaya Vasti"), mins: 120, price: 150 },
    { id: "ksd", code: "KSD", group: "Walk-in treatment", name: L("Kashaya Dhara", "Kashaya Dhara"), mins: 60, price: 100 },
    { id: "piu", code: "PIU", group: "Walk-in treatment", name: L("Pichu", "Pichu"), mins: 30, price: 70 },
    { id: "nas", code: "NAS", group: "Walk-in treatment", name: L("Nasyam", "Nasyam"), mins: 30, price: 70 },
    { id: "shl", code: "SHL", group: "Walk-in treatment", name: L("Shirolepam", "Shirolepam"), mins: 30, price: 80 },
    { id: "shv", code: "SHV", group: "Walk-in treatment", name: L("Shirovasti", "Shirovasti"), mins: 30, price: 130 },
    { id: "lep", code: "LEP", group: "Walk-in treatment", name: L("Lepanam", "Lepanam"), mins: 30, price: 70 },
    { id: "ban", code: "BAN", group: "Walk-in treatment", name: L("Bandanam", "Bandanam"), mins: 30, price: 70 },
    { id: "nt", code: "NT", group: "Walk-in treatment", name: L("Netra Tarpanam", "Netra Tarpanam"), mins: 30, price: 150 },
    { id: "ft", code: "FT", group: "Walk-in treatment", name: L("Facial therapy", "Facial therapy"), mins: 60, price: 150 },
  ],
}

export const PACKAGES = [
  // items: therapies in the package and how many sessions of each. Empty = flexible: any therapy is recorded against the total sessions.
  { id: "pk7", name: L("Panchakarma detox, 7 days", "Detoks Panchakarma, 7 hari"), items: [], sessions: 7, price: 2800 },
  { id: "pk14", name: L("Panchakarma programme, 14 days", "Program Panchakarma, 14 hari"), items: [], sessions: 14, price: 5200 },
  { id: "sh5", name: L("Shirodhara, 5 sessions", "Shirodhara, 5 sesi"), items: [{ svc: "sd", n: 5 }], sessions: 5, price: 990 },
  { id: "kb6", name: L("Kati basti for back pain, 6 sessions", "Kati basti untuk sakit belakang, 6 sesi"), items: [{ svc: "ktv", n: 6 }], sessions: 6, price: 820 },
  { id: "ab10", name: L("Abhyanga, 10 sessions", "Abhyanga, 10 sesi"), items: [{ svc: "ab", n: 10 }], sessions: 10, price: 1350 },
  // Wellness & therapy plans from the clinic brochure (DV Plans – Revised). Flexible: any therapy, consultation or session is recorded against the total.
  { id: "plan1", code: "PLAN 1", name: L("Introductory Plan (Consultation & Dietary Program)", "Introductory Plan (Consultation & Dietary Program)"), items: [], sessions: 4, price: 399, duration: "3 weeks", validityMonths: 3,
    inclusions: ["One time Ayurvedic consultation with Nadi pareeksha", "General Body Therapies", "Major - 3", "Minor - 1", "Dietary Advice"] },
  { id: "plan2", code: "PLAN 2", name: L("Spine Correction Program", "Spine Correction Program"), items: [], sessions: 7, price: 999, duration: "4 weeks", validityMonths: 6,
    inclusions: ["Three Ayurvedic consultation with Nadi pareeksha", "Exercise and posture correction", "Work life balance guidance", "Physiotherapy Support"] },
  { id: "plan3", code: "PLAN 3", name: L("Immunity Booster / Obesity Management Program", "Immunity Booster / Obesity Management Program"), items: [], sessions: 12, price: 1499, duration: "8 weeks", validityMonths: 6,
    inclusions: ["Panchakarma Detox Therapy", "Gut restoration Therapy", "Yoga and meditation", "Dietary Advice"] },
  { id: "plan4", code: "PLAN 4", name: L("Personalized Full Body Detox Program", "Personalized Full Body Detox Program"), items: [], sessions: 21, price: 2499, duration: "1 month", validityMonths: 12,
    inclusions: ["Panchakarma Detox Therapies (Complete Body Cleansing)", "6 complementary consultations", "Specialized Cleansing Therapies (1-3 adults)", "Dietary Advice"] },
  { id: "plan5", code: "PLAN 5", name: L("Couple Infertility / Pre and Post Natal / Wellness Program", "Couple Infertility / Pre and Post Natal / Wellness Program"), items: [], sessions: 14, price: 1999, duration: "Up to 6 months", validityMonths: 12,
    inclusions: ["Pre and Post Natal Care", "Body Hormone Management", "Sexual Disabilities Management", "Family counselling", "Yoga and Meditation"] },
]

// Package payment policy (wellness centre: clients pay directly).
// Full payment, or partial payment with a minimum deposit; sessions unlock in line with the amount paid.
export const PAYMENT_POLICY = {
  minDepositPct: 30,      // partial payment must be at least 30% of the package price
  unlockBy: "paid",       // sessions available = amount paid ÷ value per session (all sessions once fully paid)
  balanceDueDays: 30,     // balance expected within 30 days of purchase
}

export const DIAGNOSES = [
  ["M54.5", L("Low back pain", "Sakit belakang bawah"), "vata"],
  ["M17.9", L("Knee osteoarthritis", "Osteoartritis lutut"), "vata"],
  ["G43.9", L("Migraine", "Migrain"), "pitta"],
  ["F51.0", L("Insomnia, non-organic", "Insomnia, bukan organik"), "vata"],
  ["K30", L("Dyspepsia / acidity", "Dispepsia / keasidan"), "pitta"],
  ["L40.9", L("Psoriasis", "Psoriasis"), "pitta"],
  ["E66.9", L("Overweight / obesity", "Berat berlebihan / obesiti"), "kapha"],
  ["J30.4", L("Allergic rhinitis", "Rinitis alergi"), "kapha"],
]
export const DOSHAS = [
  ["vata", L("Vata imbalance", "Ketidakseimbangan Vata")],
  ["pitta", L("Pitta imbalance", "Ketidakseimbangan Pitta")],
  ["kapha", L("Kapha imbalance", "Ketidakseimbangan Kapha")],
  ["mixed", L("Mixed (dvandva)", "Campuran (dvandva)")],
]

// Accounts: see src/lib/ledger.js (chart of accounts with codes).
