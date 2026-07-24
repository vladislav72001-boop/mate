# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Prisma generate (postinstall) needs DATABASE_URL present at build time.
# Real Railway DATABASE_URL is used only at runtime.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ARG GOOGLE_CLIENT_ID=""
ARG VITE_GOOGLE_CLIENT_ID=""
ENV GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-$GOOGLE_CLIENT_ID}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
# Brand images for transactional emails (/email/*). Also present under dist/ after Vite build.
COPY --from=build /app/public ./public
EXPOSE 8080
# Import checked-in JSON tariffs/users/orders into PG (upsert) so prod matches the old JSON store.
CMD ["sh", "-c", "npx prisma migrate deploy && node server/scripts/migrate-json-to-pg.mjs && node server/index.mjs"]
