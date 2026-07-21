# Herot — production/test container (Node server + Prisma + Postgres).
FROM node:20-slim AS base
WORKDIR /app
# Prisma needs openssl at runtime
RUN apt-get update -y && apt-get install -y openssl ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*

# Install deps (cached) — skip postinstall here; `npm run build` runs prisma generate after COPY
COPY package*.json ./
RUN npm ci --ignore-scripts

# Build
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# On boot: apply the schema, then start. (No demo accounts are seeded.)
# (For real production, swap `prisma db push` for `prisma migrate deploy`.)
CMD ["sh", "-lc", "npx prisma db push --skip-generate || true; npm run start"]
