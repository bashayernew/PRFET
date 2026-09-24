import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

/**
 * Broadcast channels.
 *
 * The app sends announcements from named identities rather than from one anonymous
 * "system" sender: "PRFET Admin" for administrative messages, "PRFET News" for
 * announcements and promotions. Which name appears is decided purely by which box the
 * admin typed into.
 *
 * They are ordinary user accounts, found by `systemKey`. That choice buys a lot for very
 * little: a broadcast is just a DM, so it lands in the existing inbox, renders with the
 * existing chat UI, supports media for free, can be replied to, and shows an avatar. The
 * alternative — a label bolted onto messages from the owner account — would have meant
 * touching every place chat is rendered.
 *
 * The accounts are created on first use, so nothing needs seeding on deploy.
 */

export type ChannelKey = "admin" | "news";

const DEFAULTS: Record<ChannelKey, { name: string; bio: string }> = {
  admin: { name: "PRFET Admin", bio: "الحساب الرسمي لإدارة PRFET — PRFET administration" },
  news: { name: "PRFET News", bio: "أخبار وعروض PRFET — PRFET news and offers" },
};

/**
 * Fetch (or create) a channel account.
 *
 * `displayName` is only used when creating it. Renaming is the dashboard's job, and this
 * must never overwrite a name the admin has chosen.
 */
export async function channelAccount(key: ChannelKey) {
  const found = await prisma.user.findUnique({
    where: { systemKey: key },
    select: { id: true, displayName: true, avatarUrl: true },
  });
  if (found) return found;

  return prisma.user.create({
    data: {
      systemKey: key,
      displayName: DEFAULTS[key].name,
      bio: DEFAULTS[key].bio,
      contactMethod: "email",
      // No email or phone: these accounts are never signed into, and leaving the unique
      // identifier columns null keeps them out of every login and search path.
      email: null,
      phone: null,
      locale: "ar",
      isVerified: true,
      // A closed inbox would silence replies, and the client wants members to be able to
      // answer a broadcast, so dmClosed stays at its default.
    },
    select: { id: true, displayName: true, avatarUrl: true },
  });
}

export type BroadcastPayload = {
  body: string;
  /** Optional image or video shown above the text. */
  mediaUrl?: string | null;
  mediaKind?: "image" | "video" | null;
  /**
   * Optional link appended to the message. Anything goes: an in-app path like
   * `/business/<id>` (a member's profile), `/ad/<id>`, or an external https:// URL.
   * Chat renders it as a tappable link.
   */
  linkUrl?: string | null;
};

/**
 * Deliver one broadcast to one member, as a DM from the channel account.
 *
 * Mirrors what the normal send route does: a copy in each side's conversation, linked so
 * the thread reads correctly from both ends.
 */
export async function sendChannelDM(
  channelId: string,
  userId: string,
  payload: BroadcastPayload,
): Promise<boolean> {
  if (channelId === userId) return false;

  // The link rides along in the text. Chat linkifies URLs and in-app paths, so this needs
  // no new column and no change to how messages are stored.
  const text = payload.linkUrl ? `${payload.body}\n${payload.linkUrl}` : payload.body;

  try {
    const [mine, theirs] = await Promise.all([
      prisma.conversation.upsert({
        where: { userId_peerId: { userId: channelId, peerId: userId } },
        create: { userId: channelId, peerId: userId },
        update: { updatedAt: new Date() },
      }),
      prisma.conversation.upsert({
        where: { userId_peerId: { userId, peerId: channelId } },
        create: { userId, peerId: channelId },
        update: { updatedAt: new Date() },
      }),
    ]);

    /** One message, mirrored into both sides of the thread. */
    const deliver = async (kind: string, body: string, mediaUrl: string | null) => {
      const a = await prisma.message.create({
        data: { conversationId: mine.id, fromMe: true, kind, body, mediaUrl },
      });
      const b = await prisma.message.create({
        data: { conversationId: theirs.id, fromMe: false, kind, body, mediaUrl, mirrorId: a.id },
      });
      await prisma.message.update({ where: { id: a.id }, data: { mirrorId: b.id } });
      return b;
    };

    // Media goes as its own message, with the text following separately.
    //
    // Chat renders image and video bubbles from mediaUrl alone and ignores `body` — for
    // ordinary messages that field holds "📷 filename.jpg", so showing it would be noise.
    // Putting a caption there would therefore have silently dropped it. Two messages keeps
    // the existing rendering untouched and shows both.
    if (payload.mediaUrl) {
      await deliver(payload.mediaKind ?? "image", payload.body.slice(0, 60) || "📷", payload.mediaUrl);
    }
    const mirrored = await deliver("text", text, null);

    notify(userId, "new_message", {
      actorId: channelId,
      targetId: channelId,
      text: payload.body.slice(0, 60),
    }).catch(() => {});

    // Live delivery for anyone with the app open.
    const io = (globalThis as unknown as {
      __herotIo?: { to: (room: string) => { emit: (ev: string, payload: unknown) => void } };
    }).__herotIo;
    io?.to(userId).emit("message:new", {
      from: channelId,
      message: {
        id: mirrored.id, fromMe: false, kind: "text", body: text,
        mediaUrl: null, viewOnce: false, allowSave: true,
        createdAt: mirrored.createdAt.toISOString(),
      },
    });
    io?.to(userId).emit("notif:new", { kind: "new_message" });

    return true;
  } catch (e) {
    // One failed recipient must not abort a broadcast to thousands — but it shouldn't
    // vanish either, or a half-delivered send looks like a complete one.
    console.warn("[broadcast] failed for", userId, e);
    return false;
  }
}
