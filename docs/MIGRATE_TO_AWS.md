# PRFET — Migrate from the current VPS to AWS (keep prfet.com)

Goal: move the whole stack (app + Postgres + Caddy + coturn + LiveKit) to a new AWS EC2
server, carry the **database + uploaded media** across, keep the domain **prfet.com**, then
retire the old server.

Your stack (from `deploy/docker-compose.yml`): services `app`, `db` (postgres:16, user/db
`herot`), `caddy` (TLS), `coturn`, `livekit`. Data lives in two Docker volumes: **`pgdata`**
and **`uploads`**. Nothing about the code changes — same domain means the baked
`NEXT_PUBLIC_*` values stay valid.

There will be a short downtime window (roughly 15–30 min) while we freeze the old server,
copy data, and switch DNS. Do it at a quiet hour.

---

## Phase 0 — Before the window (no downtime)

**0.1 Lower DNS TTL** (so the cutover is fast). In your DNS provider, set the TTL on the
`prfet.com` and `livekit.prfet.com` records to **300 seconds**. Do this a few hours ahead.

**0.2 Launch the AWS server.**
- EC2 → Launch instance → **Ubuntu Server 24.04 LTS**.
- Size: **t3.medium** (2 vCPU / 4 GB) minimum — the app + Postgres + LiveKit together need
  headroom. Storage: **40 GB gp3**.
- Allocate an **Elastic IP** and associate it with the instance (this is the stable IP you'll
  point DNS at). Call it `NEW_IP` below.

**0.3 Open the ports** (EC2 → Security Group → inbound rules). These exact ports matter —
missing the UDP ranges silently breaks calls and rooms:

| Type | Protocol | Port range | Source | Why |
|------|----------|------------|--------|-----|
| SSH | TCP | 22 | your IP only | admin |
| HTTP | TCP | 80 | 0.0.0.0/0 | Caddy / cert issue |
| HTTPS | TCP | 443 | 0.0.0.0/0 | app + LiveKit signaling |
| Custom TCP | TCP | 7881 | 0.0.0.0/0 | LiveKit RTC (TCP fallback) |
| Custom UDP | UDP | 3478 | 0.0.0.0/0 | coturn (TURN) |
| Custom UDP | UDP | 49160–49200 | 0.0.0.0/0 | coturn relay |
| Custom UDP | UDP | 50000–60000 | 0.0.0.0/0 | LiveKit media |

**0.4 Install Docker on the new server** (SSH in as `ubuntu@NEW_IP`):
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu          # then log out/in once
```

**0.5 Put the app on the new server.** Easiest is to copy your whole project folder up, or
`git clone` it if it's in a repo. You need the repo (for `Dockerfile`/build) plus the
`deploy/` folder. From your PowerShell:
```powershell
scp -r D:\app ubuntu@NEW_IP:/home/ubuntu/app
```

**0.6 Copy the env/secrets — do NOT regenerate them.** The new server must use the **same**
`deploy/.env` as the old one (same JWT secrets, DB password, TURN/LiveKit secrets), or logins
break and tokens stop validating. Copy your existing `deploy/.env` (or `~/env-backup`) from the
old server to `/home/ubuntu/app/deploy/.env` on the new one. Domain stays `prfet.com`.

---

## Phase 1 — Freeze + dump the old server (start of window)

SSH into the **OLD** server, go to the `deploy/` folder (where `docker-compose.yml` lives).

**1.1 Confirm the real volume names** (compose prefixes them with the folder name, usually
`deploy_`):
```bash
docker volume ls | grep -E "pgdata|uploads"
```

**1.2 Stop the app so no new data is written** (leave `db` running for the dump):
```bash
docker compose stop app
```

**1.3 Dump the database:**
```bash
docker compose exec -T db pg_dump -U herot -d herot > /home/ubuntu/herot.sql
```

**1.4 Pack the uploaded media** (adjust the volume name if step 1.1 showed different):
```bash
docker run --rm -v deploy_uploads:/v -v /home/ubuntu:/b alpine \
  tar czf /b/uploads.tgz -C /v .
```

**1.5 Copy both files to the new server:**
```bash
scp /home/ubuntu/herot.sql /home/ubuntu/uploads.tgz ubuntu@NEW_IP:/home/ubuntu/
```

---

## Phase 2 — Restore on the new server

SSH into the **NEW** server, `cd /home/ubuntu/app/deploy`.

**2.1 Start only the database first:**
```bash
docker compose up -d db
sleep 10
```

**2.2 Restore the database:**
```bash
cat /home/ubuntu/herot.sql | docker compose exec -T db psql -U herot -d herot
```

**2.3 Restore the uploaded media into the new `uploads` volume:**
```bash
docker compose run --rm -v /home/ubuntu/uploads.tgz:/uploads.tgz app \
  sh -c "tar xzf /uploads.tgz -C /app/public/uploads"
```
(If that image path errors, instead: `docker volume create deploy_uploads` then
`docker run --rm -v deploy_uploads:/v -v /home/ubuntu:/b alpine tar xzf /b/uploads.tgz -C /v`.)

**2.4 Build and start everything:**
```bash
docker compose up -d --build
```

**2.5 Apply any DB migrations (safe if already applied):**
```bash
docker compose exec app npx prisma migrate deploy
```

**2.6 Quick local check (before DNS):**
```bash
curl -I http://localhost:3000        # expect a 200/redirect from the app
docker compose ps                    # all services "Up"
```

---

## Phase 3 — Cut over DNS

In your DNS provider, change the **A records** to the new Elastic IP:
- `prfet.com` → `NEW_IP`
- `livekit.prfet.com` → `NEW_IP`
- (`www.prfet.com` too, if you use it)

Caddy on the new server will automatically fetch fresh Let's Encrypt certificates within a
minute or two (ports 80/443 must be open — they are, from Phase 0).

Watch propagation, then verify on the real domain:
- `https://prfet.com` loads and you can **log in** (proves DB + JWT secrets migrated right).
- Open a **live room** with two accounts (proves LiveKit + UDP ports).
- Make a **1:1 call** (proves coturn).
- Open a post with an **image/video** (proves uploads migrated).

---

## Phase 4 — Retire the old server

Only after the new one has run clean for a day:

**4.1 Take one final backup** from the new server (keep it somewhere safe):
```bash
docker compose exec -T db pg_dump -U herot -d herot > ~/herot-postmigrate.sql
```

**4.2 Destroy the old VPS** in the old provider's dashboard (terminate the server). Cancel any
billing. Remove the old IP from anywhere it's hard-coded (there shouldn't be any — you kept the
domain).

---

## Notes / gotchas
- **Keep the same secrets.** Re-generating `JWT_*` logs everyone out; re-generating `TURN_SECRET`
  / `LIVEKIT_API_SECRET` breaks calls until the app and servers match again.
- **UDP ports are the #1 cause of "rooms/calls don't work."** If a room connects but has no
  audio/video, re-check the 3478 / 49160–49200 / 50000–60000 UDP rules in the Security Group.
- **Elastic IP**, not the default public IP — the default changes on stop/start and would break
  DNS.
- **Postgres version match:** both old and new use `postgres:16-alpine`, so the dump/restore is
  clean. Don't bump the image version during the move.
- If you later outgrow one box, the natural AWS split is **RDS for Postgres** + **S3 for uploads**
  (the deploy doc already notes the S3 swap point in `app/api/upload/route.ts`).
