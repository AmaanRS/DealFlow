FROM node:24-alpine AS dependencies

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY api-gateway/package.json ./api-gateway/package.json
COPY models/package.json ./models/package.json
COPY observability/package.json ./observability/package.json
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app /app
COPY --chown=node:node models/*.js models/package.json ./models/
COPY --chown=node:node observability/*.js observability/package.json ./observability/
COPY --chown=node:node api-gateway/package.json ./api-gateway/package.json
COPY --chown=node:node api-gateway/src ./api-gateway/src

USER node
WORKDIR /app/api-gateway
EXPOSE 4000
CMD ["node", "--import", "@app/observability/register", "src/server.js"]
