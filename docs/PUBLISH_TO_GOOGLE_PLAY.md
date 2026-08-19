# PRFET — Publishing to Google Play (step by step)

Your app is a **server-backed Next.js app** running at https://prfet.com. So the Android app
is a **Capacitor** shell that loads your live site in a native WebView and adds native
capabilities (Bluetooth/BLE, camera, mic, location, push). This keeps every server feature
working and gives Google Play the "native value" it wants (not just a bare webview).

Everything below runs on your **Windows PC** (not the server).

---

## ⚠️ Two things that WILL get you rejected — read first

1. **In-app payments must use Google Play Billing.** Google does not allow FastSpring (or any
   outside processor) for digital subscriptions bought *inside* the Android app. For the Play
   build you must either (a) integrate **Google Play Billing** for Golden/VIP, or (b) **remove
   all subscribe/buy buttons** from the app and let users subscribe on the website only. Simplest
   first launch: hide the purchase buttons in the app. (We can gate them so they only show on web.)
2. **Target API level 36 (Android 16).** As of Aug 31, 2026 all new apps must target API 36.
   Build against it from the start.

Also budget time: **new personal developer accounts must run a closed test with 12 testers for
14 continuous days** before you can go to production.

---

## Phase 0 — Install the tools (one time)
- Install **Android Studio** (includes the Android SDK): https://developer.android.com/studio
- During first launch, let it install the SDK + an Android 16 (API 36) platform.
- You already have Node.js.

## Phase 1 — Add Capacitor to the project
In PowerShell, from `D:\app`:
```powershell
npm install @capacitor/core @capacitor/cli
npx cap init "PRFET" "com.prfet.app" --web-dir=public
```
- App name: **PRFET**, App ID: **com.prfet.app** (this is permanent — choose carefully).

Then create/confirm `capacitor.config.ts` so the app loads your live site:
```ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.prfet.app',
  appName: 'PRFET',
  webDir: 'public',
  server: { url: 'https://prfet.com', cleartext: false },
};
export default config;
```

Add the Android project:
```powershell
npm install @capacitor/android
npx cap add android
npx cap sync
```

## Phase 2 — Native permissions + plugins
Install the plugins your app uses:
```powershell
npm install @capacitor/camera @capacitor/geolocation @capacitor/push-notifications
npm install @capacitor-community/bluetooth-le
npx cap sync
```
Then in `android/app/src/main/AndroidManifest.xml` add the permissions:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```
(The BLE bridge you already scaffolded — `window.PrfetNative` / `window.__prfetBleFound` — gets
wired to the `@capacitor-community/bluetooth-le` plugin here.)

## Phase 3 — Target API 36, app icon, version
- Open `android/` in **Android Studio** (`npx cap open android`).
- In `android/app/build.gradle` set `compileSdk 36` and `targetSdk 36`, `minSdk 24`.
- Set `versionCode 1` and `versionName "1.0.0"`.
- Right-click `res` → **New → Image Asset** to generate the launcher icon from your PRFET logo.

## Phase 4 — Handle payments (from the warning above)
Before building, make the app hide in-app purchase buttons (or wire Play Billing). Tell me and
I'll add a "running inside the native app" flag that hides the Golden/VIP/add-on buy buttons so
the Play build is compliant, while the website keeps FastSpring.

## Phase 5 — Build a signed release (AAB)
Play requires an **Android App Bundle (.aab)**, not an APK.
- In Android Studio: **Build → Generate Signed App Bundle / APK → Android App Bundle**.
- Create a new **keystore** (e.g. `prfet-release.jks`), set a strong password, fill the fields.
- **Back up that keystore file + passwords somewhere safe** — losing it means you can never update
  the app again.
- Choose **release**, finish. You get `app-release.aab`.

## Phase 6 — Create the Play Console account + app
- Go to https://play.google.com/console → pay the **one-time $25** fee, verify your identity.
- **Create app** → name **PRFET**, language, "App", "Free".

## Phase 7 — Required listing + policy items
Fill these in the Console (Play reviews them):
- **Privacy policy URL**: https://prfet.com/privacy
- **Terms**: https://prfet.com/terms (and your refund page when ready)
- **Data safety form**: declare what you collect — email, location, Bluetooth, photos, messages,
  and that data is encrypted in transit.
- **Content rating** questionnaire → expect **Mature 17/18+** (social app, user content, live
  streaming, stranger contact). Show your **report + block + moderation** features.
- **Store listing**: short + full description (AR + EN), app icon (512×512), feature graphic
  (1024×500), and at least **2–8 phone screenshots**.
- **App category**: Social.

## Phase 8 — Closed testing (the 14-day gate)
- Create a **Closed testing** track → upload your `app-release.aab`.
- Add **at least 12 testers** by email (friends, or a paid tester service), share the opt-in link.
- They must **stay opted in for 14 continuous days**. Fix any crashes they report.

## Phase 9 — Production
- After 14 days with 12 testers, apply for **production access**.
- Move the release to the **Production** track, submit for review (can take a few days).
- Once approved, PRFET is live on Google Play. 🎉

---

## Update workflow (later)
When you change the app: bump `versionCode`, rebuild the signed AAB with the **same keystore**,
upload a new release. Because the app loads prfet.com, most content/feature changes ship just by
deploying the website — no new AAB needed unless you change native code, permissions, or the icon.
