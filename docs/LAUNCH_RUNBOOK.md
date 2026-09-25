# PRFET — launch runbook (written 2026-09-25)

From today's state to public on Google Play, with payments working.

**Where you are now:** production access granted · closed test running (13 testers) ·
versionCode 9 uploaded but rejected on two errors · Capacitor 7 + RevenueCat 11 set in
`package.json` but not yet installed · no subscriptions exist in Play yet.

**The ordering trap:** Play will not let you create subscription products until a build
containing the **Play Billing Library** has been uploaded. And Google now requires Billing
**8.0.0+**, which needs RevenueCat plugin v11, which needs Capacitor 7. So the code upgrade
comes first, then products, then the key, then release. Doing it in any other order means
going backwards.

---

## Phase 0 — merchant profile (do this first, it's the only step that can take days)

Play Console → **حساب المطوّر (Developer account)** → payment settings.

- [ ] A Google payments merchant profile exists and is **active**
- [ ] A bank account is attached and verified

Google verifies business details and bank ownership. Nothing below can earn money until
this is approved, so start it before anything else.

---

## Phase 1 — build with Billing 8

On Windows:

```powershell
cd D:\app
npm install
npx cap sync android
```

If `npm install` fails on peer dependencies, read the error before reaching for
`--legacy-peer-deps` — a real incompatibility is worth knowing about.

Then Android Studio → **File → Sync Project with Gradle Files**.

Confirm the version (Play rejects duplicates; 8 and 9 are both used):

```powershell
Select-String -Path D:\app\android\app\build.gradle -Pattern "versionCode|versionName"
```

Should read `versionCode 10` / `versionName "1.0.8"`.

**Build → Generate Signed App Bundle / APK → Android App Bundle**, keystore
`prfet-release.jks`, variant **release**.

Verify Billing actually made it in:

```powershell
Select-String -Path D:\app\android\app\build\intermediates\merged_manifests\release\AndroidManifest.xml -Pattern "BILLING"
```

- [ ] `com.android.vending.BILLING` is present

Upload to **الاختبار المغلق (closed testing)** — *not* production. This registers Billing
with Play without committing to a public release.

- [ ] Closed-test release with versionCode 10 is live

---

## Phase 2 — create the products

Play Console → **تحقيق الربح → المنتجات → الاشتراكات**. It should now let you create
products instead of asking for an APK.

Create two. **The IDs must match exactly** — `lib/iap-products.ts` looks them up by string:

| Product ID | Plan | Price |
|---|---|---|
| `prfet_basic_1m` | Golden, monthly auto-renewing | $5.99 |
| `prfet_vip_1m` | VIP, monthly auto-renewing | $10.99 |

Each needs a base plan (monthly, auto-renewing), a price, and its countries.

- [ ] Both exist
- [ ] Both say **Active**, not Draft — a draft product is invisible to the app

---

## Phase 3 — RevenueCat

**3a. Service account (Play Console side)**
Play Console → **Setup → API access** → link a Google Cloud project → create a service
account → grant **Financial data / Manage orders and subscriptions** → download the JSON.

**3b. RevenueCat** (app.revenuecat.com, project **PRFET**)

- [ ] **Apps** → the Android app is **Google Play** (not Test Store), package
      **`com.herot.app`**, service-account JSON uploaded, credentials show valid
- [ ] **Products** → `prfet_basic_1m` and `prfet_vip_1m` imported from Play
- [ ] **Entitlements** → exactly **`basic`** and **`vip`**, lowercase, each attached to its
      product. `tierFromEntitlements` matches those strings literally — "PRFET Pro" grants
      nothing.
- [ ] **API keys** → copy the **Android** public SDK key (starts `goog_`)
- [ ] **Webhook** → `https://prfet.com/api/webhooks/revenuecat`, with the authorization
      header value matching `REVENUECAT_WEBHOOK_AUTH` in the server `.env`

The webhook is what actually grants premium. The client's purchase claim is ignored by
design, so a broken webhook means people pay and get nothing.

**3c. Real-time notifications (optional but worth it)**
RevenueCat gives you a Pub/Sub topic name. Paste it into Play Console →
**تحقيق الربح → إعدادات (Monetization setup)** → Real-time developer notifications →
tick **Enable instant notifications**. Without it, renewals and cancellations arrive
minutes late instead of instantly.

---

## Phase 4 — put the key on the server

```bash
cd ~/app/deploy
cp .env ~/env-backup-$(date +%F-%H%M)
sed -i '/^NEXT_PUBLIC_REVENUECAT_ANDROID_KEY=/d' .env
printf '\nNEXT_PUBLIC_REVENUECAT_ANDROID_KEY=goog_YOUR_KEY_HERE\n' >> .env
grep -n 'REVENUECAT' .env
```

`NEXT_PUBLIC_*` is compiled into the bundle, so this needs a **full rebuild**, not a restart:

```bash
cd ~/app && git pull && cd deploy && docker compose up -d --build --force-recreate
curl -s https://prfet.com/api/health
```

- [ ] `/api/health` returns `{"ok":true,...}`
- [ ] `REVENUECAT_WEBHOOK_AUTH` is set and matches RevenueCat

---

## Phase 5 — test a real purchase

Play Console → **Setup → License testing** → add your Google account. License testers buy
with a test card and are never charged.

On a phone with the closed-test build:

- [ ] The subscribe screen shows Golden and VIP with **Play Store prices** (not dashboard prices)
- [ ] Tapping Subscribe opens Google's purchase sheet
- [ ] After buying, the account shows premium **within a few seconds**
- [ ] **Restore Purchases** works
- [ ] A second account does *not* get premium (entitlement is per-user)

Watch the server while testing:

```bash
cd ~/app/deploy && docker compose logs -f app | grep -iE "revenuecat|iap|webhook"
```

If the purchase succeeds but premium never lands, it's the webhook — not the app.

---

## Phase 6 — go public

- [ ] **Countries/regions** selected on the production track (this blocked versionCode 9)
- [ ] **Release notes** in `<ar-SA>` and `<en-US>` tags, both with real text
- [ ] Reviewer login still works: `review@prfet.com` / code `1234` — Google re-reviews
      every production update and rejects an app it cannot sign into
- [ ] `D:\app\android` backed up **off this machine** (it is gitignored; the keystore is
      unrecoverable, and after production the signing key is locked to the listing)

Then **الاختبار والإصدار → الإنتاج → إنشاء إصدار جديد**, promote the versionCode 10 build.

**Start the rollout at 20%.** This build carries native code that has only run on two test
phones — call notifications, speaker routing, camera mirror. At 20% you can halt it; at
100% you can only ship another build and wait for review.

Review typically takes hours to a few days for a first production release.

---

## Phase 7 — the day it goes live

- [ ] **UptimeRobot on `https://prfet.com/api/health`**, 5-minute checks, alert on non-200,
      to email + WhatsApp. Ten minutes of setup. Every outage in this project so far was
      discovered by the client phoning — this is the single highest-value thing left.
- [ ] Watch `docker compose logs -f app` for the first hour of the rollout
- [ ] Raise the rollout to 50%, then 100% over a couple of days if crash-free rate holds

---

## After launch — known issues worth fixing

- **Credit packs currently credit the same amount they cost**, and Google takes 15–30% —
  a loss on every sale. Reprice before promoting them.
- **`prfet_addon_voice`** — voice chat is disabled (`VOICE_CHAT = false`). Don't sell it.
- **VIP radar minutes (480) are lower than Golden (2000)** in the dashboard. Looks wrong.
- **Rotate the exposed credentials**: the SES SMTP CSV committed to GitHub, the Firebase
  service-account key, the old Gmail app password, and the Gemini + Twilio keys that were
  pasted in chat.
- **`deploy_uploads` has no retention policy** — every photo, video and voice note is kept
  forever. It is the next thing that will fill the disk.
- **Phone OTP** still blocked on the Twilio account tier; kwtSMS (WhatsApp +965 9922-0322)
  is the cheaper, more reliable route for Kuwait.

---

## Things that have bitten this project — don't repeat them

- Deploy with `--build --force-recreate`, always. Without it Compose reuses the container
  and serves old code while you test "fixes" that were never running.
- Verify with `curl -s https://prfet.com/api/health`, not `docker compose ps` — the latter
  said "Up" through an entire outage.
- A schema change adding a `@unique` column can't be applied by `db push` unattended. Apply
  it by hand with SQL first.
- `versionCode` must increase every upload. 8, 9 are used; 10 is next.
- Never `git add -A` — the working tree holds WIP that must not ship.
