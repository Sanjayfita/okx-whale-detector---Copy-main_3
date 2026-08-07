FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json eslint.config.mjs ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=4173
ENV TRADING_MODE=PAPER

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web ./web

EXPOSE 4173
VOLUME ["/app/data"]
CMD ["node", "dist/tools/startTradingPlatform.js"]
