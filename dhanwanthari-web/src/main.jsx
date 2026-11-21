import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"
import { LangProvider } from "@/lib/i18n"
import { StoreProvider } from "@/lib/store"

createRoot(document.getElementById("root")).render(
  <StrictMode><LangProvider><StoreProvider><App /></StoreProvider></LangProvider></StrictMode>,
)
