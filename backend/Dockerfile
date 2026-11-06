# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY doc/contracts/package.json doc/contracts/package.json
COPY site/package.json site/package.json
COPY mobile/package.json mobile/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund --workspace @lessonbooks/backend --include-workspace-root

FROM dependencies AS build
COPY tsconfig.json ./
COPY backend/src backend/src
COPY backend/prompts backend/prompts
COPY backend/scripts/build-runtime.mjs backend/scripts/build-runtime.mjs
COPY doc/contracts doc/contracts
COPY doc/curricula doc/curricula
COPY doc/specs doc/specs
RUN node backend/scripts/build-runtime.mjs

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund --workspace @lessonbooks/backend --include-workspace-root

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 SERVICE_ROLE=api
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/doc/contracts/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist/runtime ./backend/dist/runtime
COPY --from=build /app/backend/dist/prompts ./backend/dist/prompts
COPY doc/fixtures/lessons ./backend/doc/fixtures/lessons
COPY backend/infra/healthcheck.mjs ./healthcheck.mjs
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s CMD ["node", "healthcheck.mjs"]
CMD ["node", "backend/dist/runtime/server.mjs"]

FROM api AS worker
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates poppler-utils tesseract-ocr tesseract-ocr-eng clamav clamav-freshclam \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/clamav && chown node:node /var/lib/clamav
# Overwrite the fast distribution models with the most accurate LSTM models, pinned by sha256.
COPY backend/infra/fetch-tessdata.mjs ./fetch-tessdata.mjs
RUN node fetch-tessdata.mjs /usr/share/tesseract-ocr/5/tessdata && rm fetch-tessdata.mjs
COPY backend/infra/freshclam.conf /app/freshclam.conf
ENV SERVICE_ROLE=worker OMP_THREAD_LIMIT=1
USER node
