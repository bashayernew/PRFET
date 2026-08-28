# Herot — Publish to Android & iOS (Capacitor)

## The concept (important)
Herot is a **server-rendered** app (Next.js API routes + Postgres). You do **not** bundle the whole
app inside the phone. Instead:

1. You host the app on a server (Railway/Render/VPS) → you get a URL like `https://herot.app`.
2. **Capacitor** wraps that in a thin native app for iOS and Android that loads your hosted URL and
   adds native powers (camera, mic, GPS, push, screenshot control).
3. You submit those native apps to the App Store and Google Play.

So: **host first, then wrap.** `capacitor.config.ts` is already added — just change `server.url` to
your real hosted URL.

## What you need
- **Android:** Android Studio (Windows/Mac/Linux) + a Google Play Console account (**$25 one-time**).
- **iOS:** a **Mac** with Xcode + an Apple Developer account (**$99/year**). iOS builds *cannot* be
  made on Windows — this is Apple's rule, not ours. (Options if you have no Mac: a cloud Mac service
  like MacinCloud, or a CI service like Codemagic/EAS that provides Mac build machines.)

## One-time setup
From the project folder, after your server is live and `server.url` is set:
```
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init Herot com.prfet.app        # if not already initialized
npx cap add android
npx cap add ios                          # Mac only
npx cap sync
```

## Build & run
- **Android:** `npx cap open android` → Android Studio opens → Run on a device, or
  Build → Generate Signed Bundle (`.aab`) for the Play Store.
- **iOS:** `npx cap open ios` → Xcode opens → set your Team/signing → Run on a device, or
  Product → Archive → upload to App Store Connect.

After any change to `server.url` or native config: `npx cap sync` again.

## Native plugins to add (also helps store approval)
A pure "website in a box" can get **rejected** (Apple guideline 4.2 "minimum functionality").
Wire real native features so it behaves like an app:
```
npm install @capacitor/push-notifications @capacitor/geolocation @capacitor/camera @capacitor/share
```
- **Push** (`@capacitor/push-notifications`) → APNs (iOS) + FCM (Android). Register the device token
  to a `/api/push/register` endpoint and send on each `Notification` (see `docs/DEPLOYMENT.md §5`).
- **Geolocation** → real distance + precise-location sharing.
- **Camera / mic** → native capture for stories, reels, chat media, meeting audio.
- **Screenshot blocking** → Android `FLAG_SECURE` on view-once media; iOS screenshot detection →
  the "tried to screenshot" chat alert is already wired to fire on detection.

## Store submission checklist
- App icons + splash screens (Capacitor: `@capacitor/assets` generates them from one source image).
- Privacy Policy + Terms URLs (required by both stores — add the pages first).
- Store listing: screenshots, description, category, age rating, data-safety / privacy-nutrition form.
- **Payments:** digital goods (premium, ads, paid meetings) must use Apple/Google in-app billing in
  the store apps — wire this before submitting a paid build (it's your "last" item).
- **OTP:** replace the dev `1234` with real email/SMS before a public store release (fine for TestFlight
  / Play internal testing).

## Faster tester path (before the stores)
- **Android:** build a signed `.aab`/`.apk` and share it, or use **Play Console → Internal testing**
  (testers install via a link).
- **iOS:** use **TestFlight** (upload the archive in App Store Connect, invite testers by email).
Both let real users test the native app without a full public release — and OTP `1234` still works.

---

## Building from Windows (you have no Mac)

### Android — 100% on Windows ✅
1. Install **Android Studio** (Windows).
2. `npx cap add android` → `npx cap sync` → `npx cap open android`.
3. In Android Studio: **Build → Generate Signed Bundle** → create a keystore (keep it safe!) → get an `.aab`.
4. **Google Play Console** ($25 one-time, sign up in a browser) → create app → upload the `.aab` →
   fill the listing → **Internal testing** for testers, then **Production** to go public.

### iOS — you can't build it on Windows, but you don't need to own a Mac
Apple requires macOS + Xcode to compile/sign/upload iOS apps. From Windows, pick one:

- **Cloud CI build (recommended, no Mac at all): [Codemagic](https://codemagic.io)** — made for
  Capacitor. You connect your repo, it builds and **signs the iOS app on Apple machines in the cloud**
  and uploads it straight to App Store Connect / TestFlight. Free tier is enough to start. This is the
  normal path for Windows developers.
  - Alternative: **Ionic Appflow** (by the Capacitor makers) — same idea.
- **Rent a Mac:** MacinCloud / MacStadium / AWS EC2 Mac — remote-desktop into a real Mac, run Xcode.
- **Buy/borrow:** a cheap used Mac Mini also does it.

Everything else for iOS is **browser-based and works on Windows**:
- **Apple Developer Program** ($99/year) — enroll at developer.apple.com from any browser.
- **App Store Connect** (browser) — create the app, manage the listing, invite **TestFlight** testers,
  and submit for review.

### The Windows-only iOS flow, end to end
1. Enroll in Apple Developer ($99/yr) — browser.
2. Push the project to GitHub.
3. Connect the repo to **Codemagic**, give it your Apple account (it manages signing automatically).
4. Codemagic builds + uploads to **App Store Connect** → **TestFlight** (testers install via email
   invite) → submit for App Store review.

So: **Android via Android Studio on your PC; iOS via Codemagic (cloud) + the Apple browser tools.**
No Mac purchase required.

---

## Screenshot blocking (native — already wired)
The app includes `@capacitor-community/privacy-screen`. When a chat is in **view-once** mode, the
app calls it to turn on protection:
- **Android:** sets `FLAG_SECURE` → screenshots and screen-recording are actually blocked, and the
  app is hidden in the recent-apps switcher.
- **iOS:** Apple does not allow true blocking; the plugin hides the screen from the app-switcher and
  the in-app **screenshot-detection → chat alert** still fires.

Nothing extra to configure — `npx cap sync` picks up the plugin automatically after `npm install`.
On the web it's a no-op (browsers can't block screenshots).
