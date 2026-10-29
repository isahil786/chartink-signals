FROM node:20-alpine AS base

WORKDIR /app

FROM base AS deps
COPY chartink-scraper/package*.json ./
ENV NODE_ENV=production
RUN npm ci --omit=dev

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY chartink-scraper/. ./chartink-scraper/
WORKDIR /app/chartink-scraper

USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
