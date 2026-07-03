# Single-process deployable: builds all workspaces, then runs the game server,
# which serves the built web app AND the WebSocket endpoint on one port.
# Host-agnostic — works anywhere that runs a container (Fly, Render, Railway,
# Cloud Run, a VPS). The host sets $PORT; we default to 8080.

# ---- build stage ----
FROM node:22-slim AS build
WORKDIR /app

# Install with dev deps so we can build. The web package's postinstall stages
# the Stockfish WASM engine from node_modules into packages/web/public/engine.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/web/package.json packages/web/package.json
COPY packages/server/package.json packages/server/package.json
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies for a leaner runtime image (keeps tsx + ws + workspaces).
RUN npm prune --omit=dev

# ---- run stage ----
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
# PORT is provided by the host at runtime; 8080 is the local default.
ENV PORT=8080

# Copy the pruned install and the built artifacts (incl. packages/web/dist,
# which contains the Stockfish engine staged at build time).
COPY --from=build /app /app

EXPOSE 8080
CMD ["npm", "run", "start"]
