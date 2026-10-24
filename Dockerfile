# SailZone server image (Coolify at sailzone.app, see docs/deploy-coolify.md).
# Build stage: npm ci, build:app (landing + game -> dist-app/) and
# build:server (esbuild bundle incl. ws -> dist-server/server.mjs).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Coolify / CI can pass the deploy SHA (image has no .git).
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build:app && npm run build:server

# Runtime: the bundle needs no node_modules.
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/dist-app ./dist-app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist-server/server.mjs", "--static", "dist-app"]
