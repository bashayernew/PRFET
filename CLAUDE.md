# PRFET — Project State & Orientation

**This file is the single source of truth for the project.** Read it first in any new chat.
Keep it updated whenever infrastructure, config, or major features change.
_Last updated: 2026-08-17._

---

## What this is
PRFET is a mobile-first **social app** for a Kuwaiti client (Al Aridi). It's **18+**, bilingual
**Arabic/English** (`lib/i18n.tsx`), with a dark inverted-purple theme. Internally the codebase
is still named **"Herot"** (`herot@0.1.0`, package id `com.prfet.app`) — the product/brand name
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
`SUPPORT_EMAIL`, `AD_AUTO_APPROVE`, and `REVIEW_EMAIL` + `REVIEW_OTP` (see below).

⚠️ **OTP is REAL now** — `lib/auth.ts` emails a random 4-digit code; there is NO global `1234`
backdoor anymore (the old `OTP_DEV_CODE` note was stale). **App-store reviewer login:**
`verify-otp` accepts a fixed code for ONE email only, set via `.env`:
`REVIEW_EMAIL=review@prfet.com` + `REVIEW_OTP=1234`. That account also has password `12345678`
(so password login works too). Keep this account + env alive while the app is on the stores —
Google/Apple re-review every update. Display name: "PRFET Reviewer".

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
- ⚠️ **The real package name is `com.herot.app`, NOT `com.prfet.app`.** That is what
  `android/app/build.gradle` builds (`applicationId`/`namespace`) and what the Play Console
  listing uses — Play app **PRFET**, app id 4973404540674362003, developer account
  7452961130802505302 (personal). The package keeps the old name because the project was
  created when the app was still called Herot; users never see it, and it can never change.
  (Chrome's auto-translate renders "PRFET" as "PROPHET" on the Play Console — ignore that.)
  `capacitor.config.ts` still says `appId: "com.prfet.app"`, which is **wrong and dangerous**:
  it is only read when the native project is generated, so it does nothing today, but
  regenerating `android/` would flip the id and Play would reject the upload. A package name
  can never be changed after first submission. Leave `android/app/build.gradle` alone.
- Native shell = **Capacitor 6**, appName "PRFET", **loads prfet.com** in a
  WebView (so most updates ship via a normal web deploy — no new AAB needed).
- Android project: **`D:\app\android`** (open THIS in Android Studio, not the old `~/Desktop/app`).
- Toolchain: **targetSdk/compileSdk 36**, AGP **8.13.2** / Gradle **8.13** (via AGP Upgrade Assistant).
- Plugins installed: `bluetooth-le@6.1.0`, `camera@6`, `geolocation`, `push-notifications@6`,
  `privacy-screen`, `@revenuecat/purchases-capacitor@9.2.2`.
- Permissions added in `android/app/src/main/AndroidManifest.xml` (camera, BLE scan/advertise,
  notifications, Play Billing).
- ✅ **PRODUCTION ACCESS GRANTED (2026-09-25).** The 12-tester / 14-day closed test is done and
  Google has granted production access. Publishing is now: **الاختبار والإصدار (Test and release)
  → الإنتاج (Production) → إنشاء إصدار جديد (Create new release)** → upload the signed AAB.
  Production stage still reads **غير نشط (inactive)** until that first production release.
- ⚠️ **BLOCKER before selling anything in the app:** `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` in the
  server `.env` is still the literal placeholder `<paste key>`. In-app purchases cannot work until
  it holds the real RevenueCat Android SDK key, and because it is `NEXT_PUBLIC_` it is compiled into
  the bundle — it needs a **full `--build --force-recreate`**, not a restart. Also confirm the
  Golden/VIP subscription products exist and are **active in Play Console itself** (RevenueCat
  having them is not enough), and that RevenueCat is pointed at the Play (not Test) store.
- **Keep the reviewer account alive:** `REVIEW_EMAIL=review@prfet.com` + `REVIEW_OTP=1234`. Google
  re-reviews every production update and will reject an app it cannot sign into.
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
4b. **Gemini — SOLVED 2026-09-23, and it was never billing.** `GEMINI_API_KEY` was missing its
   variable name in `.env`, so it was `undefined` the whole time. Ignore the billing theories that
   used to live here; see **"AI (Gemini)"** near the end of this file for what actually happened.
5. Recent code (this session): per-user AI response cache + TTS cache (`lib/ai-cache.ts`); updated
   Terms (`app/terms/page.tsx`); AI throttle raised to 60/min chat + 120/min TTS and reworded
   (it's anti-abuse only — real limits are the dashboard caps); **plans page now pulls the
   Golden/VIP limits LIVE from the dashboard** (`components/subscribe-screen.tsx` + templated
   `premium.*` i18n keys), fixed the "120 GB calls" typo → minutes.

## Session 2026-08-27 — AI media everywhere + Gemini reliability
- **Post screen** (`components/create-screen.tsx`): added a **Photo/Video toggle** (post an image
  OR a video, 25/120 MB), plus a **Generate image/video with AI** button (describe → `/api/ai/image`
  or `/api/ai/video` → converts the returned data-URL to a File → normal `/api/upload` → publish).
  "Write with AI" caption button already existed.
- **Ad screen** (`components/ads-screen.tsx`): added **Generate video with AI** next to the existing
  Generate-image button (same start+poll flow). Upload already accepted image/video.
- **Gemini reliability** (`lib/gemini.ts`): the AI "Couldn't reply" was Google returning
  **503 UNAVAILABLE "high demand"** (verified by hitting the model directly) — NOT key/billing/auth
  (image worked, billing funded). Fix: **auto-retry chat + image on 503/500/502** (3 tries, backoff);
  added `logGeminiFail()` so the REAL Google error now prints to `docker compose logs app` (routes
  only surface a generic 502 to the browser). New i18n: `create.type*`, `create.aiMake*`, `ai.makeVideo`.
- **Video status:** generation **STARTS fine** (Veo returned an operation name in the direct test);
  remaining failure is in poll/download of the finished clip (slow / memory on the 1 GB box). New
  logging will show the poll result — diagnose next.
- Diagnose a live AI failure: `docker compose logs --tail=80 app | grep gemini` (run on the SERVER).

## AI model reliability (Session 2026-08-28)
- **Root cause of "Couldn't reply":** Google 503-overloaded the `gemini-flash-latest` alias, and
  later `gemini-2.0-flash` was retired (404 → "use gemini-3.6-flash"). Fix: pin a current model
  via env + auto-fallback in code.
- **Pinned model:** `.env` on the server has `GEMINI_MODEL=gemini-3.6-flash` (chat). Update this one
  line + `docker compose up -d --force-recreate app` when a model retires — no rebuild.
- **Self-healing fallback (`lib/gemini.ts`):** chat, image AND video each try the pinned model, then
  fall back to a second model on 404 (retired) / 503 (overloaded). Env knobs: `GEMINI_MODEL(_FALLBACK)`,
  `GEMINI_IMAGE_MODEL(_FALLBACK)`, `GEMINI_VIDEO_MODEL(_FALLBACK)`. Default fallback = the code's
  DEFAULT_* (the never-retired `-latest` alias for chat).
- **AI pricing is now LIVE:** `app/api/ai/chat/route.ts` reads `AppSettings` (Golden/VIP prices +
  image/video/message/storage caps) and passes them to `geminiChat` → `systemPrompt`. The assistant
  no longer hardcodes old prices ($9.99/$4.99); it quotes the dashboard values. Voice minutes dropped
  from the AI's pricing answer (voice chat is disabled).
- **Email/OTP:** the Resend account (a.almnees@gmail.com) was SUSPENDED → all OTP emails failed
  (401 "API key is invalid"). Reactivation form submitted (transactional/OTP only, no marketing).
  Once active: make a fresh key, set `SMTP_PASS=re_...` in `.env`, force-recreate. Reviewer login
  (`review@prfet.com` + code 1234) works regardless.

## Voice chat (talking to the AI) — DISABLED via flag
- Hidden for now behind `const VOICE_CHAT = false;` at the top of `components/ask-screen.tsx`.
  Gates 4 UI entry points: live-voice button, per-message read-aloud, mic dictation, and the
  voice-minutes row in the usage bar. **Flip to `true` to restore instantly** — all the underlying
  code (live loop, `/api/ai/voice-tick`, TTS metering) stays in place. The fix-list voice items
  (#7 VAD, #8 audio) are therefore moot while this is off.

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
- **Gift flow (FIXED):** the "pay for this person" sheet (`chat-screen.tsx` + `app/api/subscribe/gift/route.ts`)
  now gifts one month of **Golden or VIP** at the live dashboard price (was 1/3/6/12-month bundles at a
  hardcoded $30). Sets `premiumTier` on the recipient.
- Minor leftover: `settings-screen.tsx` still has an unused `tiers` state referencing sub3m/6m/12m,
  but it only renders the monthly price (no bundle UI shown). Cosmetic; not urgent.

## Session 2026-09-16 — client fix list (round 2), all deployed as WEB pushes
Client sent a 22-item list. Status + what shipped (commits after 2ba529b: search/ads/live/call fixes,
then `db09946` distance+subs):
- **Item 10 search dupes/self** (`app/api/users/route.ts`): added `id: { not: me }` to exclude the
  viewer, and a name+avatar dedup pass so a duplicated official/PRFET account no longer shows 2–3×.
- **Item 4 live camera flip** (`lib/livekit.ts` `flipCamera` restarts the track with a new
  `facingMode`; `components/meeting-room-screen.tsx` flip button, shown when camera on; i18n `meet.flip`).
- **Item 13 call speaker** (`components/call-overlay.tsx`): the toggle was disabled on Android (no
  earpiece label) so speaker couldn't turn off. Now enabled on any touch device, and it prefers a
  NATIVE bridge `window.PrfetNative.setSpeakerphone(on)` — added in `BleBridge.java` via AudioManager
  (`MODE_IN_COMMUNICATION` + `setSpeakerphoneOn`). **Native part needs the next AAB** to take effect;
  the web button works now. NOTE: `android/` is GITIGNORED, so the Java change lives only in the local
  tree and rides the next Android Studio build — it is NOT in git.
- **Items 17/20 ads country targeting** (`app/api/ads/serve/route.ts` exact CSV country match instead
  of substring; `components/ads-screen.tsx` now passes the viewer country). Ad reaches everyone in the
  country, no follow needed.
- **Item 21 ads in home feed** (`components/home-screen.tsx`): country-targeted ads fetched from
  `/api/ads/serve` and interleaved after every 4 posts as `FeedAdCard` with a "contact advertiser"
  button → `/messages/<advertiserUserId>`. i18n `home.sponsored`, `ads.contact`.
- **Item 16 admin got everyone's notifications:** NOT a code bug (`lib/notify.ts` only targets the one
  user; `lib/fcm.ts` already prunes dead tokens). Cause was leftover admin DeviceToken/PushSubscription
  rows from testing. **Fixed by a one-time DB cleanup** (DELETE from DeviceToken/PushSubscription where
  userId in admins) — already run on prod (DELETE 1 / DELETE 2).
- **Item 6 distance search** (`app/api/users/route.ts`): was ordered by rating (not distance) and the
  slider dropped every unknown-location user below 100km → empty list. Now: keep unknown-location users
  (list never empties), filter known-distance users by the slider, and **sort nearest-first** when the
  viewer has an origin. No unit mismatch existed (slider metres → `maxKm = m/1000`). `showDistance`
  defaults true. Root data issue remains: few users have `locationLat/Lng` (sync is 10-min throttled,
  permission-gated in `lib/use-location-sync.ts`).
- **Item 18 subscriptions never ended** (`lib/premium.ts`): `premiumLapsed` required `!autoRenew`, but
  grants/gifts/admin all leave `autoRenew=true` (default), so premium stayed forever. FIX: lapse when
  `premiumUntil < now` regardless of autoRenew. Store auto-renew pushes `premiumUntil` forward on each
  charge so real renewals don't wrongly lapse; gifts (30d) / admin grants / cancelled subs now end on
  their date. Enforced lazily on login + `/api/auth/me` (`expireIfLapsed`). Tier caps already live from
  AppSettings per `premiumTier`.
- **Item 14 post reach:** WORKING AS DESIGNED — home feed is followed-only (`/api/posts?feed=following`
  = your follows + you); non-followers see posts only on the poster's profile grid. User chose to keep
  followers-only. To open it up = show posts to everyone/country (declined for now).
- **Item 9 search page cut off:** client screenshot shows it fits fine after the earlier viewport fix.
  Resolved.
- **App icon:** replaced the default Capacitor launcher icon with the PRFET golden monogram across all
  mipmap densities + adaptive foreground (from `prfet-icon-512.png`), generated into
  `android/app/src/main/res/mipmap-*`. **Shows only after the next AAB** (android is gitignored → local).

### STILL PENDING
- **Next AAB build** bundles the native items: app icon, #11 reversed front-camera video (native camera
  mirror), #5 ringing-when-closed (WhatsApp style), #7/#8 Bluetooth listing (needs 2 phones on new
  build), and #13 native speaker routing (`setSpeakerphone`). Bump `android/app/build.gradle`
  versionCode/Name before building.
- **Item 15 app lag:** general perf on t3.micro; not a discrete fix.
- **SECURITY:** `ses-smtp-user.*.csv` (SMTP creds) is COMMITTED in the GitHub repo — remove
  (`git rm --cached`) + add to `.gitignore` + rotate the SES SMTP creds. Also still rotate the exposed
  Firebase service-account key + old Gmail app password.
- Deploy flow this session: selective `git add <files>` (NOT `-A` — working tree has unrelated
  IAP/RevenueCat/credits/`schema.prisma` WIP that must NOT ship) → push from PowerShell → `git pull &&
  docker compose up -d --build` on the server via EC2 Instance Connect (ISP does DPI on SSH so direct
  PowerShell ssh to :22/:2222 fails at the banner; browser terminal is the reliable shell).


---

# Sessions 2026-09-17 → 09-22 — big one. Read this before touching calls, deploys or the server.

## ⚠️ DEPLOY DISCIPLINE — read first, this cost ~6 hours

**Always deploy with `--force-recreate`:**
```bash
cd ~/app && git pull && cd deploy && docker compose up -d --build --force-recreate
```
Without it Compose may reuse the running container. On 09-20 the app served **45-hour-old code**
while fix after fix was tested and reported as "still broken". Several fixes were never running.

**Verify every deploy** (10 seconds, saves hours):
```bash
cd ~/app/deploy && docker compose ps      # deploy-app-1 must say "Up less than a minute"
```

**`NEXT_PUBLIC_*` env vars are compiled into the bundle at BUILD time** — changing one needs a full
`--build --force-recreate`, not a restart. Server-only vars (`GEMINI_API_KEY`, `POSTMARK_TOKEN`,
`REVENUECAT_WEBHOOK_AUTH`, `KWTSMS_*`, `TWILIO_*`) are read per request → `up -d --force-recreate app`
is enough (~15s, no rebuild).

## 🔥 OUTAGE 2026-09-22 — disk full, app down all day

Symptom: "very slow 10am–8pm, sometimes won't open". Looked like peak-traffic load. It wasn't.

`/dev/root` hit **100% (6 MB free of 38 GB)** → Postgres couldn't write → app couldn't reach
`db:5432` → every request retried → **load average 355**, app container at 196% CPU with 3,735 PIDs.
CPU steal was 0, so it was never CPU credits or traffic.

Cause: **Docker's json-file log driver is unbounded** (made worse by the `[call]`/`[meet]` diagnostics
added 09-21) plus **15.5 GB of build cache** from ~20 rebuilds.

Recovery:
```bash
sudo sh -c 'truncate -s 0 /var/lib/docker/containers/*/*-json.log'
docker system prune -af          # NEVER --volumes: that deletes deploy_pgdata + deploy_uploads
cd ~/app/deploy && docker compose restart
```
38 GB → 19 GB used.

**Permanent fix shipped:** `deploy/docker-compose.yml` now has an `x-logging` anchor
(`max-size: 10m`, `max-file: 3`) applied to all five services. Only takes effect on container
**recreate**.

**Weekly habit:** `df -h /` — above 80% run `docker system prune -af`.
**Still unbounded:** `deploy_uploads` (every photo/video/voice note, nothing deletes them). Next thing
that will fill the disk. Needs a retention policy.

## Server
- Resized **t3.micro → t3.medium** (09-19). t3.micro had 298 MB available and was swapping constantly
  (`si` > 0 = actively paging back in). After: 3 GB free, zero swap. ~$0→$34/mo (it was free-tier).
- App responds in **0.2 ms** locally. Any remaining slowness is the ~4,000 km to Frankfurt
  (90–130 ms RTT) — the app is a WebView loading prfet.com, so *every tap* pays it.
- **AWS Middle East regions are gone** — me-south-1 (Bahrain) permanently unrecoverable and
  me-central-1 (UAE) partially, after Iranian strikes in March 2026. Do not plan a move there.
  Next-best latency win: **Cloudflare in front** (free; TLS terminates at a Gulf edge PoP, caches
  static assets). Must set `livekit.prfet.com` to **DNS-only/grey cloud** or live rooms break, and
  leave all mail records unproxied.

## Email + OTP
- **Root cause of the Resend suspension:** `resend-otp` and `forgot` had **no rate limiting at all**.
  Anyone could trigger unlimited mail to any address. A new provider would have suspended us too.
- **`lib/otp-guard.ts`** (new): per-address 60s cooldown, 5/hour, 15/day; per-IP 15/hour. Applied to
  register, resend-otp and forgot. Covers phone numbers too (SMS costs money per send).
- **Postmark** is now the primary sender (`POSTMARK_TOKEN`), falling back to Resend then SMTP.
  Sends on the `outbound` transactional stream. Domain verified; DKIM + Return-Path green.
  Root SPF is `-all` Outlook-only — fine because Postmark uses its own Return-Path and DMARC is
  relaxed, but it means the **SES/SMTP fallback would hard-fail**. Don't rely on it.
- **Phone signup was completely broken**, not just missing SMS: a code was generated and hashed, and
  only the email branch ever delivered anything. Nobody registering by phone could ever verify.
- **`lib/sms.ts`** (new): routes by destination — `+965` → **kwtSMS** (~KWD 0.015/msg, local gateway,
  guaranteed Kuwait delivery), everything else → **Twilio** ($0.32/msg to Kuwait), each falling back
  to the other. Kuwaiti operators filter business SMS without a Sender ID registered to a local
  company, which is why Twilio alone is unreliable there. Plivo **blocks signups from Kuwait**.
  kwtSMS API access was still pending (their request form posts to a 404 — contact them on WhatsApp
  +965 9922-0322).

## Calls — the long one
Chronological, because several "fixes" were chasing symptoms of the previous cause.

1. **`lib/socket.ts` called a non-existent `refreshAccessToken()`** → ReferenceError on any rejected
   handshake → socket dead for the whole session. Shipped silently because
   `typescript.ignoreBuildErrors: true`. Fixed to `refreshAccess()`.
2. **Stale `online` flags.** Only the disconnect handler cleared `online`, so a container restart left
   everyone marked online forever — callable with no live socket. `server.js` now clears them at boot
   (`> presence: cleared N stale online flag(s)`).
3. **Answering from the notification did nothing.** `claimPendingCall` only ran on socket-connect;
   answering while the app is already foregrounded fires `onNewIntent` but no visibilitychange and no
   focus event. Now **polled every 1s** plus both events.
4. **The retry loop killed the call.** Asking the caller repeatedly made them re-send the offer; the
   second one hit the "already busy" guard which replied `end`. Repeat offers from the *same* peer are
   now recognised as retries and ignored.
5. **Server-held offer.** Signalling is relayed, not stored, so an offer to a closed app was lost.
   `server.js` now holds the last offer per callee for 90s and **replays it** on `call:ready` —
   removing the dependency on the caller still being alive. Log: `(replaying stored offer)`.
6. **Device tokens misrouted pushes.** `registerNativePush` ran **only on the home screen**, so logging
   in and landing elsewhere left the FCM token registered to the PREVIOUS account on that phone —
   a caller's own phone rang for its own outgoing call. **19 stale rows** were in `DeviceToken`.
   Now re-registered on every app open from `CallHost` (root layout). One-time cleanup:
   `DELETE FROM "DeviceToken";` (every device re-registers within seconds).
7. **Stale notifications.** The CallStyle notification is `setOngoing(true)` + `setAutoCancel(false)`
   so it can't be swiped mid-ring — which means **unanswered calls leave it in the tray forever**.
   Tapping an old one resumes a dead call. Server now replies `call:none` when it holds no offer, and
   the app shows "انتهت المكالمة" for 2s instead of hanging for 15.
   **REAL FIX STILL TODO: auto-cancel the notification after ~45s in `CallNotification.java` (needs an AAB).**
8. Hanging up now also fires `/api/call/cancel` → `pushCallCancelled` (dismisses the notification on a
   closed app); **closing the call screen ends the call for both sides** (`cleanup()` → `endCall()`);
   and the server drops held offers when a caller's socket disconnects.
9. Ringback kept playing after the other side answered — `status` only left `"ringing"` on the first
   media packet. Now switches on the `answer` signal, with `connectionState === "connected"` as a
   second route to `in-call`.
10. **No-answer screen** after 40s: "not available" + Send a message / Call again. Logs a missed call
    both sides.
11. **Minimise to a bar** — the call collapses to a top bar with a live timer, mute and hang-up, so the
    app stays usable mid-call. Works because `CallHost` is in the root layout.

## DIAGNOSTICS — how to debug calls and live rooms now
```bash
cd ~/app/deploy && docker compose logs -f app | grep -E "\[call\]|\[meet\]"
```
| Line | Meaning |
|---|---|
| `[call] offer A -> B \| callee sockets: N` | N=0 → callee's app is closed (expected; the push path handles it) |
| `[call] ready B -> A (replaying stored offer)` | **Healthy** — B answered, got the held offer |
| `[call] ready ... (no stored offer — likely a stale notification)` | Old notification tapped |
| `[call] DEVICE <user> \| stage: getUserMedia \| NotAllowedError` | Mic refused — phone settings |
| `[call] DEVICE <user> \| stage: connect \| connected` | **Media is flowing** |
| `[call] DEVICE <user> \| stage: connect \| failed` | Phones couldn't find a route → TURN/network |
| `[call] DEVICE <user> \| stage: answered-notification` | Which phone tapped Answer — must be the CALLEE |
| `[meet] chat X -> Y \| listeners: N` | N=1 means only the sender is in the room |
| `[meet] chat refused ...` | Room blocked them |

`POST /api/call/diag` is the device→server reporter. Diagnostics only; stores nothing.
**If the same user id appears as both `offer` sender and `answered-notification` sender, it's a stale
notification or a misrouted push — not a signalling bug.** That cost hours twice.

## Live rooms
- **Comments never arrived:** `meeting:join` required an existing `MeetingParticipant` row, but the
  socket connects *before* the HTTP join creates it → silently rejected. Now only `kicked` is excluded.
- **Comments couldn't be sent** for the same reason in `meeting:chat` — fixed by honouring the host's
  `canText` when a row exists, and the room's `allowText` when it doesn't.
- **`sendChat` used `sockRef.current?.emit()`** which is a silent no-op when the ref is null (the
  effect cleanup nulls it). Now gets the socket via `getSocket()` (a module singleton) and re-joins
  before sending.
- **Comments went missing on reconnect** — room chat is relayed, never stored. `server.js` now keeps
  the last 50 per room in memory and replays them via `meeting:chatHistory` on join. Dropped when the
  room ends.
- **Room stayed frozen when it ended:** the handler used `alert()`, which blocks the JS thread and in
  an Android WebView sometimes never renders → `router.push()` never ran. Now a toast.
  ⚠️ **There are still ~10 `confirm()` calls** (delete message, delete ad, clear AI chat, admin
  dashboard) with exactly the same risk.
- **Host approval now opens the thing immediately** — video/screen previously only reacted to being
  *revoked*, and mic failures were swallowed by `.catch(() => {})`.
- **"Tap to enable sound"** — mobile blocks audio playback until a real gesture; a listener who never
  tapped heard silence with no explanation.
- **Invite sheet** — share now lists people you follow (`POST /api/meetings/[id]/invite`) instead of
  copying a link that notifies nobody.
- **went-live and invite notifications now push** — they used `notification.createMany()` which only
  writes the in-app row. `notify()` is what sends FCM + web push. `went_live` was also missing from
  `phrase()` and `linkFor()`.
- Invited users can now SEE the room: the rooms list only revealed followers-only rooms to *followers*.
  The `meeting_invite` notification row is used as the invite record (no schema change).

## Chat / posts / stories
- **Comment/share sheets were invisible** on fullscreen media: `z-50` under the viewer's `z-[60]`.
  Now `z-[70]`.
- **Clipboard fallback** for Android WebView (`navigator.clipboard` often missing).
- **View-once media** stayed on screen indefinitely after opening — only expiring on reload. Now a
  15-second window, then it collapses. NOTE: the **sender's copy is never removed** (by design), and
  **the file itself is never deleted from disk** — only the URL is withheld.
- **Camera capture in chat** — attach sheet now has Take photo / Record video (`capture` attribute set
  per tap and REMOVED for gallery picks, or some Android builds refuse to offer the gallery).
- **Comment likes + unlimited nested replies** (`CommentLike` model, `PostComment.parentId` self-
  relation, cascade deletes the subtree). Visual indent caps at 4 levels; data nests freely.
- **Story likes** (`StoryLike`) and **story replies → private DM** to the owner with the caption as
  context (reuses the chat system, no new model).
- **Ad enquiry prefill** — "contact advertiser" opens the chat with the ad already written in the box.
- **Discover "Enable location"** failed silently in four ways (no API, denied, unavailable, and **no
  timeout** — Android's `getCurrentPosition` can hang forever). Now a busy state, 10s timeout, and a
  specific message per failure.

## Payments (RevenueCat / Play Billing)
- Server-side IAP (webhook, grants, entitlements, credits) was **already shipped** — the old CLAUDE.md
  note calling it unshipped WIP was wrong.
- `@revenuecat/purchases-capacitor@9.2.2` installed (v13 needs Capacitor 8; we're on 6). Until this,
  `lib/iap.ts` returned null and **wallet credit purchases had never worked**.
- `subscribe-screen.tsx` now uses **Play Billing in the app** and FastSpring only on web — selling
  digital goods in-app through an external processor is what gets apps pulled. Restore button added.
- **RevenueCat project "PRFET"** created, Test Store first. Products `prfet_basic_1m` ($5.99) and
  `prfet_vip_1m` ($10.99) created; entitlements **`basic`** and **`vip`** (lowercase — `tierFromEntitlements`
  matches those strings literally; "PRFET Pro" would grant nothing). Consumables still to add:
  `prfet_credits_5/10/20/50`, `prfet_addon_media/storage/voice`.
- **The app now shows the STORE's price**, not the dashboard's. RevenueCat can never know about
  dashboard price changes — they're separate systems, and the mismatch is a store policy problem.
  Dashboard prices now govern **web checkout only**.
- ⚠️ Google takes 15–30%. Credit packs currently credit the same amount they cost → a loss per sale.
- ⚠️ `prfet_addon_voice`: voice chat is disabled (`VOICE_CHAT = false`), so don't sell it yet.
- ⚠️ VIP radar minutes (480) are LOWER than Golden (2000) in the dashboard — looks like a mistake.

## Wallet
- `transferCredits()` + `POST /api/credits/send` — support another member by sending credits to their
  wallet. Closed loop: spendable in-app, **never withdrawable**, which keeps it virtual goods rather
  than a regulated payment service. Atomic, checks the recipient's $500 cap *before* debiting, writes
  an Invoice receipt for both sides (`kind: "support"`). **UI entry point not built yet.**

## Security
- `prfet-release.jks` and `ses-smtp-user.*.csv` were committed → `git rm --cached` + `.gitignore`
  (`*.jks`, `*.keystore`, `ses-smtp-user.*.csv`). **Still need rotating.**
- Log probes for `.npmrc`, `.git/config`, `application.yml` + `sh: curl not found` = routine internet
  scanning, not a compromise (verified: no unexpected processes, no outbound connections, and the
  container has no shell tooling). 52 probes/24h.

## Android / AAB
Current: **versionCode 8 / 1.0.7**. `android/` is gitignored — every native change lives ONLY on the
local drive. **Back up `D:\app\android` or it's gone.**
Native pieces shipped: CallStyle full-screen ringer (`CallNotification.java`, `PrfetMessagingService`
extends the Capacitor plugin's service and replaces it via `tools:node="remove"`), `pendingCall()` /
`clearPendingCall()` bridge, `USE_FULL_SCREEN_INTENT`, show-over-lockscreen, `POST_NOTIFICATIONS`.
`firebase-messaging:23.3.1` had to be added to `android/app/build.gradle` — the plugin declares it with
`implementation`, so it isn't on the app module's compile classpath.
Play Console: **Full-screen intent permission declared as a calling app** (required on Android 14+).

### Next AAB should include
- **Auto-cancel the call notification after ~45s** (the stale-notification root cause).
- `MainActivity` calls `wv.reload()` unconditionally on startup → **the app loads prfet.com TWICE every
  launch**. Over a 130 ms link that's seconds of pure waste. Needs care: it exists so the BleBridge
  JavaScript interface is visible to the page.

## AI (Gemini) — SOLVED 2026-09-23. The key was never in `.env`.

Every earlier diagnosis in this file was wrong, including the one that used to be here (billing at
−$0.82). The actual cause: **`.env` line 29 held the API key as a bare string with no variable name
in front of it** —

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BLB8WQ...
AQ.Ab8RN6IF2-vj66Sumd79...        ← no GEMINI_API_KEY= prefix
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
```

so `process.env.GEMINI_API_KEY` was **undefined** for months, and the orphan key was stale anyway
(`…IF2-vj66…`, while the console held `…LL78Undi…`). Fixed by deleting the loose line and appending
a proper `GEMINI_API_KEY=` — server-only var, `up -d --force-recreate app`, no rebuild. Verified with
a direct call: HTTP 200, `"text": "ok"`.

**Why it was found late:** the error Google returns for a missing/invalid key looked close enough to
the quota error that "billing" stayed the working theory across several sessions, and nobody checked
that the variable existed. `docker compose exec app printenv GEMINI_API_KEY` would have settled it in
five seconds.

**Lesson worth generalising:** `.env` is unvalidated — a malformed line fails silently and the app
just sees `undefined`. Sourcing it in bash (`set -a && . ./.env`) is a quick integrity check: it
throws on anything that isn't `KEY=value`. Doing that also surfaced
`NEXT_PUBLIC_REVENUECAT_ANDROID_KEY=<paste key>`, still a literal placeholder — in-app purchases
cannot work until it's filled in, and being `NEXT_PUBLIC_` it needs a **full rebuild**, not a restart.

## Phone OTP — status 2026-09-23

**The app side works.** Verified by calling the API directly, bypassing the UI:

```bash
curl -s -w '\nHTTP %{http_code}\n' https://prfet.com/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"contactMethod":"phone","phone":"+96569993349","displayName":"Test User",
       "password":"12345678","accountType":"personal","dateOfBirth":"1995-01-01",
       "country":"KW","locale":"ar"}'
```
→ `HTTP 201 {"ok":true}`. The user row, the hashed OTP and the call into `sendOtpSms` all happen.

**The blocker is the Twilio account tier:**
```
400 {"code":572006,"message":"Invalid template name. Trial accounts can only use predefined SMS templates."}
```
Trial accounts can no longer send free-form SMS at all — only Twilio's own templates. Our bilingual
OTP body will be rejected every time regardless of code. Credentials, `TWILIO_FROM`
(`+17372508034`) and routing are all correct.

Two ways forward, no code change needed either way (`lib/sms.ts` already prefers kwtSMS for `+965`
and falls back to Twilio):
- **Upgrade Twilio** (~$20 minimum). Also lifts the verified-numbers-only trial rule. ~$0.32/SMS to
  Kuwait — expensive, works immediately.
- **kwtSMS** — ~KWD 0.015/msg and a local route that actually lands on Zain/Ooredoo/STC. Still not
  provisioned; their signup form 404s, so contact them on WhatsApp **+965 9922-0322**.

**Diagnosing:** an empty `[sms]`/`[twilio]` log does NOT mean the provider failed — `sendOtpSms`
returns `false` and logs *nothing* when no provider is configured, so silence means it was never
reached. Check `grep -E '^(KWTSMS_|TWILIO_)' .env` first.

## 🔥 OUTAGE 2026-09-25 — a schema change took the site down, silently

Symptoms, all at once: **VIP members appeared to lose their subscriptions**, the app was
**very laggy**, and the **dashboard wouldn't open**. Looked like three bugs. Was one.

Cause: `systemKey` (a column with a **unique constraint**) could not be applied by
`prisma db push` unattended — Prisma refuses and demands `--accept-data-loss`. The push
aborted. The Dockerfile ended in **`|| true`**, so the app started anyway.

Why that broke everything: `/api/auth/me` calls `prisma.user.findUnique()` with **no
`select`**, so Prisma asks Postgres for *every* column in the model. One missing column
fails the whole query → every signed-in request 500s → members read as not-premium, the
dashboard's queries die, and retries make the app crawl.

**The subscription data was never touched.** `premiumUntil` was intact and in the future
the entire time; the API simply couldn't read the rows.

Recovery (safe — the column can't hold duplicates because it didn't exist yet, so the
unique index applies cleanly; avoid `--accept-data-loss` on production):
```bash
docker compose exec -T db psql -U herot -d herot -c \
 'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "systemKey" TEXT;'
docker compose exec -T db psql -U herot -d herot -c \
 'CREATE UNIQUE INDEX IF NOT EXISTS "User_systemKey_key" ON "User"("systemKey");'
docker compose restart app
docker compose exec -T app npx prisma db push --skip-generate   # must say "already in sync"
```

**Fixes shipped so the class of bug can't repeat:**
- **The Dockerfile no longer ends in `|| true`.** A failed migration prints a banner and
  **exits 1**, so the container refuses to start. Retries 5× first, because Postgres may
  not be ready yet — that's timing, not a bad migration. A visibly failed deploy is far
  cheaper than a site that is live and quietly broken.
- **`GET /api/health`** now exists and runs `prisma.user.count()` — a real query against
  the real table. A `SELECT 1` check would have reported "healthy" through BOTH outages.
  Returns 503 with the error when it fails. **Point an uptime monitor at it.**

**Rule for any future schema change:** adding a `@unique` column, making a column
required, or changing a type cannot be applied by `db push` unattended. Apply it by hand
with SQL first, then deploy. Check before pushing:
```bash
docker compose exec -T app npx prisma db push --skip-generate   # dry run on the live DB
```

## 🛡️ HOW TO STOP ALL THIS HAPPENING AGAIN

**1. Know before your client does.** EVERY outage so far was found by a user complaining.
   - `/api/health` is **built now** — it runs a real `prisma.user.count()`, so it fails
     when the DB is full, unreachable, or schema-mismatched. 200 = fine, 503 = broken.
   - **Set up the monitor. This is the single highest-value thing left.** UptimeRobot is
     free: add `https://prfet.com/api/health`, 5-minute interval, alert on non-200, email
     + WhatsApp. Ten minutes of setup would have caught both outages before the client did.
   - CloudWatch alarm on disk > 80%.

**2. Stop writing silent failures.** Nearly every bug in these sessions was one of:
```js
.catch(() => {})          // error vanishes
sockRef.current?.emit()   // null → silently does nothing
alert() / confirm()       // blocks the JS thread in a WebView
```
   An empty catch is only OK with a comment saying why. Otherwise log it or show it.

**3. `typescript.ignoreBuildErrors: true` means type errors SHIP.** That's how a call to a
   non-existent function ran in production for weeks. Run `npx tsc --noEmit` locally before pushing.
   (Note: `prisma generate` must have run, or you get a wall of false errors about missing models.)

**3b. Verify the env, don't trust it.** The Gemini outage was a key with no variable name on it —
   undefined for months while we blamed billing. Before debugging any integration, prove the
   variable actually reached the process:
```bash
cd ~/app/deploy && set -a && . ./.env && set +a   # throws on any malformed line
docker compose exec app printenv | grep -E 'GEMINI|TWILIO|POSTMARK'
```
   Test the third-party API with curl **before** reading app code. Twice now that turned a
   multi-session hunt into a two-minute answer.

**4. Weekly, 30 seconds:**
```bash
df -h /                                   # >80% → docker system prune -af (NEVER --volumes)
cd ~/app/deploy && docker compose ps      # everything Up?
```

**5. Deploy the same way every time** — `--build --force-recreate`, then verify with `docker compose ps`.

**6. Keep this file current.** It is the only thing that carries context between sessions. A stale
   CLAUDE.md actively misleads — the "IAP is unshipped WIP" note sent us down the wrong path.
