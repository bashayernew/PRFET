// Native phone push via Firebase Cloud Messaging (FCM).
//
// A Capacitor WebView can't run a background service worker, so web-push (lib/notify.ts)
// only reaches the phone while the app is OPEN. To notify when the app is CLOSED we send
// through FCM to the device tokens the app registered (see /api/push/register).
//
// Setup (server): put the Firebase *service account* JSON in the env var
// FIREBASE_SERVICE_ACCOUNT — either the raw JSON or base64 of it. If it's unset, every
// call here is a safe no-op, so nothing breaks before Firebase is configured.
import { prisma } from "@/lib/prisma";

/* eslint-disable @typescript-eslint/no-explicit-any */
let messaging: any = null;
let initTried = false;

async function getMessaging(): Promise<any> {
  if (initTried) return messaging;
  initTried = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null; // not configured yet — no-op
  try {
    const admin = await import("firebase-admin");
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const cred = JSON.parse(json);
    const app = admin.apps && admin.apps.length
      ? admin.apps[0]
      : admin.initializeApp({ credential: admin.credential.cert(cred) });
    messaging = admin.messaging(app!);
  } catch (e) {
    console.error("[fcm] init failed:", e);
    messaging = null;
  }
  return messaging;
}

/** Send a phone notification to every device the user has registered. Safe no-op if FCM
 *  isn't configured or the user has no device tokens. Prunes tokens FCM reports as dead. */
export async function pushToUser(
  userId: string,
  n: { title: string; body: string; url?: string; icon?: string | null }
): Promise<void> {
  const msg = await getMessaging();
  if (!msg) return;

  const rows = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } }).catch(() => []);
  if (!rows.length) return;
  const tokens = rows.map((r: { token: string }) => r.token);

  try {
    const res = await msg.sendEachForMulticast({
      tokens,
      notification: { title: n.title, body: n.body },
      data: { url: n.url || "" },
      android: { priority: "high", notification: { sound: "default" } },
    });
    const dead: string[] = [];
    res.responses.forEach((r: { success: boolean; error?: { code?: string } }, i: number) => {
      const code = r.error?.code || "";
      if (!r.success && (code.includes("not-registered") || code.includes("invalid-argument") || code.includes("invalid-registration"))) {
        dead.push(tokens[i]);
      }
    });
    if (dead.length) await prisma.deviceToken.deleteMany({ where: { token: { in: dead } } }).catch(() => {});
  } catch (e) {
    console.error("[fcm] send failed:", e);
  }
}
