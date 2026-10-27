FROM node:20-alpine AS base

WORKDIR /app

FROM base AS deps
COPY chartink-scraper/package*.json ./
ENV NODE_ENV=production
RUN npm ci --omit=dev

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY chartink-scraper/. ./chartink-scraper/

RUN mkdir -p \
      /app/chartink-scraper/state/raw_chartink \
      /app/chartink-scraper/state/daily_results \
      /app/chartink-scraper/state/momentum-backtest \
      /app/chartink-scraper/processed/screeners \
      /app/chartink-scraper/processed/backtests \
    && chown -R node:node /app/chartink-scraper

WORKDIR /app/chartink-scraper

USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
