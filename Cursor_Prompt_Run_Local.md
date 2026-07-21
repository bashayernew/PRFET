# Cursor prompt — run Herot locally so I can test everything

Paste everything below into Cursor (Agent mode) and let it run.

---

You are working in my Herot project (Next.js 15 + Prisma + PostgreSQL). Get the app running
locally on Windows so I can test it in the browser. Do this step by step, and if a command
fails, read the error, fix it, and continue. Report what you did at the end.

## 1. Start the database
- Make sure Docker Desktop is running.
- Start Postgres: `docker compose up -d`
  - This runs Postgres on port 5433 (see `docker-compose.yml`).
  - If port 5433 is already in use, tell me; don't change it without asking.
- Confirm `.env` has `DATABASE_URL="postgresql://herot:herot_dev_password@localhost:5433/herot?schema=public"`
  (copy from `.env.example` if `.env` is missing).

## 2. Install + set up the database
Run in order:
- `npm install`
- `npx prisma generate`   (regenerates the Prisma client — this clears the "type" errors on the API routes)
- `npm run db:push`        (creates ALL tables incl. the new ones: mediaUrl on messages, Block, Report,
                            Story, StoryView, Job, Meeting, MeetingParticipant, profileViews, etc.)
- `npm run db:seed`        (adds the 5 sample businesses as REAL accounts so the app isn't empty)

## 3. Run it
- `npm run dev`
- Open http://localhost:3000
- Hard-reload the page (Ctrl+Shift+R) to clear any old cached session.

## 4. Verify the build is healthy
- `npx tsc --noEmit` should have NO errors after `prisma generate`. If any remain, fix them.
- Confirm the app compiles and the home page loads without red errors in the browser console
  (the old `icon-192` 404s should be gone — the icons now exist in `public/`).

## 5. Tell me it's ready
When done, print: the local URL, confirmation that db:push + db:seed ran, and that OTP is `1234`.

---

## How I'll test (for my reference — you don't need to do this, Cursor)
Log in using code **1234**. Then try:
- Register (personal + business), login, forgot password.
- Discover → search a business (e.g. "حلويات") → open a profile → follow.
- Chat: send text, send an image/video, share location, record a voice note; open the ⋮ menu →
  save-media / view-once / report / block.
- Post a story from the home "+" avatar, then view it.
- Home boxes: Ads, Jobs (post a job as a business), Meetings (create a room), Top viewed, Reels feed.
- Profile: edit fields, premium/subscribe (fake), logout.

## Notes for the LOCAL test (real-time is now built)
- `npm run dev` now starts the **real-time server** (`node server.js`). The `npm install` step
  above pulls the new packages (socket.io, web-push, livekit) — required. If the realtime server
  ever misbehaves, `npm run dev:next` runs the plain app without it.
- **Live chat + presence WORK locally** (two browser profiles logged in as two users can chat live).
- **1:1 calls** work on the same network (STUN). Across mobile networks they need the TURN server
  (only on the deployed VPS).
- **Meeting group audio** and **web push** only activate once LiveKit / VAPID env vars are set on
  the server — locally they stay off (the meeting UI still works).
- **Screenshot-blocking** is native-only (never in a browser).
- **Voice notes** record on Chrome; may be flaky on iOS Safari.
