# syntax=docker/dockerfile:1.7
#
# KOTA Telegram personal assistant — production container.
#
# Stage 1: build KOTA from source using pnpm.
# Stage 2: copy the compiled dist/ and runtime node_modules into a small base,
#          then run `kota daemon` under a non-root user.
#
# Required runtime env (see .env.example):
#   ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT_ID
# Optional runtime env:
#   OPENAI_API_KEY — enables a Whisper transcription provider.
#
# The daemon hosts both telegram channels, the scheduler, and all workflows
# in one process. There is no second supervised bot process.

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS builder
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
COPY tsconfig.json biome.json ./
COPY bin ./bin
COPY src ./src
COPY schema ./schema
RUN pnpm run build \
    && pnpm prune --prod \
    && pnpm store prune

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    KOTA_PROJECT_DIR=/var/lib/kota \
    KOTA_STATE_DIR=/var/lib/kota/.kota
WORKDIR /opt/kota

RUN groupadd --system --gid 1001 kota \
    && useradd --system --uid 1001 --gid kota --home-dir /var/lib/kota --shell /usr/sbin/nologin kota \
    && mkdir -p /var/lib/kota/.kota /var/lib/kota/data \
    && chown -R kota:kota /var/lib/kota

COPY --from=builder /src/package.json ./package.json
COPY --from=builder /src/bin ./bin
COPY --from=builder /src/dist ./dist
COPY --from=builder /src/node_modules ./node_modules

USER kota
WORKDIR /var/lib/kota
VOLUME ["/var/lib/kota"]

# The daemon owns its own supervision/restart loop (RESTART_EXIT_CODE).
# Docker's restart policy supervises the outer process.
ENTRYPOINT ["node", "/opt/kota/bin/kota.mjs"]
CMD ["daemon", "--project-dir", "/var/lib/kota"]
