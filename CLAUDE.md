# PRFET — Project State & Orientation

**This file is the single source of truth for the project.** Read it first in any new chat.
Keep it updated whenever infrastructure, config, or major features change.
_Last updated: 2026-08-17._

---

## What this is
PRFET is a mobile-first **social app** for a Kuwaiti client (Al Aridi). It's **18+**, bilingual
**Arabic/English** (`lib/i18n.tsx`), with a dark inverted-purple theme. Internally the codebase
is still named **"Herot"** (`herot@0.1.0`, package id `com.herot.app`) — the product/brand name
shown to users is **PRFET**. Live at **https://prfet.com**.

Features: profiles/feed, live **rooms** (LiveKit) + 1:1 **calls** (coturn/WebRTC), DMs, an **AI
assistant** (Gemini: chat, image, video, TTS), two-tier **subscriptions** (Golden $5.99 / VIP
$10.99) + add-on packs, a private **vault**, job/ad posting, and **Bluetooth (BLE) discovery**.

## Stack
- **Next.js 15** (App Router) with a **custom `server.js`** (Socket.IO for realtime).
- **Prisma + PostgreSQL** (`prisma/schema.prisma`).
- **LiveKit** (group rooms, `wss://livekit.prfet.com`), **coturn** (1:1 call TURN).
- **Gemini** REST for AI (chat/image/video/TTS).
- Uploads written to `public/uploads` (Docker volume).
- i18n in `lib/i18n.tsx`. Theme note: `.bg-white` renders **dark** (#1b1440) by design.

---

## Infrastructure (CURRENT — as of the AWS migration)

### Production server — AWS EC2
- **Elastic IP: `63.187.183.253`** · Region **Frankfurt (eu-central-1)** · Ubuntu 24.04 · **t3.micro** (1 GB RAM + **8 GB swap**) · 40 GB gp3.
- SSH from the owner's Windows PC:
  `ssh -i "$HOME\.ssh\prfet-key.pem" ubuntu@63.187.183.253`
- App lives at `~/app`; Docker Compose deploy dir is **`~/app/deploy`**.
- Stack (Docker Compose): `app`, `db` (postgres:16, user/db **`herot`**), `caddy` (auto-HTTPS),
  `coturn`, `livekit`. Volumes: **`deploy_pgdata`**, **`deploy_uploads`**.
- Deploy/rebuild: `cd ~/app/deploy && docker compose up -d --build`.

### Domain — GoDaddy DNS
- `prfet.com` **A** → `63.187.183.253`; `livekit.prfet.com` **A** → `63.187.183.253`;
  `www` CNAME → `prfet.com`. TURN uses `turn:prfet.com:3478`.

### OLD server — Hetzner (BEING RETIRED)
- `root@49.13.118.233` (password auth). Still holds the original data + the **authoritative
  production `.env`** at `/root/app/deploy/.env`. **Do not delete until AWS is fully verified.**

---

## Environment / secrets
The real secrets live in **`~/app/deploy/.env` on the server** (never commit real values).

⚠️ **Important lesson:** the LOCAL `D:\app\deploy\.env` was a **stale testing copy** missing
several production keys. When the app was migrated to AWS using that local copy, email (SMTP),
the Gemini AI key, and other keys were missing and had to be **merged from the old server's
`/root/app/deploy/.env`**. If something "works on the old site but not the new one", suspect a
**missing env key** and merge it from the old server.

Key groups in `.env`: `DOMAIN`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `TURN_SECRET` + `NEXT_PUBLIC_TURN_*`, `LIVEKIT_API_KEY/SECRET` +
`NEXT_PUBLIC_LIVEKIT_URL`, `VAPID_*`, `SMTP_*` (email OTP), `GEMINI_*` (AI), `DASH_MASTER_EMAIL`,
`SUPPORT_EMAIL`, `OTP_DEV_CODE=1234` (testing backdoor — signup code is always 1234 until real
email flow is finalized), `AD_AUTO_APPROVE`.

---

## Build & deploy gotchas (learned the hard way)
- **Small box:** t3.micro needs the **8 GB swap** to build. Next.js `next build` **must skip
  type-check + lint** or it OOMs and produces a `.next` with **no BUILD_ID** (app then crash-loops
  "Could not find a production build"). This is set in `next.config.ts`:
  `eslint.ignoreDuringBuilds: true`, `typescript.ignoreBuildErrors: true`. Keep those.
- **Postgres password:** the DB volume was initialized with `POSTGRES_PASSWORD` from `.env`.
  Changing it later does NOT change the existing DB → app can't connect. Never wholesale-swap
  `.env`; only **merge missing keys** (see the merge loop used for GEMINI/SMTP).
- **Keep `JWT_*` stable** or users get logged out.
- Data migration between servers: `pg_dump`/`psql` for the DB, `tar` the `deploy_uploads` volume.

---

## Payments
- **Web:** FastSpring (Merchant of Record). Product paths hardcoded in
  `components/fastspring-checkout.tsx`; webhook at `app/api/webhooks/fastspring/route.ts`.
  **Status: awaiting FastSpring account activation** (can't go live until approved). Enable by
  setting `NEXT_PUBLIC_FASTSPRING_STOREFRONT` + `FASTSPRING_HMAC_SECRET`.
- **Android (Google Play):** Google requires **Play Billing** for in-app subs — FastSpring is NOT
  allowed inside the app. Plan: **RevenueCat** for in-app purchases; in-app FastSpring buttons must
  be hidden. (See Google Play section.)

---

## Google Play (in progress)
- Native shell = **Capacitor 6**, `appId com.herot.app`, appName "PRFET", **loads prfet.com** in a
  WebView (so most updates ship via a normal web deploy — no new AAB needed).
- Android project: **`D:\app\android`** (open THIS in Android Studio, not the old `~/Desktop/app`).
- Toolchain: **targetSdk/compileSdk 36**, AGP **8.13.2** / Gradle **8.13** (via AGP Upgrade Assistant).
- Plugins installed: `bluetooth-le@6.1.0`, `camera@6`, `geolocation`, `push-notifications@6`,
  `privacy-screen`, `@revenuecat/purchases-capacitor@9.2.2`.
- Permissions added in `android/app/src/main/AndroidManifest.xml` (camera, BLE scan/advertise,
  notifications, Play Billing).
- **Remaining Play steps:** app icon + version → wire RevenueCat purchase flow + hide in-app
  FastSpring buttons → create **$25 Play Console** account + app → create Golden/VIP **subscription
  products** → connect RevenueCat → signed **AAB** → internal testing → **12 testers / 14 days** →
  production. New personal accounts must run the 12-tester/14-day closed test before production.
- Full guide: `docs/PUBLISH_TO_GOOGLE_PLAY.md`.

---

## Docs index (in `docs/`)
- `PUBLISH_TO_GOOGLE_PLAY.md` — full Play launch steps.
- `MIGRATE_TO_AWS.md` — the server migration runbook.
- `DEPLOYMENT.md` — infrastructure/deploy reference.
- `GO_LIVE_CHECKLIST.md`, `MOBILE_BUILD.md`, `DEPLOY_TEST.md` — older references.

---

## Open TODOs / next steps
1. **Verify AWS migration** end-to-end: login, a live room, an image, AI, email OTP (all now wired).
2. **Retire the old Hetzner server** once verified (final backup, then terminate).
3. **Google Play:** app icon/version → RevenueCat purchase flow + hide in-app FastSpring → Play
   Console account → products → AAB → testing → production.
4. **FastSpring:** finish account activation, then flip the web storefront live.
4b. **Gemini billing (RESOLVED 2026-08-18):** the AI 429s were `RESOURCE_EXHAUSTED` because the
   app's project was linked to an EMPTY prepay billing account. Fixed by linking the project to a
   funded billing account ("My Billing Account", ~$45) in Google Cloud Console → Billing. There's
   also a **$300 free credit** (expires Nov 14 2026) that could be used via pay-as-you-go later.
   Original note for reference:
   the key's project is Tier 1 but on **PREPAY billing, and credits ran to $0**
   → every AI call returns HTTP 429 `RESOURCE_EXHAUSTED "prepayment credits are depleted"`. Fix is
   Google-side: top up the prepay balance OR switch the project to **standard pay-as-you-go
   (postpaid)** billing at https://ai.studio/projects. No app change/redeploy needed. (App-side chat
   throttle was REMOVED; the app never was the limiter.) Diagnose with a direct curl to
   `generativelanguage.googleapis.com/.../gemini-flash-latest:generateContent` using GEMINI_API_KEY.
5. Recent code (this session): per-user AI response cache + TTS cache (`lib/ai-cache.ts`); updated
   Terms (`app/terms/page.tsx`); AI throttle raised to 60/min chat + 120/min TTS and reworded
   (it's anti-abuse only — real limits are the dashboard caps); **plans page now pulls the
   Golden/VIP limits LIVE from the dashboard** (`components/subscribe-screen.tsx` + templated
   `premium.*` i18n keys), fixed the "120 GB calls" typo → minutes.

## How the AI limits work (dashboard-driven)
- Caps live in **AppSettings** (one row, `id="app"`), edited in the **admin dashboard → AI section**,
  per tier: `aiMessagesBasic/Vip`, `aiImagesBasic/Vip`, `aiVideosBasic/Vip`, `callMinutesBasic/Vip`,
  `storageGbBasic/Vip`. Enforcement (`lib/ai-usage.ts`) reads them **live** each request; admins &
  cap=0 are unlimited; counters reset monthly. `/api/ai/usage` (bar) and the plans page both read
  the same values, so changing the dashboard updates everything. The per-minute throttle in
  `lib/rate-limit.ts` is separate/hardcoded (abuse guard, not a quota).
- **Plan displays that mirror the dashboard (prices + limits, live):** subscribe page
  (`subscribe-screen.tsx`), the AI-page plans popup (`ask-screen.tsx`, `ask.plans*` i18n templated),
  and the settings usage bar. Qualitative feature lists (`premium.gReview` etc.) are static text.
- **KNOWN leftover:** old 1/3/6/12-month bundle pickers still exist in `settings-screen.tsx`
  (`tiers` state) and the "pay for this person" gift flow (`chat-screen.tsx`) — should be reduced
  to the two plans (Golden/VIP). Not done yet.
