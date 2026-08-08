ARG APP_GIT_COMMIT=unknown
ARG APP_IMAGE_VERSION=local

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json eslint.config.mjs ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ARG APP_GIT_COMMIT
ARG APP_IMAGE_VERSION
WORKDIR /app
ENV NODE_ENV=production
ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=4173
ENV TRADING_MODE=PAPER
ENV APP_GIT_COMMIT=${APP_GIT_COMMIT}
ENV APP_IMAGE_VERSION=${APP_IMAGE_VERSION}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web ./web

EXPOSE 4173
VOLUME ["/app/data"]
CMD ["node", "dist/tools/startTradingPlatform.js"]
