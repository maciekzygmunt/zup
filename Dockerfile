# Build the dashboard, the CLI and a single-file server bundle.
FROM oven/bun:1.4.4 AS build
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @zup/web build \
  && bun run --filter @zup/cli build \
  && bun build apps/server/src/index.ts --target bun --outfile dist/server.js

# The runtime needs no node_modules: server.js contains every dependency.
FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    MIGRATIONS_DIR=/app/drizzle \
    WEB_DIST=/app/web \
    CLI_DIST=/app/cli/zup.mjs
COPY --from=build /src/dist/server.js ./server.js
COPY --from=build /src/apps/server/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./web
COPY --from=build /src/packages/cli/dist/zup.mjs ./cli/zup.mjs
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["bun", "-e", "fetch('http://localhost:3000/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server.js"]
