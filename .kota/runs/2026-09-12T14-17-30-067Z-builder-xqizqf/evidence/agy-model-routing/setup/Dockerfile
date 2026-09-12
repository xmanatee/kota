# Prepared image recipe; not built or validated on Linux in this invocation.
FROM node:24-bookworm-slim AS dependencies
WORKDIR /opt/kota
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim
WORKDIR /opt/kota
RUN apt-get update && apt-get install -y --no-install-recommends git bubblewrap util-linux procps ripgrep ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY --from=dependencies /opt/kota/node_modules ./node_modules
COPY package.json ./package.json
COPY bin ./bin
COPY dist ./dist
# Supply the vendor's Linux binary for the build platform, not the host Mach-O.
# Record vendor provenance and the checksum before building. No credentials here.
ARG AGY_SHA256
COPY agy-linux /usr/local/bin/agy
RUN test -n "$AGY_SHA256" && echo "$AGY_SHA256  /usr/local/bin/agy" | sha256sum -c - && chmod 0755 /usr/local/bin/agy && agy --version
RUN node --version && pnpm --version && bwrap --version && node -e "require('better-sqlite3')(':memory:').close()"
# Commands, mounts, resource limits and network selection belong to the eval runner.
ENTRYPOINT []
CMD ["node", "/opt/kota/bin/kota.mjs"]

