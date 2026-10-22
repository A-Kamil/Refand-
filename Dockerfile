# FreightRecover AI API — image built by Aiven Runtime from this repository.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.api.json ./
COPY src ./src
COPY api ./api
RUN npm run build:api && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY fixtures ./fixtures
USER node
EXPOSE 8080
CMD ["node", "build/api/server.js"]
