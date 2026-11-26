# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PNPM_CONFIG_MINIMUM_RELEASE_AGE=0
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm build

FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runner
ARG APP_VERSION=0.1.0
ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

LABEL org.opencontainers.image.title="Marsha" \
	org.opencontainers.image.description="AI studio for chaining generative media models and showrunner turning drama scenes into full stories." \
	org.opencontainers.image.url="https://marsha.babysea.live" \
	org.opencontainers.image.source="https://github.com/babysea-community/marsha" \
	org.opencontainers.image.version="$APP_VERSION" \
	org.opencontainers.image.revision="$VCS_REF" \
	org.opencontainers.image.created="$BUILD_DATE" \
	org.opencontainers.image.licenses="Apache-2.0"

# ffmpeg powers the video lead-in trim (VIDEO_TRIM_LEAD_IN_MS in
# lib/config/natural-video.ts) when output storage is enabled and generated
# video bytes are copied into S3/Vercel Blob.
RUN apk add --no-cache ffmpeg

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/app ./app
COPY --chown=node:node --from=build /app/components ./components
COPY --chown=node:node --from=build /app/instrumentation-client.ts ./instrumentation-client.ts
COPY --chown=node:node --from=build /app/instrumentation.ts ./instrumentation.ts
COPY --chown=node:node --from=build /app/lib ./lib
COPY --chown=node:node --from=build /app/next.config.ts ./next.config.ts
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/styles ./styles
COPY --chown=node:node --from=build /app/tsconfig.json ./tsconfig.json

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
