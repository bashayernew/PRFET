# Cursor Prompt — Herot: profile/chat/meetings/feed + real-data foundation

Paste this into Cursor as the task description. It captures the batch of changes to apply/verify. Stack: Next.js 15 App Router, React 19, TS, Tailwind v4, framer-motion, lucide-react, Prisma + PostgreSQL. Bilingual ar (RTL) / en (LTR) via `lib/i18n.tsx`.

## 1. Account / merchant profile page (`components/merchant-screen.tsx`)
Redesign the account page:
- Avatar in the top corner; pressing it opens the user's **story** (`/story/[id]`) when `hasStory` — glowing ring (gold if premium, brand→accent otherwise).
- Show **gender** and **nationality** chips under the name (nationality via `getCountry(code)` flag + localized name).
- Keep **distance** as a stat (km).
- **Precise-location pin** button with 3 states: silver = not subscribed, red = subscribed but location off, green = subscribed + sharing (green opens Google Maps at lat/lng).
- **Follow + Message as two side-by-side boxes** (grid-cols-2). Remove the old single follow button + bottom sticky message bar.
- **VIP gold treatment** when `isPremium`: gold card ring, gold VIP badge by the name, gold buttons.
- **Posts section**: a "spot for video & images" gallery grid (video tile + image tiles + an add-post tile) for every account type.
- **Remove the details block** (address / phone / open-hours).

## 2. Chat (`components/chat-screen.tsx`)
- The **+** opens an attach sheet: **image / video / location**.
- Dedicated **mic/voice** button (replaces Send when the input is empty).
- **Call button is disabled/gray** (shows a "not available yet" toast).
- **Three-dots → chat settings sheet**: allow saving my photos/videos; **keep-media-after-view** toggle (off = **view-once** mode); **report**; **block** (with blocked banner + disabled send).
- In view-once mode, a **screenshot attempt** (PrintScreen / capture shortcuts) posts a system alert message into the chat ("the other person tried to screenshot your media"). NOTE: true blocking needs the native wrapper (Android FLAG_SECURE / iOS detection) — this is best-effort on web.

## 3. Meetings (paid audio rooms, max 20)
- New home box **"الغرف / Rooms"** (home strip is now 6 boxes, 2 rows) → `/meetings`.
- `components/meetings-screen.tsx`: live-rooms list + **Create room**.
- `components/meeting-create-screen.tsx`: name, duration (per-hour, `PRICE_PER_HOUR=5`), seat count capped at **20**, default access toggles (audio/text/video), running total.
- `components/meeting-room-screen.tsx`: participant grid with **audio-state rings — green=talking, red=muted, yellow=requesting**. Admin taps a person → access sheet (audio/text/video grants, allow-to-talk, block from room). Self controls: mic mute/unmute, raise hand, video, leave.
- Prisma models `Meeting` + `MeetingParticipant` added (inert until wired). Live voice needs a media server (go-live).

## 4. Discover (`components/discover-screen.tsx`) — search-driven + real data
- **Empty by default**: no results/distance bar until the user types. Empty-state prompt to search.
- Search now hits **`GET /api/users?q=`** (the real DB directory), with loading state; filters client-side by the distance slider.

## 5. Reels video feed (`components/feed-screen.tsx`, `/feed`)
- Instagram-style **vertical snap scroller**; each item full-screen.
- **A paid ad after every 4 videos** (tagged Sponsored).
- **If the user follows no one, only ads show** (+ a "find people" prompt).
- Home's old "nearby" list replaced by a horizontal **Reels preview** row → `/feed`.

## 6. Real-data foundation (the important part)
- **`prisma/schema.prisma`** — `User` gains discovery fields: `category String?`, `bio String?`, `rating Float?`, `reviews Int @default(0)`, `online Boolean @default(false)` (plus the earlier `nationality`, `gender`).
- **`prisma/seed.mjs`** — upserts the 5 sample businesses as **real business `User` accounts** (ids "1".."5") with category/bio/rating/coords/premium. Script: `npm run db:seed`.
- **`app/api/users/route.ts`** — `GET /api/users?q=` public directory: filter `accountType=business`, `visibility=public`, name search, order by rating, haversine distance from a Riyadh origin (stand-in until real geo).
- **`app/api/users/[id]/route.ts`** — `GET` one public account.

## Run / verify
```
npm run db:push      # apply schema
npm run db:seed      # seed businesses as real accounts
npm run dev          # then hard-reload
```
Typecheck: `npx tsc --noEmit` — the only expected errors are in `app/api/**` referencing the new Prisma fields; they clear after `prisma generate` (runs on `db:push`/`build`).

## Deferred to LAST (owner's call)
Real **OTP delivery** (still dev code `1234`) and **all payments** (ads/premium/meeting billing are fake gateways). Keep them as-is until the end. Full backlog in `docs/GO_LIVE_CHECKLIST.md`.
