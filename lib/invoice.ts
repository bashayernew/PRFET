import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

/** Record a paid transaction as an invoice. Skips $0 (gifts/free posters). */
export async function createInvoice(opts: {
  userId: string;
  // "support" = credits sent to another member's wallet (see /api/credits/send).
  kind: "subscription" | "ad" | "job" | "seeker" | "support";
  description: string;
  amount: number;
}): Promise<void> {
  if (!opts.amount || opts.amount <= 0) return; // nothing to bill

  const user = await prisma.user.findUnique({ where: { id: opts.userId }, select: { displayName: true } });

  // number: PRFET-YYYYMM-#### (sequential within the month)
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const seq = (await prisma.invoice.count({ where: { createdAt: { gte: monthStart } } })) + 1;
  const number = `PRFET-${ym}-${String(seq).padStart(4, "0")}`;

  await prisma.invoice.create({
    data: {
      number,
      userId: opts.userId,
      customerName: user?.displayName ?? "",
      kind: opts.kind,
      description: opts.description,
      amount: opts.amount,
      currency: "USD",
    },
  }).catch(() => {});
}

/**
 * Send a DM from the owner account to a member (welcome, purchase receipt, etc.).
 * Uses the same conversation/message tables as normal chat, so the member can reply
 * and reach the admin directly.
 */
export async function sendOwnerDM(userId: string, body: string): Promise<void> {
  const owner = await prisma.user.findFirst({ where: { isOwner: true }, select: { id: true } });
  if (!owner || owner.id === userId) return;

  const ownerConvo = await prisma.conversation.upsert({
    where: { userId_peerId: { userId: owner.id, peerId: userId } },
    create: { userId: owner.id, peerId: userId },
    update: {},
  }).catch(() => null);
  const theirConvo = await prisma.conversation.upsert({
    where: { userId_peerId: { userId, peerId: owner.id } },
    create: { userId, peerId: owner.id },
    update: {},
  }).catch(() => null);

  if (ownerConvo) await prisma.message.create({ data: { conversationId: ownerConvo.id, fromMe: true, kind: "text", body } }).catch(() => {});
  if (theirConvo) await prisma.message.create({ data: { conversationId: theirConvo.id, fromMe: false, kind: "text", body } }).catch(() => {});

  notify(userId, "new_message", { actorId: owner.id, text: body }).catch(() => {});
}

/** The welcome DM a new subscriber gets from the owner account. */
export async function sendSubscriptionWelcome(subscriberId: string): Promise<void> {
  const me = await prisma.user.findUnique({ where: { id: subscriberId }, select: { locale: true } });
  const ar = (me?.locale || "ar") === "ar";
  // This DM comes from an account with a closed inbox, so it must NOT invite a reply
  // here — it points people at the Contact page, which is the real support channel.
  await sendOwnerDM(subscriberId, ar
    ? "أهلاً بك في بريميوم 👑 شكراً لاشتراكك في PRFET! للتواصل مع الإدارة، استخدم صفحة «تواصل مع الإدارة» من القائمة السفلية."
    : "Welcome to Premium 👑 Thanks for subscribing to PRFET! To reach the administration, please use the \"Contact admin\" page in the bottom menu.");
}

/** Localized item names by kind: [Arabic, English]. */
const ITEM_NAMES: Record<"ad" | "job" | "seeker" | "subscription", [string, string]> = {
  ad: ["إعلان", "Ad"],
  job: ["إعلان وظيفة", "Job ad"],
  seeker: ["إعلان باحث عن عمل", "Job-seeker ad"],
  subscription: ["اشتراك بريميوم", "Premium subscription"],
};

/** A purchase receipt DM from the owner — for ads, job posts, anything bought.
 *  The message is written in the buyer's own language (Arabic by default). */
export async function sendPurchaseNotice(
  userId: string,
  kind: "ad" | "job" | "seeker" | "subscription",
  amount: number,
  detail?: string,
): Promise<void> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
  const ar = (me?.locale || "ar") === "ar";
  const item = (ar ? ITEM_NAMES[kind][0] : ITEM_NAMES[kind][1]) + (detail ? ` — ${detail}` : "");
  await sendOwnerDM(userId, ar
    ? `تم استلام طلبك: ${item} — بمبلغ $${amount} 🧾 شكراً لك! لأي استفسار راسل الإدارة من هنا.`
    : `Order received: ${item} — $${amount} 🧾 Thank you! For any question, message the administration here.`);
}
