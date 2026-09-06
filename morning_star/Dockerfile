FROM node:24-alpine AS dependencies

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY morning_star/package.json ./morning_star/package.json
COPY models/package.json ./models/package.json
COPY object_storage/package.json ./object_storage/package.json
COPY observability/package.json ./observability/package.json
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app /app
COPY --chown=node:node models/*.js models/package.json ./models/
COPY --chown=node:node object_storage/*.js object_storage/package.json ./object_storage/
COPY --chown=node:node observability/*.js observability/package.json ./observability/
COPY --chown=node:node morning_star/*.js morning_star/package.json ./morning_star/
COPY --chown=node:node morning_star/controllers ./morning_star/controllers
COPY --chown=node:node morning_star/routes ./morning_star/routes
COPY --chown=node:node morning_star/services ./morning_star/services

USER node
WORKDIR /app/morning_star
EXPOSE 3002

CMD ["node", "--env-file-if-exists=.env", "--import", "@app/observability/register", "app.js"]
