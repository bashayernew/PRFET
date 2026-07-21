# Herot — Get it to a tester (two paths)

Testers can log in right away: the OTP is `1234` (dev code). No SMS/email needed yet.

---

## Path A — Instant share (5 min, temporary) — best for "just look at this"

Runs on **your computer**, exposed to the internet through a tunnel. Your PC must stay on.

1. Start the database and app locally:
   ```
   docker compose up -d          # Postgres on :5433
   npm install
   npm run db:push
   npm run db:seed
   npm run dev                    # app on http://localhost:3000
   ```
2. In a second terminal, open a public URL with a tunnel (pick one):
   - **Cloudflare (no signup):**
     ```
     npx cloudflared tunnel --url http://localhost:3000
     ```
   - **ngrok (free account):**
     ```
     npx ngrok http 3000
     ```
3. Copy the `https://…` URL it prints and send it to your tester. They open it on their phone,
   sign up / log in, and use **OTP `1234`**.

Trade-offs: link dies when you close the tunnel; only works while your machine is on; fine for a
quick demo, not for many testers over days.

---

## Path B — Hosted test URL (~30 min, always-on) — best for real testing

A proper URL that stays up. This stack needs a **Node server + Postgres + a persistent disk for
uploads**, so use **Railway** or **Render** (NOT Vercel — its serverless filesystem loses uploaded
images/videos/voice notes). A `Dockerfile` is included and ready.

### Railway (recommended)
1. Push this project to a GitHub repo.
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo** → pick the repo.
   Railway detects the `Dockerfile` and builds it.
3. In the project: **New → Database → PostgreSQL**. Railway creates `DATABASE_URL`.
4. On the app service → **Variables**, set:
   - `DATABASE_URL` → reference the Postgres one Railway made (or paste its connection string)
   - `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` → long random strings. Generate with:
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `NODE_ENV=production`
5. Add a **Volume** mounted at `/app/public/uploads` so uploaded media survives restarts.
6. Deploy. The container auto-runs `prisma db push` + seed on boot. Open the generated
   `https://…up.railway.app` URL and send it to testers (OTP `1234`).

### Render (alternative)
- **New → Web Service** from the repo (Docker). Add a **PostgreSQL** instance and a **Disk**
  mounted at `/app/public/uploads`. Set the same env vars. Deploy.

---

## Notes for the hosted path
- **OTP stays `1234`** until you wire real email/SMS — perfect for testers, do NOT ship to the
  public store like this.
- Because `NODE_ENV=production`, newly submitted **ads stay "pending"** (they auto-activate only in
  dev). Flip a test ad to `active` in the DB, or lower that gate, if you want ads visible during testing.
- For a real launch later, switch `prisma db push` → `prisma migrate deploy`, add a real domain +
  TLS, and follow `docs/DEPLOYMENT.md` for the infra pieces (live voice, push, object storage, mobile apps).
