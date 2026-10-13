# ASiRi panel (Next.js web panel) + prebuilt Aether binary.
# Build context: repository root.
FROM node:22-bookworm-slim

ARG TARGETARCH
# Pinned upstream release (never :latest). Override with --build-arg AETHER_VERSION=vX.Y.Z
ARG AETHER_VERSION=v1.5.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates tar gzip unzip && \
    rm -rf /var/lib/apt/lists/*

# Download the official static (musl) release and verify its checksum.
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) A=x86_64 ;; \
      arm64) A=aarch64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/CluvexStudio/Aether/releases/download/${AETHER_VERSION}"; \
    f="aether-linux-${A}-musl.tar.gz"; \
    curl -fsSL "$base/$f" -o "/tmp/$f"; \
    curl -fsSL "$base/$f.sha256" -o "/tmp/$f.sha256"; \
    exp="$(cut -d' ' -f1 "/tmp/$f.sha256" | tr 'A-Z' 'a-z')"; \
    echo "$exp  /tmp/$f" | sha256sum -c -; \
    mkdir -p /opt/aether; \
    tar -xzf "/tmp/$f" -C /opt/aether; \
    chmod +x /opt/aether/aether; \
    rm -f /tmp/aether-linux-*

# The in-panel installer reuses the same pinned release.
ENV AETHER_VERSION=${AETHER_VERSION}
ENV AETHER_BIN=/opt/aether/aether

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile

COPY web ./web
RUN pnpm --filter asiri-panel-web build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

# server.mjs = next start + WebSocket upgrade hook for the VLESS/Trojan inbound.
CMD ["sh", "-c", "pnpm --filter asiri-panel-web start"]
