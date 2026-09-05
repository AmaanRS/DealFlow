FROM node:24-alpine AS dependencies

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY night_sky/package.json ./night_sky/package.json
COPY observability/package.json ./observability/package.json
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app /app
COPY --chown=node:node observability/*.js observability/package.json ./observability/
COPY --chown=node:node night_sky/app.js night_sky/convict.js night_sky/models.js night_sky/package.json ./night_sky/
COPY --chown=node:node night_sky/controllers ./night_sky/controllers
COPY --chown=node:node night_sky/routes ./night_sky/routes

USER node
WORKDIR /app/night_sky
EXPOSE 3001

CMD ["node", "--env-file-if-exists=.env", "--import", "@app/observability/register", "app.js"]
