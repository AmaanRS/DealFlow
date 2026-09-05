FROM node:24-alpine AS dependencies

ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
COPY emails/package.json ./emails/package.json
COPY observability/package.json ./observability/package.json
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=dependencies /app /app
COPY --chown=node:node observability ./observability
COPY --chown=node:node emails ./emails

USER node
WORKDIR /app/emails

CMD ["node", "--import", "@app/observability/register", "emailing.js"]
