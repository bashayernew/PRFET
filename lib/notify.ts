import webpush from "web-push";
import { prisma } from "@/lib/prisma";

let configured = false;
function ensure() {
  if (configured) return !!process.env.VAPID_PRIVATE_KEY;
  configured = true;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails("mailto:admin@prfet.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    return true;
  }
  return false;
}

export type NotifyOpts = {
  actorId?: string | null; // who did it
  targetId?: string | null; // what it points at (postId / meetingId / peer id)
  text?: string | null; // message preview, comment body, caption…
};

/** Where tapping this notification should take you. */
function linkFor(kind: string, targetId?: string | null, actorId?: string | null) {
  if (kind === "new_message" || kind === "missed_call" || kind === "gift_premium") return actorId ? `/messages/${actorId}` : "/messages";
  if (kind.startsWith("post_")) return targetId ? `/post/${targetId}` : "/home";
  if (kind === "meeting_invite") return targetId ? `/meetings/${targetId}` : "/meetings";
  if (kind === "job_application") return targetId ? `/job/${targetId}` : "/jobs";
  if (kind === "new_follower") return actorId ? `/business/${actorId}` : "/notifications";
  if (kind === "ad_review") return "/ads";
  return "/notifications";
}

/** The sentence shown on the phone's lock screen, in the receiver's language. */
function phrase(kind: string, locale: string, actor: string, text?: string | null) {
  const ar = locale !== "en";
  const cut = (t?: string | null) => (t ? (t.length > 60 ? `${t.slice(0, 60)}…` : t) : "");
  switch (kind) {
    case "new_message":
      return { title: actor || (ar ? "رسالة جديدة" : "New message"), body: cut(text) || (ar ? "أرسل لك رسالة" : "sent you a message") };
    case "new_follower":
      return { title: ar ? "متابع جديد" : "New follower", body: ar ? `${actor} بدأ بمتابعتك` : `${actor} started following you` };
    case "post_like":
      return { title: ar ? "إعجاب جديد" : "New like", body: ar ? `${actor} أعجب بمنشورك` : `${actor} liked your post` };
    case "post_comment":
      return { title: ar ? "تعليق جديد" : "New comment", body: ar ? `${actor}: ${cut(text)}` : `${actor}: ${cut(text)}` };
    case "post_repost":
      return { title: ar ? "إعادة نشر" : "Repost", body: ar ? `${actor} أعاد نشر منشورك` : `${actor} reposted your post` };
    case "meeting_invite":
      return { title: ar ? "دعوة لغرفة" : "Room invite", body: ar ? `${actor} دعاك إلى «${cut(text)}»` : `${actor} invited you to “${cut(text)}”` };
    case "missed_call":
      return { title: ar ? "مكالمة فائتة" : "Missed call", body: ar ? `مكالمة فائتة من ${actor}` : `Missed call from ${actor}` };
    case "job_application":
      return { title: ar ? "طلب توظيف جديد" : "New application", body: ar ? `${actor} تقدّم لوظيفة «${cut(text)}»` : `${actor} applied for “${cut(text)}”` };
    case "gift_premium":
      return { title: ar ? "اشتراك مهدى إليك 🎁" : "A gifted subscription 🎁", body: ar ? `${actor} دفع اشتراكك المميّز` : `${actor} paid for your premium` };
    case "ad_review":
      return { title: ar ? "تحديث إعلانك" : "Ad update", body: cut(text) || (ar ? "تم تحديث حالة إعلانك" : "Your ad status changed") };
    case "suspended":
      return { title: ar ? "تم إيقاف حسابك مؤقتاً" : "Your account was suspended", body: cut(text) || (ar ? "راجع الإدارة للمزيد من التفاصيل" : "Contact the administration for details") };
    case "unsuspended":
      return { title: ar ? "تم رفع الإيقاف عن حسابك ✅" : "Your suspension is over ✅", body: ar ? "انتهت مدة الإيقاف ويمكنك استخدام حسابك من جديد." : "The suspension period ended — you can use your account again." };
    default:
      return { title: "PRFET", body: cut(text) };
  }
}

/**
 * Store an in-app notification AND (when VAPID keys are set) push it to the person's phone,
 * with the name of whoever did it and a link straight to the right screen.
 */
export async function notify(userId: string, kind: string, opts: NotifyOpts = {}) {
  const { actorId = null, targetId = null, text = null } = opts;

  await prisma.notification
    .create({ data: { userId, kind, data: text, actorId, targetId } })
    .catch(() => {});

  if (!ensure()) return;

  const [me, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { locale: true } }).catch(() => null),
    actorId ? prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true, avatarUrl: true } }).catch(() => null) : null,
  ]);

  const { title, body } = phrase(kind, me?.locale ?? "ar", actor?.displayName ?? "", text);
  // Absolute URL on the live domain, so a click always lands on prfet.com even for
  // push subscriptions that were first created on the old domain.
  const appOrigin = (process.env.APP_URL || "https://prfet.com").replace(/\/$/, "");
  const payload = JSON.stringify({
    kind,
    title,
    body,
    url: appOrigin + linkFor(kind, targetId, actorId),
    icon: actor?.avatarUrl || "/icon-192.png",
  });

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(
    subs.map((sub: { endpoint: string; p256dh: string; auth: string }) =>
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .catch(async () => {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } }).catch(() => {});
        })
    )
  );
}
