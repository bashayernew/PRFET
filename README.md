# Herot · هيروت

Discover and connect with what's around you — a local discovery + messaging app.
Built with **Next.js 15 + React 19 + Tailwind v4**, mobile-first and RTL Arabic.
One codebase → **web, iOS, and Android** (via Capacitor).

---

## 1. Run it on your computer

Open this folder in VS Code, then in the terminal:

```bash
npm install        # one time — downloads dependencies
npm run dev        # starts the app
```

Open **http://localhost:3000** in your browser.

## 2. See it as a phone (mobile preview)

In the browser, open DevTools (press **F12**) → click the **device toolbar** icon
(phone/tablet icon, or Ctrl+Shift+M) → pick **iPhone** or any phone size.
The welcome screen is designed for that width.

You can also open `http://<your-computer-ip>:3000` on your actual phone
(same Wi-Fi) to try it live.

## 3. Make it a real iOS / Android app (when ready)

The project is Capacitor-ready. Later, to ship to the App Store / Play Store:

```bash
npm install @capacitor/core @capacitor/cli
npx cap init Herot com.herot.app
# in next.config.ts: uncomment  output: "export"
npm run build                 # produces the /out folder
npx cap add ios               # needs a Mac + Xcode
npx cap add android           # needs Android Studio
npx cap copy
npx cap open android          # or: npx cap open ios
```

That wraps the *same* code into native apps — no rewrite.

---

## What's built so far

- `app/page.tsx` — phone-width app shell
- `components/welcome-screen.tsx` — **screen 1: welcome + language select** (done)
- `app/globals.css` — Herot design tokens (brand colors, fonts, animations)
- `app/layout.tsx` — RTL, Cairo font, PWA metadata
- `public/manifest.json` — installable PWA config

### Next screens (planned, in order)
account type → country → register → OTP verify → home/discovery → search → merchant profile → chat → settings

> Note: app icons (`public/icon-192.png`, `icon-512.png`) are referenced by the
> manifest but not yet added — drop in a logo PNG when you have one.
