# Running PRFET locally on macOS

Verified 2026-08-23 against commit `4cb110f`. Every command below was exercised end to end
(install → DB → build → server → register → login) before being written down.

The old `Cursor_Prompt_Run_Local.md` is Windows-specific and slightly stale — it says the OTP
is always `1234`, which is no longer true. `lib/auth.ts` now generates a real random 4-digit
code with `crypto.randomInt`. Use this document instead.

---

## 1. Prerequisites

| Tool | Needed for | Check | Install |
|---|---|---|---|
| Node.js 20 or 22 LTS | the app | `node -v` | `brew install node@22` |
| Docker Desktop | local Postgres | `docker -v` | https://docker.com/products/docker-desktop |
| Xcode 15+ | iOS build (later) | `xcodebuild -version` | Mac App Store |
| CocoaPods | Capacitor iOS | `pod --version` | `sudo gem install cocoapods` |

Verified on Node 22.22.2 / npm 10.9.7. Node 18 is end-of-life — do not use it.

If you use `nvm`, pin the version so future sessions match:

```bash
cd ~/Desktop/prfet
node -v > .nvmrc      # optional but recommended
```

---

## 2. Environment file

`.env` is gitignored and is therefore **not** in the clone. Two files were added to the repo:

- `.env.example` — the full template, every variable the codebase reads, grouped and commented. Commit this.
- `local-env-copy-to-dotenv.txt` — a ready-to-use local dev config with freshly generated JWT secrets. Gitignored.

```bash
cd ~/Desktop/prfet
cp local-env-copy-to-dotenv.txt .env
rm local-env-copy-to-dotenv.txt      # secrets now live only in .env
```

`.env` alone is enough to boot the app. Email, push, LiveKit, and Gemini keys are optional —
without them those specific features are inert, but nothing crashes.

---

## 3. Start the database

```bash
cd ~/Desktop/prfet
docker compose up -d          # Postgres 16 on port 5433
docker compose ps             # should show herot-db as running
```

Port 5433 is deliberate so it does not collide with a system Postgres on 5432. If 5433 is
already taken, change the host side of the mapping in `docker-compose.yml` **and** the port in
`DATABASE_URL` — keep them in sync.

---

## 4. Install and set up

```bash
npm install                   # postinstall runs `prisma generate` automatically
npm run db:push               # creates all 32 tables
npm run db:seed               # prints "nothing to do — no demo accounts" on a fresh DB; that is fine
```

---

## 5. Run

```bash
npm run dev                   # = node server.js (custom server, Socket.IO). NOT `next dev`.
open http://localhost:3000
```

`npm run dev:next` exists but starts plain `next dev` **without** the Socket.IO server, so
messaging and realtime will not work. Use `npm run dev`.

---

## 6. Register a test account without email set up

Registration succeeds without SMTP, but the verification code is never delivered. Read it
straight from the database:

```bash
docker compose exec db psql -U herot -d herot \
  -c 'select "userId", purpose, "expiresAt" from "OtpCode" order by "expiresAt" desc limit 5;'
```

The code itself is stored hashed, so it cannot be read back. To actually complete verification
locally, either configure `RESEND_API_KEY` / `SMTP_*` in `.env`, or temporarily log the code in
the route that creates it.

---

## 7. Health checks

```bash
npx tsc --noEmit              # must be silent — 0 errors as of 4cb110f
npx next build                # must end with the route table and no error
```

Note that `next.config.ts` sets `typescript.ignoreBuildErrors: true` and
`eslint.ignoreDuringBuilds: true`, so **`next build` will happily succeed on broken types**.
Run `npx tsc --noEmit` separately — it is the only thing actually checking types.

---

## 8. Known gaps found during verification

- **ESLint is not configured.** `npx next lint` drops into an interactive first-run setup wizard
  rather than linting, which means lint has never run on this codebase. Run it once, pick
  "Strict", and commit the generated config.
- **Next.js 15.1.0 has published CVEs**, including a critical Server Actions DoS and a dev-server
  information exposure. Upgrading to `15.5.23` was tested against this exact commit: typecheck
  clean, build clean, and register + login verified working. It is a patch-level bump inside 15.x.
  ```bash
  npm install next@15.5.23
  ```
- Remaining `npm audit` findings after that bump (`tar` via `@capacitor/cli`, `sharp`/`postcss`
  via `next`) are **build-time only** — they are not shipped to end users. Clearing them requires
  major-version bumps of Capacitor and Next, which is a separate, riskier piece of work.

---

## 9. Before going public — security items

These were found by reading the code and are worth fixing before the App Store push. The repo is
public on GitHub, which is what makes the first two matter.

1. **`lib/auth.ts` falls back to hardcoded JWT secrets.** If `JWT_ACCESS_SECRET` /
   `JWT_REFRESH_SECRET` are ever unset, it silently uses `"dev-access-secret-change-me"` — a
   string anyone can read in the public repo. Anyone could then forge a valid token for any
   account, including an admin. Make it throw on startup in production instead of falling back.
2. **`app/api/admin/gate/route.ts` ships a break-glass admin login** with the owner's personal
   email and a bcrypt hash committed in plaintext, plus a `STARTER_PASSWORD = "admin123"` that is
   accepted until a dashboard password is set. The route does require an already-authenticated
   admin first, so it is not a public backdoor — but set `DASH_MASTER_DISABLED=1` before launch,
   as the code's own TODO says, and rotate anything derived from that hash.
3. **Login succeeds for unverified accounts** (`isVerified: false` still returns tokens).
   Confirm that is intentional.
