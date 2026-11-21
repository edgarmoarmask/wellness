// English-only UI (client request). Components call x(en, ms) / t({en, ms}); only the English text is ever shown.
import { createContext, useContext, useEffect } from "react"
const Ctx = createContext(null)
const VALUE = {
  lang: "en",
  setLang: () => {},
  x: (en) => en,
  t: (o) => (o == null ? "" : typeof o === "string" ? o : o.en),
  day: (d) => new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short" }),
  date: (d) => new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }),
}
export function LangProvider({ children }) {
  useEffect(() => { document.documentElement.lang = "en" }, [])
  return <Ctx.Provider value={VALUE}>{children}</Ctx.Provider>
}
export const useLang = () => useContext(Ctx)
