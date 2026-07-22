import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

/** Record a paid transaction as an invoice. Skips $0 (gifts/free posters). */
export async function createInvoice(opts: {
  userId: string;
  kind: "subscription" | "ad" | "job" | "seeker";
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
 * The welcome DM a new subscriber gets from the owner account, with a line inviting
 * them to reach the admin. Uses the same conversation/message tables as normal chat.
 */
export async function sendSubscriptionWelcome(subscriberId: string): Promise<void> {
  const owner = await prisma.user.findFirst({ where: { isOwner: true }, select: { id: true, locale: true } });
  if (!owner || owner.id === subscriberId) return;

  const me = await prisma.user.findUnique({ where: { id: subscriberId }, select: { locale: true } });
  const ar = (me?.locale || "ar") === "ar";
  const body = ar
    ? "أهلاً بك في بريميوم 👑 شكراً لاشتراكك في PRFET! لأي استفسار أو مساعدة، راسل الإدارة من هنا مباشرة."
    : "Welcome to Premium 👑 Thanks for subscribing to PRFET! For anything you need, message the administration right here.";

  // conversation both ways (owner ⇄ subscriber), then a message on each side
  const ownerConvo = await prisma.conversation.upsert({
    where: { userId_peerId: { userId: owner.id, peerId: subscriberId } },
    create: { userId: owner.id, peerId: subscriberId },
    update: {},
  }).catch(() => null);
  const subConvo = await prisma.conversation.upsert({
    where: { userId_peerId: { userId: subscriberId, peerId: owner.id } },
    create: { userId: subscriberId, peerId: owner.id },
    update: {},
  }).catch(() => null);

  if (ownerConvo) await prisma.message.create({ data: { conversationId: ownerConvo.id, fromMe: true, kind: "text", body } }).catch(() => {});
  if (subConvo) await prisma.message.create({ data: { conversationId: subConvo.id, fromMe: false, kind: "text", body } }).catch(() => {});

  // a tappable notification that opens the admin chat
  notify(subscriberId, "new_message", { actorId: owner.id, text: body }).catch(() => {});
}
