// Patient register starts EMPTY. Staff register each client under Patients → "Register patient".
// Fields captured per patient (see src/pages/Patients.jsx and the API's patients table):
//   name, idType (mykad | passport), idNo, dob, sex, phone, email, address,
//   allergy, flags (diabetes | hypertension | pregnant), emergency { name, phone },
//   notes, pdpaConsent (true once the client has agreed to the clinic's PDPA notice)
export const PATIENTS = []

export const CONDITION_FLAGS = [
  ["diabetes", { en: "Diabetes", ms: "Diabetes" }],
  ["hypertension", { en: "Hypertension", ms: "Hipertensi" }],
  ["pregnant", { en: "Pregnant", ms: "Hamil" }],
]
