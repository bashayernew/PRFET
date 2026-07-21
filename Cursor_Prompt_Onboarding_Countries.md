# Cursor prompt — collapse onboarding + full Arab country list

You are in the **Herot** Next.js 15 / TypeScript / Tailwind app (bilingual Arabic RTL / English LTR, brand navy `#282e9e`, font Cairo, helpers `t()` / `ld()` from `lib/i18n`). Apply the two changes below exactly as the client requested in their registration doc ("الصفحة الرئيسية = اختيار اللغة + نوع الحساب" and "دول الخليج + جميع الدول العربية").

## Change 1 — Entry screen = language + account type (remove the separate account-type step)

The first screen (`/`) must let the user pick **language** and **account type** together, then go straight to country selection. Remove the standalone account-type screen.

- **Rewrite `components/welcome-screen.tsx`** to a single clean screen (no marketing hero / floating cards):
  - Brand block: logo tile (`MapPin` + small `MessageCircle` badge), `Herot` / `هيروت`, then the tagline `t("welcome.tagline")`.
  - "Choose your language" (`t("welcome.chooseLang")`) → two cards calling `setLocale("ar"|"en")` (active = current `locale`).
  - Account-type heading `t("account.title")` → two selectable cards (Personal `User` / Business `Store`) using `account.personal.title|sub` and `account.business.title|sub`; local `useState<"personal"|"business"|null>`.
  - Continue button (`t("welcome.getStarted")`), disabled until an account type is chosen; on click `localStorage.setItem("herot.accountType", account)` then `router.push("/country")`.
  - Footer: `t("welcome.haveAccount")` + link to `/login`.
- **Set the tagline** in `lib/i18n.tsx`: `welcome.tagline` → `ar: "تواصل مع من حولك"`, `en: "Connect with those around you"` (this phrase must stay in the app).
- **Delete** `app/account-type/page.tsx` and `components/account-type-screen.tsx` (remove the `/account-type` route).
- **Rewire the now-removed route** everywhere it was referenced:
  - `components/country-screen.tsx` back button → `router.push("/")`.
  - `components/login-screen.tsx` "Create account" link → `router.push("/")`.
- **Renumber the step indicator** (now 3 steps: country → register → verify):
  - country: 3 progress bars (1 filled), label `{ld(1, locale)} / {ld(3, locale)}`.
  - register: 3 bars (2 filled), `{ld(2, locale)} / {ld(3, locale)}`.
  - verify: 3 bars (3 filled), `{ld(3, locale)} / {ld(3, locale)}`.
- Keep the existing flow order: `/` (language + type) → `/country` → `/register` → `/verify`. `herot.accountType` is read by the register screen as before.

## Change 2 — Full Gulf + all Arab countries (single shared list)

Replace the ad‑hoc country lists with one shared source containing the **22 Arab League countries**, Gulf states first.

- **Create `lib/countries.ts`:**

```ts
export type Country = { code: string; ar: string; en: string; flag: string };

// Gulf states first (suggested), then the rest of the Arab League — 22 total.
export const COUNTRIES: Country[] = [
  { code: "SA", ar: "السعودية", en: "Saudi Arabia", flag: "🇸🇦" },
  { code: "AE", ar: "الإمارات", en: "United Arab Emirates", flag: "🇦🇪" },
  { code: "KW", ar: "الكويت", en: "Kuwait", flag: "🇰🇼" },
  { code: "QA", ar: "قطر", en: "Qatar", flag: "🇶🇦" },
  { code: "BH", ar: "البحرين", en: "Bahrain", flag: "🇧🇭" },
  { code: "OM", ar: "عُمان", en: "Oman", flag: "🇴🇲" },
  { code: "EG", ar: "مصر", en: "Egypt", flag: "🇪🇬" },
  { code: "JO", ar: "الأردن", en: "Jordan", flag: "🇯🇴" },
  { code: "LB", ar: "لبنان", en: "Lebanon", flag: "🇱🇧" },
  { code: "SY", ar: "سوريا", en: "Syria", flag: "🇸🇾" },
  { code: "IQ", ar: "العراق", en: "Iraq", flag: "🇮🇶" },
  { code: "PS", ar: "فلسطين", en: "Palestine", flag: "🇵🇸" },
  { code: "YE", ar: "اليمن", en: "Yemen", flag: "🇾🇪" },
  { code: "SD", ar: "السودان", en: "Sudan", flag: "🇸🇩" },
  { code: "LY", ar: "ليبيا", en: "Libya", flag: "🇱🇾" },
  { code: "TN", ar: "تونس", en: "Tunisia", flag: "🇹🇳" },
  { code: "DZ", ar: "الجزائر", en: "Algeria", flag: "🇩🇿" },
  { code: "MA", ar: "المغرب", en: "Morocco", flag: "🇲🇦" },
  { code: "MR", ar: "موريتانيا", en: "Mauritania", flag: "🇲🇷" },
  { code: "SO", ar: "الصومال", en: "Somalia", flag: "🇸🇴" },
  { code: "DJ", ar: "جيبوتي", en: "Djibouti", flag: "🇩🇯" },
  { code: "KM", ar: "جزر القمر", en: "Comoros", flag: "🇰🇲" },
];

export const getCountry = (code?: string | null): Country | undefined =>
  COUNTRIES.find((c) => c.code === code);
```

- **`components/country-screen.tsx`** — import `COUNTRIES` from `@/lib/countries` (delete the local list/type); keep the searchable picker (filter by `c.ar`/`c.en`), default `"SA"`, store `herot.country`, continue → `/register`.
- **`components/ads-screen.tsx`** — delete its local `COUNTRIES` and import the shared one (used for the ad target‑country chips). Same `{ code, ar, en, flag }` shape, so no other change.
- **`components/profile-screen.tsx`** — delete the local `COUNTRY_NAMES` map; `import { getCountry } from "@/lib/countries"` and use `const country = getCountry(me?.country)` for the country chip (`country?.flag`, `country?.[locale]`).

## Verify

`npx tsc --noEmit` should report no errors in `components/**` or `lib/**`. If the generated Prisma client shows errors, run `npx prisma generate` (and `npm run db:push` with Postgres up) — that's the client, not source.
