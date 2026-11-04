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
COPY backend/infra/freshclam.conf /app/freshclam.conf
ENV SERVICE_ROLE=worker OMP_THREAD_LIMIT=1
USER node

FROM eclipse-temurin:21-jre-jammy@sha256:1eac8b8fee11ca7d6725a48bc5d41992ed1561504ebae25490d2d062847e8269 AS java
FROM dependencies AS emulators
USER root
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:$PATH FIREBASE_CLI_DISABLE_UPDATE_CHECK=1
RUN mkdir -p /data /home/node/.cache/firebase/emulators && chown -R node:node /data /home/node/.cache
COPY backend/infra/firestore.rules backend/infra/storage.rules backend/infra/
COPY backend/infra/firebase.docker.json ./firebase.json
COPY backend/infra/emulator-health.mjs ./emulator-health.mjs
COPY backend/infra/start-emulators.sh ./start-emulators.sh
USER node
RUN node_modules/.bin/firebase setup:emulators:firestore && node_modules/.bin/firebase setup:emulators:storage
EXPOSE 9099 8080 9199
HEALTHCHECK --interval=5s --timeout=5s --start-period=30s CMD ["node", "/app/emulator-health.mjs"]
WORKDIR /data
CMD ["sh", "/app/start-emulators.sh"]
