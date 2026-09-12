# Build from the reviewed KOTA source root using the adjacent Dockerfile.dockerignore.
# No host dependencies, homes, credentials or build tarballs enter this context.
FROM node:24.13.0-bookworm-slim AS runtime
ARG CODEX_VERSION
RUN node -e 'if (!/^\d+\.\d+\.\d+$/.test(process.argv[1])) process.exit(1)' "$CODEX_VERSION"
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git procps bubblewrap util-linux python3 make g++ ruby libsecret-1-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kota
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Corepack bootstraps the build only. Runtime commands resolve the installed
# package directly, independently of the candidate's fresh COREPACK_HOME.
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate && \
    mkdir -p /usr/local/lib/kota-pnpm && cp pnpm-workspace.yaml /usr/local/lib/kota-pnpm/ && \
    cd /usr/local/lib/kota-pnpm && pnpm add --save-exact pnpm@10.32.1 && \
    ln -sf /usr/local/lib/kota-pnpm/node_modules/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm && \
    ln -sf /usr/local/lib/kota-pnpm/node_modules/pnpm/bin/pnpx.cjs /usr/local/bin/pnpx
RUN pnpm install --frozen-lockfile
COPY bin ./bin
COPY src ./src
COPY scripts ./scripts
COPY schema ./schema
COPY clients ./clients
COPY tsconfig.json tsconfig.build.json ./
RUN pnpm build
# Pinned vendor package installation; pnpm obtains its platform package with
# registry integrity verification. Keep its dependencies independent of KOTA.
RUN mkdir -p /usr/local/lib/kota-codex && cp /opt/kota/pnpm-workspace.yaml /usr/local/lib/kota-codex/ && cd /usr/local/lib/kota-codex && \
    pnpm add --save-exact "@openai/codex@$CODEX_VERSION" && \
    ln -s /usr/local/lib/kota-codex/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex && codex --version
COPY deploy/contained-evaluation/verify-native-toolchain.mjs ./deploy/contained-evaluation/verify-native-toolchain.mjs
RUN chmod -R a+rX /opt/kota /usr/local/lib/kota-codex /usr/local/lib/kota-pnpm
# Exercise installed entrypoints as the isolated user, with no network and no
# build-user cache. The canary's visible pre-run test must pass offline.
RUN --network=none setpriv --reuid=1000 --regid=1000 --clear-groups \
    env -i PATH=/usr/local/bin:/usr/bin:/bin COREPACK_ENABLE_NETWORK=0 \
    sh -ec 'for runtime_home in /tmp "$(mktemp -d)"; do \
      export HOME="$runtime_home" COREPACK_HOME="$(mktemp -d)" XDG_CACHE_HOME="$(mktemp -d)" PNPM_HOME="$(mktemp -d)"; \
      node /opt/kota/deploy/contained-evaluation/verify-native-toolchain.mjs --check-grants; \
      test "$(pnpm --version)" = "10.32.1"; codex --version; \
      cd /opt/kota/src/modules/eval-harness/fixtures/builder-algorithmic-resource-budget-canary/initial; \
      pnpm test; \
    done'
ENV NODE_USE_ENV_PROXY=1
CMD ["node", "/opt/kota/bin/kota.mjs", "--help"]

# AGY is a separate image: acquisition works independently of subscription auth.
# Pins come from the selected official platform manifest, never a macOS binary.
FROM runtime AS agy
ARG AGY_LINUX_URL
ARG AGY_LINUX_SHA512
COPY deploy/contained-evaluation/install-agy.py /tmp/install-agy.py
RUN python3 /tmp/install-agy.py "$AGY_LINUX_URL" "$AGY_LINUX_SHA512" && agy --version

FROM debian:bookworm-slim AS proxy
RUN apt-get update && apt-get install -y --no-install-recommends squid ca-certificates \
    && rm -rf /var/lib/apt/lists/*
USER proxy
CMD ["squid", "-N", "-f", "/etc/squid/squid.conf"]
