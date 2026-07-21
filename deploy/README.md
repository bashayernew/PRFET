# Herot — one-VPS deploy (all features)

Runs the whole app on a single server: web + API + real-time (WebSocket) + Postgres +
calls (coturn/TURN) + meetings (LiveKit) + auto-HTTPS (Caddy).

## 0. Provision
- A VPS (Hetzner 4–8 GB recommended) running Ubuntu, with Docker + Docker Compose installed.
- A domain. Point two A-records at the server IP: `your-domain.com` and `livekit.your-domain.com`.
- Open firewall ports: 80, 443 (web), 3478 + 49160-49200/udp (TURN), 7880-7881 + 50000-60000/udp (LiveKit).

## 1. Configure
```
cd deploy
cp .env.example .env
# edit .env: set DOMAIN, DB password, JWT secrets, TURN_SECRET, LiveKit keys, VAPID keys
```
- Generate secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- Generate VAPID: `npx web-push generate-vapid-keys`
- Put the LiveKit secret into BOTH `.env` (LIVEKIT_API_SECRET) and `livekit.yaml` (the `herotkey:` value).

## 2. Launch
```
docker compose up -d --build
```
This builds the app image (Dockerfile in the repo root), starts everything, and the app auto-runs
`prisma db push` + seed on boot. Caddy issues TLS certificates automatically.

## 3. Point the app at itself
The app serves at `https://your-domain.com`. Test in a browser + on phones (OTP `1234`).

## 4. What each service powers
- **app** — the site, API, and Socket.IO real-time (chat delivery, presence, live notifications).
- **db** — PostgreSQL.
- **coturn** — relays 1:1 call audio across mobile networks (the app fetches creds from `/api/turn`).
- **livekit** — group meeting audio (the app mints tokens at `/api/meetings/[id]/token`).
- **caddy** — HTTPS + reverse proxy.

## 5. Notes
- Without TURN/LiveKit/VAPID env set, those features simply stay off; everything else still works.
- For real production: switch the app's boot command from `prisma db push` to `prisma migrate deploy`,
  set up backups (pg_dump), and add monitoring.
- OTP + payments remain the deliberate "last" items (dev code `1234` / fake gateways) until you wire them.
