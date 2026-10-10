import { createServer } from "./app.ts"
import { loadConfig } from "./config.ts"

const config = loadConfig(process.env)
const server = await createServer(config)

Bun.serve({
  port: config.PORT,
  // Blob uploads stream one file per request.
  maxRequestBodySize: config.MAX_FILE_BYTES + 1024 * 1024,
  idleTimeout: 255,
  fetch: (request, bun) => server.fetch(request, bun.requestIP(request)?.address),
})

setInterval(server.cleanup, 60 * 60 * 1000).unref()
setTimeout(server.cleanup, 10_000).unref()

console.log(`zup listening on :${config.PORT}`)
console.log(`  dashboard: ${config.appOrigin}`)
console.log(`  sites:     ${config.previewOrigin}`)
