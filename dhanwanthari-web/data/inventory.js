// Classical Ayurvedic medicines and therapy oils. Stock, prices, cost prices and batches are DEMO values — replace with real stock.
// cost = purchase cost per unit (drives Cost of medicines sold 5010 and Inventory 1200).
// base / contra drive the safety checks: a "sesame" base conflicts with a sesame allergy,
// "sugar" warns for diabetes, "pregnancy" blocks for pregnant patients.
import { daysFromToday } from "./util.js"

export const INVENTORY = [
  { id: "m1", name: "Dhanwantharam Thailam 200ml", form: "thailam", unit: "bottle", stock: 26, reorder: 15, price: 38, cost: 20.9, batch: "DT2508", exp: daysFromToday(410), base: "sesame", use: "both" },
  { id: "m2", name: "Mahanarayana Thailam 200ml", form: "thailam", unit: "bottle", stock: 9, reorder: 12, price: 45, cost: 24.75, batch: "MN2506", exp: daysFromToday(290), base: "sesame", use: "both" },
  { id: "m3", name: "Murivenna 200ml", form: "thailam", unit: "bottle", stock: 18, reorder: 10, price: 32, cost: 17.6, batch: "MV2509", exp: daysFromToday(330), base: "coconut", use: "both" },
  { id: "m4", name: "Ksheerabala Thailam 10ml", form: "thailam", unit: "bottle", stock: 40, reorder: 20, price: 28, cost: 15.4, batch: "KB2510", exp: daysFromToday(48), base: "sesame", use: "dispense" },
  { id: "m5", name: "Rasnadi Kashayam 200ml", form: "kashayam", unit: "bottle", stock: 34, reorder: 20, price: 24, cost: 13.2, batch: "RK2507", exp: daysFromToday(380), use: "dispense" },
  { id: "m6", name: "Gandharvahastadi Kashayam 200ml", form: "kashayam", unit: "bottle", stock: 12, reorder: 20, price: 24, cost: 13.2, batch: "GK2505", exp: daysFromToday(260), use: "dispense" },
  { id: "m7", name: "Ashwagandharishtam 450ml", form: "arishtam", unit: "bottle", stock: 21, reorder: 12, price: 42, cost: 23.1, batch: "AA2504", exp: daysFromToday(520), contra: ["pregnancy"], use: "dispense" },
  { id: "m8", name: "Dashamoolarishtam 450ml", form: "arishtam", unit: "bottle", stock: 16, reorder: 12, price: 40, cost: 22.0, batch: "DA2508", exp: daysFromToday(35), use: "dispense" },
  { id: "m9", name: "Triphala Choornam 100g", form: "choornam", unit: "pack", stock: 44, reorder: 20, price: 18, cost: 9.9, batch: "TC2511", exp: daysFromToday(450), contra: ["pregnancy"], use: "dispense" },
  { id: "m10", name: "Chyavanaprasham 500g", form: "lehyam", unit: "jar", stock: 15, reorder: 10, price: 55, cost: 30.25, batch: "CP2509", exp: daysFromToday(300), sugar: true, use: "dispense" },
  { id: "m11", name: "Yogaraja Guggulu (100 tabs)", form: "gulika", unit: "bottle", stock: 8, reorder: 10, price: 36, cost: 19.8, batch: "YG2506", exp: daysFromToday(200), use: "dispense" },
  { id: "m12", name: "Kottamchukkadi Thailam 200ml", form: "thailam", unit: "bottle", stock: 11, reorder: 8, price: 34, cost: 18.7, batch: "KT2507", exp: daysFromToday(360), base: "sesame", use: "therapy" },
]

export const FORMS = {
  thailam: { en: "Medicated oil (thailam)", ms: "Minyak ubat (thailam)" },
  kashayam: { en: "Decoction (kashayam)", ms: "Rebusan (kashayam)" },
  arishtam: { en: "Fermented tonic (arishtam)", ms: "Tonik (arishtam)" },
  choornam: { en: "Herbal powder (choornam)", ms: "Serbuk herba (choornam)" },
  lehyam: { en: "Herbal jam (lehyam)", ms: "Jem herba (lehyam)" },
  gulika: { en: "Tablets (gulika)", ms: "Tablet (gulika)" },
  other: { en: "Other", ms: "Lain-lain" },
}
