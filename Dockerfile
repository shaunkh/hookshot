# Ostium Webhook Trader - production image (Fresh 2.x official `deno serve` path).
#
# Build:  docker build --build-arg GIT_REVISION=$(git rev-parse HEAD) -t ostium-webhook-trader .
# Run:    docker run --env-file .env -p 8000:8000 -v owt-data:/data ostium-webhook-trader
#
# Secrets (DELEGATE_PRIVATE_KEY, SESSION_SECRET, SECRET_ENC_KEY, …) are NEVER baked
# in - the build only runs Vite. Pass them at runtime via --env-file / -e.
ARG DENO_VERSION=2.8.2
FROM denoland/deno:${DENO_VERSION}

# Fresh uses this to bust caches when the deployment changes.
ARG GIT_REVISION=dev
ENV DENO_DEPLOYMENT_ID=${GIT_REVISION}

WORKDIR /app

# Install deps first for better layer caching (only re-runs when these change).
COPY deno.json deno.lock ./
RUN deno install --allow-scripts

# Build the app (Vite → _fresh/). No secrets/network-to-RPC needed here.
COPY . .
RUN deno task build

# SQLite lives on a volume so data survives container restarts.
ENV DB_PATH=/data/app.db
RUN mkdir -p /data && chown deno:deno /data
VOLUME ["/data"]

USER deno
EXPOSE 8000
CMD ["deno", "serve", "-A", "--port", "8000", "_fresh/server.js"]
