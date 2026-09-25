FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM base AS runner
WORKDIR /app
ARG TARGETARCH
ENV NODE_ENV=production
ENV YOUTARR_FEED_DATA_DIR=/data
ENV LIBVA_DRIVER_NAME=iHD
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    intel-media-va-driver \
    libva-drm2 \
    libva2 \
    vainfo \
  && TARGETARCH="${TARGETARCH:-amd64}" \
  && case "$TARGETARCH" in \
    amd64) YT_DLP_ASSET="yt-dlp_linux" ;; \
    arm64) YT_DLP_ASSET="yt-dlp_linux_aarch64" ;; \
    arm) YT_DLP_ASSET="yt-dlp_linux_armv7l" ;; \
    *) echo "Unsupported architecture for yt-dlp: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && curl --fail --location --retry 3 \
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YT_DLP_ASSET}" \
    --output /usr/local/bin/yt-dlp \
  && chmod 0755 /usr/local/bin/yt-dlp \
  && yt-dlp --version \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.openai ./.openai
VOLUME ["/data"]
EXPOSE 3000
CMD ["pnpm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
