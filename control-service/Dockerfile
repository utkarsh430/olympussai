# Control service runtime image. Referenced by ../control-service/render.yaml
# (dockerfilePath: ./control-service/Dockerfile, dockerContext: ./control-service).
# Multi-stage: build with full devDependencies, ship only the compiled
# output + production node_modules in the final image.

FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

# ---------------------------------------------------------------------------
# deps: install all dependencies (incl. dev) needed to type-check and build
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: compile TypeScript -> dist/
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ---------------------------------------------------------------------------
# prod-deps: install production-only dependencies for the runtime image
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# runtime: minimal final image
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S control-service && adduser -S control-service -G control-service
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The migration runner (dist/db/migrate.js, run by render.yaml's
# preDeployCommand) reads these .sql files at runtime, so they must ship in
# the final image - they are data the compiled output resolves at ../../db/
# migrations, not something tsc bundles.
COPY db ./db

USER control-service
EXPOSE 8080

# Matches the /healthz contract in docs/CONTROL_SERVICE_DEPLOYMENT.md -
# liveness only, no DB call, so this succeeds independent of readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
