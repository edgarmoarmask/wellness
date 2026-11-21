import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "@data": path.resolve(import.meta.dirname, "data") } },
  server: { proxy: { "/api": "http://localhost:8080" } },
})
