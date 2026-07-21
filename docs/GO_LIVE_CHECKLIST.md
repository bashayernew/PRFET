# Herot — Go‑Live Checklist & Remaining Features

> Running list of everything still needed to take Herot from the current working prototype to a full, production‑ready launch. **Nothing here is implemented yet** — it's the backlog to work through when requested. This file lives in `docs/` and does **not** affect the app build (Markdown is not compiled, type‑checked, or linted).

Last updated: kept current as new items are flagged.

Legend: **P0** = launch blocker · **P1** = needed for "fullest" experience · **P2** = polish / later.

> **Owner's sequencing (Jul 2026):** **OTP delivery and ALL payments are done LAST.** Keep the
> dev OTP (`1234`) and the fake ad/premium/meeting gateways in place until the very end so the app
> stays fully usable while the rest is built. Everything else below takes priority over these two.
> Deferred-to-last items: §1 "Real OTP delivery", §5 Payments & monetization (ads charging,
> premium billing, meeting per-hour billing), and the meeting "Per-hour billing" line in §Meetings.

---

## 1. Launch blockers (P0)

- [ ] **Real OTP delivery.** Right now the verification/reset/login code is fixed at **1234** (`lib/auth.ts` → `generateOtp`, dev only). Wire a real email sender (self‑hosted SMTP) for email accounts and an SMS gateway for phone accounts. Remove the on‑screen dev code in production.
- [ ] **Strong production secrets.** Set real `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in the server env (currently dev fallbacks in `lib/auth.ts`). Rotate before launch.
- [ ] **Database migrations.** Switch from `prisma db push` to proper migrations (`prisma migrate deploy`) for production so schema changes are versioned and safe.
- [ ] **Logout revokes the refresh token server‑side.** Today logout only clears the client tokens; add a `/api/auth/logout` that sets `revokedAt` on the refresh token so a stolen token can't be reused.
- [ ] **Privacy Policy & Terms pages.** Required by Apple App Store and Google Play, and by GDPR. Add real pages + link them from register/settings.
- [ ] **PWA icons + manifest.** The repeating `icon-192.png` / `icon-512.png` 404s — add the actual app icons under `public/` and fix `public/manifest.json`.
- [ ] **Rate limiting & abuse protection** on auth, OTP, register, upload, messaging endpoints.

## 2. Replace mock data with real, DB‑backed entities (P0/P1)

**Partially done (Jul 2026 batch):** `prisma/seed.mjs` upserts 5 sample businesses as real `User` rows (ids `"1"`–`"5"`). `GET /api/users?q=` + `GET /api/users/[id]` serve the public directory. Discover is search‑driven against the API (distance slider filters client‑side). Merchant profiles load real data with sample fallback. Home reels preview + `/feed` use placeholder media; meetings list/room UI is mock until `/api/meetings` is wired.

Still mock / not real yet:

- [ ] Make **all** businesses/merchants real accounts (beyond the 5 seeded samples); retire `lib/data.ts` `BUSINESSES` as the source of truth.
- [ ] Discovery/search: Postgres full‑text + viewer geolocation (API still uses a fixed Riyadh origin for haversine).
- [ ] Follows currently store a **business id string**; move to real user‑to‑user follows so followers/following counts are real (the "following" count on `/following` is a placeholder).
- [ ] Chat peers become real users (messaging is already persisted, but the "other side" is mock — no real peer replies yet).
- [ ] The home "city" is hardcoded ("Riyadh"); derive from real geolocation/country.

## 3. Real‑time & messaging (P1)

- [ ] **WebSocket layer** for live message delivery + **online/offline presence** (the green/grey dot is currently static). Needs a self‑hosted WS server (Next route handlers don't hold persistent sockets).
- [ ] **Rich messages:** voice notes, video, images, and location sending (currently **text only**).
- [ ] **Disappearing media enforcement.** The per‑chat "delete after viewing" toggle exists in the chat UI; wire it so media actually deletes after view.
- [ ] **Screenshot protection & alerts:** Android `FLAG_SECURE` to block screenshots on sensitive screens; iOS screenshot **detection** + notify the other party. Frame as deterrents (can't be 100%).
- [ ] Block / report / mute a conversation.

## 4. Media storage & uploads (P1)

- [ ] **Signup avatar** is currently stored as a small **base64 data URL** (no auth token yet at signup). Move to real upload — either a pre‑auth signed upload or upload‑after‑verify — and store a `/uploads/...` URL like the rest.
- [ ] For scale, move `public/uploads` local‑disk storage to self‑hosted object storage (MinIO / S3‑compatible) with CDN.
- [ ] Image/video processing: resize, transcode, virus/content scan.

## 5. Payments & monetization (P1) — the "only if forced" third parties

- [ ] **Ads payment** is a fake flow. Real charging: Apple/Google in‑app billing on mobile for digital goods; a card processor (Stripe/PayPal/local) for web checkout. See the architecture doc for the 2025 external‑payment rules.
- [ ] **Premium subscription** (`/api/subscribe`) is a **fake gateway**. Wire real billing + renewal/expiry handling + a job to downgrade when `premiumUntil` passes.
- [ ] **Entitlement enforcement** for premium perks server‑side (custom name colour, precise location, 3 social links) — partly gated already; audit all paths.
- [ ] Ads engine: real **serving/targeting by country**, **impression counting per country**, **viewer report to the advertiser**, ad scheduling, expiry job, and **ad review/moderation** before an ad goes live.
- [ ] Tax/VAT handling per country; refunds; Merchant‑of‑Record consideration.

## 6. Location features (P1)

- [ ] **Real distance** via haversine from stored coordinates (both parties). Discover's distance bar and the result distances currently use the sample `dist` values.
- [ ] **Approximate vs precise** on other people's profiles: non‑premium shows only distance + direction ("1.2 km · north‑east"); premium + sharing shows the exact Google‑Maps‑style point.
- [ ] **People search by distance + gender** — build with the safety mitigations (coarse bands, default off, block/report) noted in the plan.

## 7. Social graph, stories, discovery (P1)

- [ ] **Post a story** (upload photo/video, 24h expiry, seen‑tracking). The story viewer currently shows a placeholder (icon + name), not real media.
- [ ] **Visibility enforcement** (Public / Friends) across profiles, stories, and content — the setting is stored but not yet enforced everywhere.
- [ ] **Top‑3 most‑viewed:** real profile‑view tracking + a weekly refresh job (counts are currently a follower proxy).
- [ ] **Sponsor banner** + instant‑message‑the‑sponsor as a real sponsor concept.
- [ ] **Jobs:** real job posting for business accounts (create/persist), applications, and a "Post a job" flow (Apply currently just opens a chat).

## 8. Notifications (P1)

- [ ] More event types: new message, new follower, ad approved, weekly ad viewer report, subscription events.
- [ ] **Push delivery** via Apple **APNs** + Google **FCM** (forced third parties, free) for background notifications.

## 9. Security, trust & safety, compliance (P0/P1)

- [ ] **Content moderation** for ads, media, live, and messages (automated screening + human review + takedown).
- [ ] **Reporting & blocking** across users, content, ads.
- [ ] **Minors protection:** minimum‑age gate at signup, stricter defaults, children's‑privacy compliance.
- [ ] **GDPR‑style data control:** export my data, delete my account + data.
- [ ] Encrypt sensitive data at rest; audit logging; secure headers.

## 10. Mobile / distribution (P1)

- [ ] **Capacitor packaging** for iOS + Android from the current web codebase.
- [ ] Apple Developer + Google Play accounts (in the owner's name), store listings, screenshots.
- [ ] Native permissions (camera, mic, location, notifications) wired via Capacitor plugins.
- [ ] App review readiness: UGC policy, payments policy, location/screenshot handling.

## 11. Infrastructure & deployment (P0)

- [ ] Linux server (VPS/cloud or on‑prem) running the app via Docker; managed or self‑hosted PostgreSQL; object storage; media/WS servers.
- [ ] Domain + TLS certificate; environment/secrets management; backups; monitoring/alerting; log aggregation.
- [ ] CI/CD for build + `prisma migrate deploy` + deploy.
- [ ] Horizontal scaling plan (stateless app servers, sticky WS, shared storage).

## 12. Polish / nice‑to‑have (P2)

- [ ] Username‑recovery flow (send username to email/phone) — identifier is already email/phone, so mostly a reminder message.
- [ ] Loading skeletons, empty states, and error toasts everywhere.
- [ ] Accessibility pass (labels, contrast, larger text), optional dark mode.
- [ ] Analytics / product metrics.
- [ ] Remove leftover unused i18n keys and sample data once real data lands.

---

### Notes on current known‑good state
- Auth: register (email **or** phone, optional password), verify (OTP), login (password **or** code), forgot/reset, **token auto‑refresh** — all working in‑house.
- Screens built: entry (language + account type), country, register, verify, home (stories, strip: daily ads / sponsor / jobs, top‑viewed, nearby), discover (distance bar), ads (feed + create), messages + chat (persisted, disappearing toggle), merchant, follow, profile (fully editable + premium perks), subscribe (fake), notifications, following, top, jobs, story viewer.
- Everything type‑checks clean except the generated Prisma client, which is resolved by `prisma generate` / `npm run db:push`.

## Chat & Meetings (added Jul 2026)

### Chat
- [ ] Real media pipeline for image/video/voice attachments (upload + storage + playback).
- [ ] Per-chat settings persistence (save-media, view-once) — currently client-side only.
- [ ] True view-once enforcement + screenshot **blocking**. Web cannot truly block
      screenshots; real blocking needs the native iOS/Android wrapper (FLAG_SECURE on
      Android, screen-capture detection on iOS). Current build detects PrintScreen/common
      shortcuts best-effort and posts the "tried to screenshot" alert into the ch
---

## ✅ Built in the "make everything functional" batch (Jul 2026)

App-level features now real & DB-backed (OTP + payments intentionally left as stubs):
- Real accounts everywhere: `/api/users` directory + `/api/users/[id]`; Discover, merchant
  profile, chat peer, story viewer, reels authors, following list, home stories/reels all
  read the DB with sample fallback. Seed converts the 5 businesses to real accounts.
- Real follower/following counts (Prisma counts) + viewer-based haversine distance.
- Rich-media messages: image/video via upload, **voice notes via MediaRecorder**, location via
  geolocation — persisted with `kind` + `mediaUrl`, rendered by type.
- Block/report: `Block` + `Report` models + APIs; messaging blocked both directions; chat
  settings wired.
- Stories: `Story` + `StoryView` models, post (24h expiry) from home, real media viewer with
  progress + seen-tracking.
- Jobs: `Job` model, business "post a job" flow, real listings.
- Meetings: `Meeting`/`MeetingParticipant` wired — create/list/join, 20-seat cap, host detection,
  real participants in the room (live voice = §3 media server).
- Ads engine: country-targeted serving (`/api/ads/serve`) with impression counting, lazy expiry
  sweep, moderation-ready status (auto-active in dev), advertiser report via `/api/ads`; reels
  feed serves real ads.
- Notifications on new follower + new message; profile-view tracking → real top-viewed ranking
  (`?sort=views`); Public/Friends visibility enforced in `/api/users/[id]`.
- Server-side logout (`/api/auth/logout` revokes the refresh token) wired into Profile.
- PWA app icons added (`public/icon-192.png` / `icon-512.png`) — clears the 404s.

Infra-dependent pieces documented in `docs/DEPLOYMENT.md` (WebSocket, media server, push,
object storage, Capacitor, hosting). OTP + payments remain last, per owner.
