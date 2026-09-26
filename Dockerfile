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
#
# This used to end in `|| true`, which meant a FAILED migration still started the app.
# On 2026-09-25 a column with a unique constraint couldn't be applied unattended, push
# aborted, the app booted anyway, and every query that touched User failed — members
# appeared to lose their subscriptions, the dashboard wouldn't open, and the whole site
# crawled. `docker compose ps` said "Up" the entire time.
#
# Now the container refuses to start on a failed migration. A deploy that visibly fails is
# far cheaper than a site that is live and quietly broken.
#
# The retry loop exists because Postgres may not accept connections the instant the app
# container starts — that is a timing issue, not a bad migration, and must not be fatal.
CMD ["sh", "-lc", "\
for i in 1 2 3 4 5; do \
  npx prisma db push --skip-generate && break; \
  if [ $i = 5 ]; then \
    echo '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'; \
    echo '  MIGRATION FAILED — refusing to start.'; \
    echo '  The database does not match the schema. Starting anyway'; \
    echo '  would serve broken queries on every signed-in request.'; \
    echo '  Fix: read the prisma error above, apply the change by hand,'; \
    echo '  then: docker compose restart app'; \
    echo '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'; \
    exit 1; \
  fi; \
  echo \"db not ready, retrying ($i/5)...\"; sleep 5; \
done; \
npm run start"]
