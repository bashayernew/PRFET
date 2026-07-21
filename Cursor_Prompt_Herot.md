# Cursor prompt — Herot app changes

You are working in the **Herot** repository: a bilingual (Arabic RTL / English LTR) local‑discovery + direct‑messaging + advertising app.

Stack: **Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Prisma + PostgreSQL · framer‑motion · lucide‑react**. Packaged to iOS/Android later with Capacitor. Font: **Cairo**. Backend is **fully in‑house** (no third‑party services): bcrypt password hashing, JWT access + refresh tokens, OTP codes. In development the OTP is fixed at **1234**.

Implement everything below. Match the existing visual style: white screens, deep‑navy brand palette (`brand-600 #282e9e`, `brand-500 #3a41c6`, `brand-50 #eef0fb`, `ink #141a3a`, `muted #6b7194`), rounded‑2xl/3xl cards, navy gradient CTAs, full RTL/LTR support, and the `t()` / `ld()` helpers from `lib/i18n`. Every user‑facing string must exist in both the `ar` and `en` dictionaries.

---

## 1. Prisma schema (`prisma/schema.prisma`)

Use these exact models (PostgreSQL). After editing, run `npm run db:push` to migrate and regenerate the client.

```prisma
model User {
  id            String  @id @default(cuid())
  email         String? @unique
  phone         String? @unique
  contactMethod String  @default("email") // email | phone
  passwordHash  String
  displayName   String  // personal: nickname · business: business name
  accountType   String  @default("personal") // personal | business
  country       String?
  locale        String  @default("ar")
  dateOfBirth   DateTime?           // personal only
  address       String?             // business only
  visibility     String  @default("public")  // public | hidden
  showDistance   Boolean @default(true)
  allowSaveMedia Boolean @default(false)
  showAddress    Boolean @default(true)       // business only
  isVerified Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  otps          OtpCode[]
  refreshTokens RefreshToken[]
  conversations Conversation[]
  follows       Follow[]
  ads           Ad[]
  notifications Notification[]
}

model OtpCode {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash String
  purpose String @default("verify_email") // verify_contact | reset_password
  expiresAt DateTime
  attempts Int @default(0)
  consumedAt DateTime?
  createdAt DateTime @default(now())
  @@index([userId])
}

model RefreshToken {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime @default(now())
  @@index([userId])
}

model Conversation {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  peerId String                 // business / peer id the user chats with
  lastReadAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages Message[]
  @@unique([userId, peerId])
  @@index([userId])
}

model Message {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  fromMe Boolean @default(true) // true = user, false = peer
  kind String @default("text")  // text | image | voice | video | location
  body String
  createdAt DateTime @default(now())
  @@index([conversationId])
}

model Follow {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  targetId String
  createdAt DateTime @default(now())
  @@unique([userId, targetId])
  @@index([userId])
  @@index([targetId])
}

model Ad {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  caption String?
  country String
  durationDays Int
  price Float
  mediaName String?
  mediaUrl String?   // self-hosted upload path, e.g. /uploads/<file>
  status String @default("pending") // pending | active | expired | rejected
  views Int @default(0)
  createdAt DateTime @default(now())
  expiresAt DateTime
  @@index([userId])
  @@index([status])
}

model Notification {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind String          // welcome | ad_review
  data String?         // optional context (e.g. ad caption)
  readAt DateTime?
  createdAt DateTime @default(now())
  @@index([userId])
}
```

## 2. Auth helpers (`lib/auth.ts`)

Keep bcrypt `hashPassword`/`verifyPassword`, `generateOtp` (returns `"1234"` when `NODE_ENV !== "production"`), `sha256`, JWT `signAccessToken`/`signRefreshToken`/`verifyAccessToken`, `bearerFromRequest`. Add:

- `normalizePhone(raw)` — strip spaces/()/-, keep an optional leading `+` and digits.
- `identifierWhere(identifier)` — returns `{ email: lower }` if it contains `@`, else `{ phone: normalizePhone(id) }`.
- `publicUser(u)` — returns id, email, phone, contactMethod, displayName, accountType, country, locale, dateOfBirth, address, visibility, showDistance, allowSaveMedia, showAddress, isVerified.

## 3. Client API helper (`lib/api.ts`)

A single `request(method, path, body?, token?)` wrapper plus: `apiPost(path, body, token?)`, `apiGet(path, token?)`, `apiPatch(path, body, token?)`, `apiDelete(path, token?)`, `apiUpload(path, file, token?)` (multipart `FormData`, no JSON header). Token helpers: `saveTokens`, `getAccessToken`, `clearTokens`. localStorage keys: `herot.access`, `herot.refresh`, `herot.pendingId`, `herot.devCode`, `herot.name`, `herot.accountType`, `herot.country`, `herot.locale`.

## 4. API routes (all in `app/api`, all JSON unless noted, auth via `Authorization: Bearer <access>`)

- `auth/register` **POST** `{ accountType, contactMethod, email?, phone?, password, displayName, dateOfBirth?, address?, country?, locale?, visibility, showDistance, allowSaveMedia, showAddress }` → validate (zod) that the chosen contact field is present/valid; reject duplicate email/phone (409 `identifier_taken`); create the user; **create a `welcome` notification**; create a `verify_contact` OTP; return `{ ok, devCode? }`.
- `auth/verify-otp` **POST** `{ identifier, code }` → find user by `identifierWhere`, check newest unconsumed `verify_contact` OTP (expiry + ≤5 attempts), mark verified, issue tokens, return `{ accessToken, refreshToken, user }`.
- `auth/resend-otp` **POST** `{ identifier }` → new `verify_contact` OTP (always return ok; include `devCode` in dev).
- `auth/login` **POST** `{ identifier, password }` → verify bcrypt; issue tokens; `{ accessToken, refreshToken, user }`.
- `auth/me` **GET** → current `publicUser`. **PATCH** `{ displayName?, visibility?, showDistance?, allowSaveMedia?, showAddress?, locale? }` → update + return user.
- `auth/forgot` **POST** `{ identifier }` → issue `reset_password` OTP (don't leak existence; `devCode` in dev).
- `auth/reset` **POST** `{ identifier, code, password }` → verify `reset_password` OTP, set new `passwordHash`, revoke all active refresh tokens.
- `conversations` **GET** → user's conversations newest‑first: `{ peerId, lastBody, lastKind, lastAt, lastFromMe, unread }`.
- `conversations/[peerId]` **GET** → upsert the conversation, return messages asc, set `lastReadAt = now`. **POST** `{ body, kind? }` → append `fromMe:true` message, bump `updatedAt`.
- `follow/[targetId]` **GET** `{ following, followers }` · **POST** follow (upsert) · **DELETE** unfollow. All return `{ following, followers }`.
- `ads` **GET** → user's ads `{ id, caption, country, durationDays, price, mediaUrl, status, views, advertiser, createdAt, expiresAt }`. **POST** `{ country, durationDays(1|2|3|7|14), caption?, mediaName?, mediaUrl? }` → server recomputes `price = days * 1.5` and `expiresAt`, status `pending`; **create an `ad_review` notification**; return `{ id, price, status }`.
- `upload` **POST** (multipart, `runtime = "nodejs"`) → auth required; accept image/* or video/* ≤20 MB; write to `public/uploads/<uuid>.<ext>`; return `{ url: "/uploads/<file>", name, type }`.
- `notifications` **GET** `{ unread, notifications:[{ id, kind, data, read, createdAt }] }` · **POST** → mark all read.

Every protected route returns 401 when the bearer token is missing/invalid.

## 5. Screens & pages (`components/*-screen.tsx` rendered by `app/*/page.tsx`)

- **register-screen** — branch on `herot.accountType`. Personal: nickname + date of birth. Business: business name + address. Both: an **Email / Phone segmented switch** with the matching input, a password field, a **Privacy & preferences** panel (Personal: Public/Hidden visibility segmented; both: *Show distance* (default on), *Allow saving photos & videos* (default off); Business: *Show address* (default on)), and a terms checkbox. On submit POST `auth/register`, store `herot.pendingId` + name + devCode, go to `/verify`.
- **verify-screen** — 4‑box OTP keyed by `herot.pendingId`; shows the dev code; resend timer; POST `auth/verify-otp`; on success save tokens → `/home`.
- **login-screen** — single **email‑or‑phone** field + password; "Forgot password?" → `/forgot`; "Create account" → `/account-type`.
- **forgot-screen** (`/forgot`) — step 1: identifier → POST `auth/forgot`; step 2: 4‑box code + new password → POST `auth/reset`; step 3: success → back to login.
- **profile-screen** (`/profile`) — navy header with avatar initial, display name, account‑type pill, country chip. Cards: **Account** (inline‑editable display name → PATCH `me` + update `herot.name`; contact; country), **Language** (AR/EN segmented → `setLocale` + PATCH `me`), **Privacy & preferences** (toggles persisted via PATCH `me`), then a red **Log out** (clear tokens → `/`). Show a transient "Saved" toast after PATCH.
- **discover-screen** (`/discover`) — search box + horizontally scrolling category chips ("All" + categories) + results from `lib/data` `BUSINESSES`, sorted nearest‑first, with online dot, distance, rating; empty state.
- **ads-screen** (`/ads`) — **feed mode**: "Create an ad" CTA, a **Your ads** section (real ads from GET `ads`, status badge Pending/Active, image banner if `mediaUrl`), then a seed "Today's ads" list. **create mode**: optional ad‑text, target‑country chips, duration tiles (1/2/3/7/14), upload dropzone (real `<input type=file>`), live summary, "Pay & publish" → upload the file via `apiUpload('/api/upload')` then POST `ads`, success toast, refetch.
- **messages-screen** (`/messages`) — list from GET `conversations`, each mapped to its business via `getBusiness(peerId)`; preview, time (today→HH:MM else d/m), unread badge; search by name; empty state.
- **chat-screen** (`/messages/[id]`) — peer header from `getBusiness(id)`; load thread from GET `conversations/[id]`; optimistic send via POST; empty "Start the conversation" state.
- **merchant-screen** (`/business/[id]`) — heart + Follow button and follower count wired to `/api/follow/[id]` (load status on mount, optimistic toggle, count = base + (following?1:0)); Message button → `/messages/[id]`.
- **notifications-screen** (`/notifications`) — list from GET `notifications`, rendered **by kind** through i18n (welcome / ad_review icons + titles + bodies), unread highlight, mark‑all‑read on open, empty state.
- **home-screen** — bell icon opens `/notifications` and shows the red dot only when GET `notifications` reports `unread > 0`.
- **bottom-nav** — tabs Home / Discover / Messages / Ads / Profile.

## 6. i18n (`lib/i18n.tsx`)

Maintain parallel `ar` and `en` dictionaries with key groups: `welcome.*, account.*, country.*, register.* (incl. nickname, dob, businessName, address, contactMethod, phone, privacy/visibility/distance/media/showAddress, identifierTaken), verify.*, login.* (identifier), profile.*, discover.*, ads.* (incl. text, yourAds, pending, active), chat.*, forgot.*, notif.*, merchant.*, messages.*, nav.*, home.*, cat.*, common.*`. `setLocale` writes `herot.locale` and flips `<html dir>`; `ld()` converts digits to Arabic‑Indic for `ar`.

## 7. Misc

- `.gitignore`: add `/public/uploads/`.
- Keep `public/uploads/` as the self‑hosted media store (works with `next dev` / `next start`; for production use a persistent disk or self‑hosted object storage — not a serverless host).

## 8. Run

```bash
npm install
docker compose up -d        # PostgreSQL
npm run db:push             # create tables + regenerate Prisma client
npm run dev                 # http://localhost:3000
```

Sign‑up flow: language → account type → country → register (email **or** phone) → verify with **1234** → home. Forgot password and the in‑app settings/ads/follows/notifications all persist to PostgreSQL.

> Note: until `npm run db:push` (or `prisma generate`) runs, TypeScript will report errors in the API routes because the generated Prisma client won't yet know the new models/fields. Running it resolves them.
