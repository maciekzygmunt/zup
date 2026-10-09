import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// No changeOrigin: the server picks the dashboard or preview app by Host header.
// xfwd adds X-Forwarded-For, which the server reads for session IPs and rate limits.
const target = process.env.ZUP_SERVER ?? "http://localhost:3000"
const proxy = Object.fromEntries(
  ["/api", "/.well-known", "/mcp", "/install.sh", "/cli/"].map((path) => [
    path,
    { target, xfwd: true },
  ]),
)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One bundle is fine for a single-owner dashboard (about 250 kB gzipped).
  build: { chunkSizeWarningLimit: 1000 },
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 5173, strictPort: true, proxy },
})
