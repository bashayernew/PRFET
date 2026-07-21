# Herot — Deployment & Infrastructure Guide

Everything that runs *inside the app* is now built and DB-backed (see the checklist).
This file covers the pieces that can only be switched on when the app runs on a real
server. Each is scaffolded/documented so it's a wiring job at deploy, not a rebuild.

---

## 0. First-run (any environment)
```
cp .env.example .env         # set DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
npm install
npm run db:push              # (dev) or: npx prisma migrate deploy  (prod)
npm run db:seed              # seed the sample businesses as real accounts
npm run build && npm start
```
Set strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` in prod (dev fallbacks exist in `lib/auth.ts`).

## 1. Hosting
- Linux server (VPS/cloud/on-prem), Node 20+, run via Docker or `npm start` behind Nginx.
- Managed or self-hosted PostgreSQL. Use `prisma migrate deploy` (versioned) in prod, not `db push`.
- Domain + TLS (Let's Encrypt/Caddy). Backups, monitoring, log aggregation.

## 2. Real-time presence + live messaging (WebSocket)
Next.js route handlers can't hold sockets. Run a small self-hosted WS server (e.g. `ws`
or Socket.IO) as a sibling service.
- Integration points: chat send already persists via `POST /api/conversations/[peerId]`.
  Emit a socket event to the peer after the DB write; client subscribes and appends.
- Presence: heartbeat over the socket → set `User.online`; the green/grey dot already reads it.
- Env: `WS_URL`. Sticky sessions / shared Redis pub-sub if you scale horizontally.

## 3. Live voice — calls + meeting rooms (media server)
The one piece that genuinely needs infrastructure beyond the API. Use a self-hostable SFU:
**LiveKit** (recommended) or **mediasoup**.
- Meetings: models `Meeting` + `MeetingParticipant` and the REST flow (create/list/join,
  20-seat cap, access grants) are done. Add: on join, mint a LiveKit room token; map the
  UI's audio-state (green talking / red muted / yellow requesting) to LiveKit track state
  and the participant metadata already in the DB.
- Calls: the chat call button is intentionally disabled — wire it to the same SFU.
- Env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## 4. Object storage + CDN (media at scale)
Uploads currently write to `public/uploads` (self-hosted, works on one box).
- For scale: MinIO or any S3-compatible bucket + CDN. Swap the write in `app/api/upload/route.ts`
  for an S3 `putObject` and return the CDN URL. Add image/video transcode + content scan.
- Env: `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `CDN_BASE_URL`.

## 5. Push notifications (background)
In-app notifications + events (new follower / message / ad) are live in the DB.
Background push needs the platform services:
- **APNs** (iOS) + **FCM** (Android/web). Free, but required third parties.
- On each `Notification` create, also send a push to the user's registered device tokens
  (add a `DeviceToken` table + a `/api/push/register` endpoint at that time).

## 6. Mobile packaging (iOS + Android)
- **Capacitor** wraps this web build into native apps: `npx cap add ios android`.
- Native permissions (camera, mic, location, notifications) via Capacitor plugins.
- **Screenshot blocking** (only possible natively): Android `FLAG_SECURE`; iOS capture
  detection → the "tried to screenshot" chat alert is already wired for the detection case.
- Apple Developer + Google Play accounts in the owner's name; store listings + screenshots.

## 7. OTP + Payments — LAST (owner's call)
Kept as dev stubs on purpose so the app stays usable:
- **OTP** is fixed at `1234` (`lib/auth.ts` → `generateOtp`). Swap for SMTP (email) + an SMS
  gateway (phone) at the end; remove the on-screen dev code in prod.
- **Payments** (ads checkout, `$30` premium, meeting per-hour) are fake gateways. Wire
  Apple/Google in-app billing on mobile + a card processor on web. Ad moderation queue also
  goes live here (new ads already auto-activate in dev, stay `pending` in prod).

## 8. Remaining P0 polish
- Rate limiting on auth/OTP/upload/messaging endpoints.
- Privacy Policy + Terms pages (linked from register/settings).
- GDPR: export-my-data + delete-account endpoints.
- Content moderation review UI for reports (the `Report` table is populated; build the queue).
