# Feature spec — AI Bluetooth Radar (repurpose the voice minutes)

_Added 2026-08-25 from client request._

## Idea
The Bluetooth (BLE) discovery already lets a user **manually** scan and find nearby people/
businesses (whoever has BLE discovery on), see their account, and text/add them.

New on top of that: an **AI auto‑radar** mode. If turned on, the AI **keeps scanning in the
background over a time window** and builds a **report of everything it caught in that span** —
even people/businesses that have since left and are no longer nearby. The report shows each
account; a **subscriber** can then text or add them.

## Rules / metering
- **Manual BLE discovery stays FREE for everyone** (the existing Discover → Bluetooth flow).
- **AI auto‑radar is for SUBSCRIBERS**, and it **spends the quota that used to be "AI voice
  minutes"** (`callMinutesBasic/Vip`, e.g. 120 min). We keep that credit — just **rename its
  meaning** from "talking to the AI" to "AI Bluetooth radar time."
- While auto‑radar runs, meter the elapsed time against that quota (heartbeat, like the old
  voice metering). When it's used up → stop and show the renew/add‑ons prompt.

## Build breakdown
### WEB / backend (Claude can do)
1. **Rename the quota's meaning** in the UI: plans + settings + usage bar show it as
   "Bluetooth radar minutes" instead of voice minutes (dashboard field `callMinutesBasic/Vip`
   stays; only labels/i18n change). Keeps the number editable from the dashboard.
2. **`/api/search/ble-tick`** — heartbeat endpoint (mirror of the old `voice-tick`): deduct
   elapsed seconds from the same monthly cap; 403 when exhausted.
3. **Persist discovered entities** with timestamps so the "report" survives even after the
   person/business leaves: a table `RadarHit { userId, foundUserId, firstSeen, lastSeen,
   distance }`, upserted from the BLE bridge results during an auto‑radar session.
4. **Radar report UI** in Discover: a list of everyone caught this session (name, avatar,
   business tag, when/where‑ish, "no longer nearby" badge), with text/add actions (subscriber‑gated).
5. **Gate**: auto‑radar toggle only for premium; manual scan stays open to all.

### NATIVE (Capacitor Android — the hard part)
6. **Continuous/background BLE scanning** so it keeps catching devices even when the app is
   backgrounded or the screen is off. Android/iOS heavily restrict background BLE — needs a
   **foreground service** (Android) with a persistent notification, and has real OS limits on
   iOS. This is the main engineering challenge and must be done in the `android/` native layer,
   wired to the existing `window.PrfetNative` / `window.__prfetBleFound` bridge.

## Status
Spec only — not built yet. Web parts (1–5) are straightforward; the native background scanner (6)
is the real work and is Android‑native, not web. Best done as a dedicated feature pass.
