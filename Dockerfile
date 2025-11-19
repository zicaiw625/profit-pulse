FROM node:20-alpine AS base
RUN apk add --no-cache openssl

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Use npm install to allow dependency tree to be regenerated when lock file entries are missing
RUN npm install

FROM deps AS builder
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/shopify.app.toml ./shopify.app.toml
COPY --from=builder /app/shopify.web.toml ./shopify.web.toml
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
