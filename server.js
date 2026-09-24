// Herot custom server: Next.js + Socket.IO (real-time chat, presence, call signaling).
const { createServer } = require("http");
const { parse } = require("url");
const path = require("path");
const fs = require("fs");
const next = require("next");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

// Serve user uploads directly — Next.js only serves /public files that existed at build
// time, so runtime uploads (chat media, stories, posts, ads) must be streamed by us.
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
const MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm",
  ".weba": "audio/webm", ".aac": "audio/aac", ".caf": "audio/x-caf",
  ".mov": "video/quicktime", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".opus": "audio/opus", ".pdf": "application/pdf",
};
function serveUpload(req, res, pathname) {
  const name = path.basename(decodeURIComponent(pathname)); // strips any ../ tricks
  const file = path.join(UPLOADS_DIR, name);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(name).toLowerCase()] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // Advertise byte-range support — required by Safari/iOS to play video, and needed for
    // seeking and reliable playback in every browser.
    res.setHeader("Accept-Ranges", "bytes");

    const range = req.headers.range;
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === "" ? undefined : parseInt(m[1], 10);
      let end = m[2] === "" ? undefined : parseInt(m[2], 10);
      if (start === undefined && end !== undefined) { start = st.size - end; end = st.size - 1; } // suffix range
      else { if (start === undefined) start = 0; if (end === undefined) end = st.size - 1; }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= st.size) {
        res.statusCode = 416; // Range Not Satisfiable
        res.setHeader("Content-Range", `bytes */${st.size}`);
        res.end();
        return;
      }
      res.statusCode = 206; // Partial Content
      res.setHeader("Content-Range", `bytes ${start}-${end}/${st.size}`);
      res.setHeader("Content-Length", end - start + 1);
      if (req.method === "HEAD") { res.end(); return; }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }

    res.setHeader("Content-Length", st.size);
    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const prisma = new PrismaClient();
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me";

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsed = parse(req.url, true);
    if (parsed.pathname && parsed.pathname.startsWith("/uploads/")) {
      serveUpload(req, res, parsed.pathname);
      return;
    }
    handle(req, res, parsed);
  });
  const io = new Server(server, { cors: { origin: true, credentials: true } });
  // expose to API route handlers (same process) so they can push live events
  globalThis.__herotIo = io;

  const onlineCount = new Map(); // userId -> active socket count

  /**
   * Recent comments per live room, so joining (or reconnecting) doesn't mean silence.
   *
   * Room chat is relayed, never stored — which meant anything sent while a viewer's socket
   * was momentarily reconnecting was lost for good, and someone arriving mid-broadcast saw
   * an empty panel under a busy conversation. Sockets here use long-polling with automatic
   * reconnection, so those gaps are routine rather than rare.
   *
   * In memory on purpose: these are throwaway messages for a room that ends in an hour, and
   * writing every comment to Postgres would put the whole feature on the database's
   * critical path. Capped per room, and dropped when the room ends.
   */
  const meetChat = new Map(); // meetingId -> [{ userId, name, avatarUrl, body, at }]
  const MEET_CHAT_KEEP = 50;

  /**
   * The most recent call offer aimed at each user, held briefly.
   *
   * Signalling is relayed, not stored, so an offer sent to someone whose app was closed hit
   * zero sockets and was gone. Answering the native ringer then opened an app with nothing
   * to answer, and the only recovery was asking the CALLER to send another one — which
   * depends on their app still being open, still holding the call, and their socket being
   * connected at that exact moment. Too many ways to fail.
   *
   * Holding the offer here means the callee can be handed it the instant they appear,
   * whatever the caller is doing. The SDP stays valid while the caller's connection is
   * alive; OFFER_TTL is short so a long-dead call is never resurrected.
   */
  const pendingOffer = new Map(); // calleeId -> { from, sdp, at }
  const OFFER_TTL_MS = 90_000;

  // Drop offers nobody claimed, so a missed call can't be answered ten minutes later.
  setInterval(() => {
    const now = Date.now();
    for (const [to, o] of pendingOffer) if (now - o.at > OFFER_TTL_MS) pendingOffer.delete(to);
  }, 60_000).unref?.();

  function rememberChat(mid, msg) {
    const list = meetChat.get(mid) || [];
    list.push(msg);
    if (list.length > MEET_CHAT_KEEP) list.splice(0, list.length - MEET_CHAT_KEEP);
    meetChat.set(mid, list);
  }

  // JWT handshake — only authenticated users get a socket.
  /**
   * JWT handshake. Rejections are LOGGED, not swallowed.
   *
   * A device whose handshake keeps failing has no socket, so everything it emits — call:ready,
   * live-room joins, chat — silently goes nowhere while HTTP requests keep working normally.
   * That looks exactly like "the app is broken" and was invisible from the server: the only
   * clue was `callee sockets: 0`. An expired access token that fails to refresh is the usual
   * cause, and `jwt.verify` names it (`TokenExpiredError`).
   */
  io.use((socket, nextFn) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      console.log(`[socket] handshake refused: no token (ip ${socket.handshake.address})`);
      return nextFn(new Error("unauthorized"));
    }
    try {
      const decoded = jwt.verify(token, ACCESS_SECRET);
      if (decoded.type !== "access") {
        console.log(`[socket] handshake refused: wrong token type "${decoded.type}"`);
        return nextFn(new Error("unauthorized"));
      }
      socket.data.userId = decoded.sub;
      nextFn();
    } catch (e) {
      console.log(`[socket] handshake refused: ${e && e.name} — ${e && e.message}`);
      nextFn(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const uid = socket.data.userId;
    socket.join(uid); // personal room, addressable by user id

    const c = (onlineCount.get(uid) || 0) + 1;
    onlineCount.set(uid, c);
    if (c === 1) {
      prisma.user.update({ where: { id: uid }, data: { online: true } }).catch(() => {});
      io.emit("presence:update", { userId: uid, online: true });
    }

    // ---- Meeting rooms: presence in the room channel + in-room text chat ----
    /**
     * Join the room's socket channel — this is what makes live comments arrive.
     *
     * This used to require an existing MeetingParticipant row and returned silently when
     * there wasn't one. But the socket connects BEFORE the HTTP auto-join creates that row,
     * so the join was usually rejected and the viewer never received a single message — with
     * no error anywhere to explain it. A client-side retry was added later but reads a
     * socket ref that is often still null, so it missed too.
     *
     * The row check was never a security boundary anyway: SENDING is gated separately in
     * "meeting:chat" (canText or host). Receiving only needs to exclude people who were
     * kicked, which is what this now does — and being a plain lookup with no ordering
     * requirement, it can't race.
     */
    socket.on("meeting:join", async (p) => {
      const mid = p && p.meetingId;
      if (!mid) return;

      // Admin moderation: a member restricted from live rooms can't join one either.
      // Mirrors lib/moderation.ts — a flag with no restrictUntil means "until lifted".
      const mod = await prisma.user
        .findUnique({
          where: { id: uid },
          select: { isAdmin: true, blockRooms: true, restrictUntil: true, suspendedUntil: true, disabledAt: true },
        })
        .catch(() => null);
      if (mod && !mod.isAdmin) {
        const suspended = mod.suspendedUntil && mod.suspendedUntil.getTime() > Date.now();
        const restricted = mod.blockRooms && (!mod.restrictUntil || mod.restrictUntil.getTime() > Date.now());
        if (mod.disabledAt || suspended || restricted) {
          console.log(`[meet] join refused ${uid} -> ${mid} | blocked by admin`);
          socket.emit("meeting:blocked", { meetingId: mid });
          return;
        }
      }

      const part = await prisma.meetingParticipant
        .findUnique({ where: { meetingId_userId: { meetingId: mid, userId: uid } } })
        .catch(() => null);
      if (part && part.kicked) return; // removed by the host — stay out
      socket.join(`meet:${mid}`);

      // Catch them up. Joining is idempotent and the client re-emits it before sending, so
      // this also repairs a socket that reconnected and silently missed messages.
      const history = meetChat.get(mid);
      if (history && history.length) socket.emit("meeting:chatHistory", { meetingId: mid, messages: history });
    });

    socket.on("meeting:leaveRoom", (p) => {
      if (p && p.meetingId) socket.leave(`meet:${p.meetingId}`);
    });

    // Text chat inside a room — only for people the host allowed to write.
    /**
     * Send a message into a room.
     *
     * This used to require an existing MeetingParticipant row and returned silently when
     * there wasn't one — so anyone watching a live without having gone through the HTTP
     * join had every message discarded here, with nothing on screen or in the logs to say
     * why. Opening the join gate alone didn't help: people could receive but not send.
     *
     * The host's controls are still honoured. Someone WITH a row must have `canText` (or be
     * the host); someone without one is an ordinary viewer, allowed only while the room
     * itself permits text (`allowText`). Kicked people stay out either way.
     */
    socket.on("meeting:chat", async (p) => {
      const mid = p && p.meetingId;
      const body = ((p && p.body) || "").toString().trim().slice(0, 500);
      if (!mid || !body) return;

      const [part, meeting] = await Promise.all([
        prisma.meetingParticipant
          .findUnique({ where: { meetingId_userId: { meetingId: mid, userId: uid } } })
          .catch(() => null),
        prisma.meeting
          .findUnique({ where: { id: mid }, select: { allowText: true, status: true } })
          .catch(() => null),
      ]);

      if (!meeting || meeting.status !== "live") return;
      if (part && part.kicked) return;
      const allowed = part ? (part.canText || part.role === "host") : meeting.allowText;
      if (!allowed) {
        console.log(`[meet] chat refused ${uid} in ${mid} (participant: ${!!part}, allowText: ${meeting.allowText})`);
        return;
      }
      const u = await prisma.user.findUnique({ where: { id: uid }, select: { displayName: true, avatarUrl: true } }).catch(() => null);
      // Diagnostic: how many sockets are actually in this room. "listeners: 1" means only
      // the sender is joined — everyone else is receiving nothing, which looks identical to
      // the message never being sent.
      const room = io.sockets.adapter.rooms.get(`meet:${mid}`);
      console.log(`[meet] chat ${uid} -> ${mid} | listeners: ${room ? room.size : 0}`);
      const msg = {
        userId: uid,
        name: (u && u.displayName) || uid,
        avatarUrl: (u && u.avatarUrl) || null,
        body,
        at: Date.now(),
      };
      rememberChat(mid, msg);
      io.to(`meet:${mid}`).emit("meeting:chat", { meetingId: mid, ...msg });
    });

    // WebRTC signaling relay for 1:1 calls (offer/answer/ICE) — used by the calls feature.
    socket.on("call:signal", async (p) => {
      // Only the offer is gated: it's the act of starting a call. Answer and ICE belong to
      // a call that already passed the check, and blocking those mid-call would strand a
      // conversation halfway. A blocked member can still be called and can still answer.
      if (p && p.type === "offer") {
        const mod = await prisma.user
          .findUnique({
            where: { id: uid },
            select: { isAdmin: true, blockCalls: true, restrictUntil: true, suspendedUntil: true, disabledAt: true },
          })
          .catch(() => null);
        if (mod && !mod.isAdmin) {
          const suspended = mod.suspendedUntil && mod.suspendedUntil.getTime() > Date.now();
          const restricted = mod.blockCalls && (!mod.restrictUntil || mod.restrictUntil.getTime() > Date.now());
          if (mod.disabledAt || suspended || restricted) {
            console.log(`[call] offer refused ${uid} -> ${p.to} | blocked by admin`);
            socket.emit("call:signal", { from: p.to, type: "blocked" });
            return;
          }
        }
      }
      if (p && p.to) {
        // Diagnostic: on an offer, log whether the callee actually has a live socket. If
        // "targets: 0" the callee isn't connected (root cause of silent missed calls); if
        // >0 but they still don't ring, the break is on the callee's client.
        if (p.type === "offer") {
          const room = io.sockets.adapter.rooms.get(p.to);
          console.log(`[call] offer ${uid} -> ${p.to} | callee sockets: ${room ? room.size : 0}`);
          // Keep it, so answering from the notification doesn't depend on the caller still
          // being around to send another one.
          pendingOffer.set(p.to, { from: uid, sdp: p.sdp, at: Date.now() });
        }
        // Hanging up invalidates the stored offer in both directions — nobody should be able
        // to answer into a call that has already ended.
        if (p.type === "end") {
          const held = pendingOffer.get(p.to);
          if (held && held.from === uid) pendingOffer.delete(p.to);
          const mine = pendingOffer.get(uid);
          if (mine && mine.from === p.to) pendingOffer.delete(uid);
        }
        io.to(p.to).emit("call:signal", { from: uid, ...p });
      }
    });

    /**
     * "I answered your call from a notification — I'm connected now, send the offer again."
     *
     * When the callee's app was closed, the original offer was relayed to zero sockets and
     * lost. Answering the native ringer opens the app, but by then there is nothing left to
     * answer. So the callee announces itself the moment its socket is up and the caller
     * re-sends. Without this the ringer opens an app that sits there doing nothing.
     */
    socket.on("call:ready", (p) => {
      if (!p || !p.to) return;

      /**
       * Serve the stored offer immediately when we have one.
       *
       * This is the path that actually works. Asking the caller to re-send (below) needs
       * their app open, holding the call, with a connected socket — and if any of that is
       * untrue the person who answered just watches "connecting" forever. Replaying the
       * offer we already hold needs none of it.
       */
      const held = pendingOffer.get(uid);
      if (held && held.from === p.to && Date.now() - held.at < OFFER_TTL_MS) {
        console.log(`[call] ready ${uid} -> ${p.to} (replaying stored offer)`);
        socket.emit("call:signal", { from: held.from, type: "offer", sdp: held.sdp });
        return;
      }

      /**
       * No held offer means this is almost certainly a STALE notification.
       *
       * The call notification is deliberately ongoing and non-dismissable so it can't be
       * swiped away mid-ring — which also means an unanswered call leaves it in the tray
       * forever. Tapping one an hour later asks us to resume a call that no longer exists.
       *
       * Tell the phone so it can say "call ended" and get out of the way, instead of sitting
       * on "connecting" for fifteen seconds. We still ping the caller, because the other
       * reason we get here is a genuine race where their offer hasn't landed yet.
       */
      console.log(`[call] ready ${uid} -> ${p.to} (no stored offer — likely a stale notification)`);
      socket.emit("call:none", { from: p.to });
      io.to(p.to).emit("call:ready", { from: uid });
    });

    socket.on("disconnect", () => {
      const n = (onlineCount.get(uid) || 1) - 1;
      if (n <= 0) {
        onlineCount.delete(uid);
        prisma.user.update({ where: { id: uid }, data: { online: false } }).catch(() => {});
        io.emit("presence:update", { userId: uid, online: false });

        /**
         * A caller who vanished mid-ring takes their call with them.
         *
         * Hanging up properly sends "end" and a cancel push. Killing the app runs no
         * JavaScript at all, so neither happens — and the stored offer would sit here
         * letting someone answer into a call whose other end no longer exists. Dropping it
         * on disconnect means the worst case is a missed call rather than a dead one.
         */
        for (const [calleeId, held] of pendingOffer) {
          if (held.from !== uid) continue;
          pendingOffer.delete(calleeId);
          console.log(`[call] caller ${uid} vanished — dropped the held offer for ${calleeId}`);
          io.to(calleeId).emit("call:signal", { from: uid, type: "end" });
        }

        // Room cleanup: going fully offline removes the user from any live room (frees the
        // seat, no ghost), and a host going offline ends their live rooms.
        (async () => {
          try {
            const hosted = await prisma.meeting.findMany({ where: { hostId: uid, status: "live" }, select: { id: true } });
            if (hosted.length) {
              await prisma.meeting.updateMany({ where: { id: { in: hosted.map((m) => m.id) } }, data: { status: "ended" } });
              hosted.forEach((m) => { io.to(`meet:${m.id}`).emit("meeting:ended", { meetingId: m.id }); meetChat.delete(m.id); });
            }
            await prisma.meetingParticipant.deleteMany({ where: { userId: uid, meeting: { status: "live" } } });
          } catch { /* best effort */ }
        })();
      } else {
        onlineCount.set(uid, n);
      }
    });
  });

  // ---- Rooms end when their time is up. Nothing else reliably closes a live room (a host
  // who just closes the tab never calls /leave), so this makes `endsAt` actually mean it. ----
  async function sweepMeetings() {
    try {
      const due = await prisma.meeting.findMany({ where: { status: "live", endsAt: { not: null, lte: new Date() } }, select: { id: true } });
      if (!due.length) return;
      const ids = due.map((m) => m.id);
      await prisma.meeting.updateMany({ where: { id: { in: ids } }, data: { status: "ended" } });
      ids.forEach((mid) => { io.to(`meet:${mid}`).emit("meeting:ended", { meetingId: mid }); meetChat.delete(mid); }); // free the chat buffer
      console.log(`> meetings: ended ${ids.length} expired room(s)`);
    } catch (e) {
      console.error("meetings sweep failed", e && e.message);
    }
  }
  sweepMeetings();
  setInterval(sweepMeetings, 60 * 1000); // every minute — rooms shouldn't overrun by much

  // ---- Stories live exactly 24h. Once expired, delete the row AND the file on disk,
  // unless the same file is still used by a post, a message, an ad or an avatar. ----
  async function sweepStories() {
    try {
      const dead = await prisma.story.findMany({ where: { expiresAt: { lt: new Date() } } });
      if (!dead.length) return;
      await prisma.story.deleteMany({ where: { id: { in: dead.map((s) => s.id) } } });

      for (const s of dead) {
        const url = s.mediaUrl;
        if (!url || !url.startsWith("/uploads/")) continue;
        const [inPost, inMsg, inAd, inAvatar, inStory] = await Promise.all([
          prisma.post.count({ where: { mediaUrl: url } }),
          prisma.message.count({ where: { mediaUrl: url } }),
          prisma.ad.count({ where: { mediaUrl: url } }),
          prisma.user.count({ where: { avatarUrl: url } }),
          prisma.story.count({ where: { mediaUrl: url } }),
        ]);
        if (inPost + inMsg + inAd + inAvatar + inStory > 0) continue; // still in use elsewhere
        fs.unlink(path.join(UPLOADS_DIR, path.basename(url)), () => {});
      }
      console.log(`> stories: removed ${dead.length} expired`);
    } catch (e) {
      console.error("story sweep failed", e && e.message);
    }
  }
  sweepStories();
  setInterval(sweepStories, 60 * 60 * 1000); // every hour

  // ---- Suspensions lift themselves the moment their time is up, and the person
  // is told they can come back — no admin action needed. ----
  async function sweepSuspensions() {
    try {
      const done = await prisma.user.findMany({
        where: { suspendedUntil: { not: null, lte: new Date() } },
        select: { id: true, locale: true },
      });
      if (!done.length) return;
      await prisma.user.updateMany({
        where: { id: { in: done.map((u) => u.id) } },
        data: { suspendedUntil: null, suspendReason: null },
      });
      for (const u of done) {
        await prisma.notification
          .create({ data: { userId: u.id, kind: "unsuspended", data: null } })
          .catch(() => {});
      }
      console.log(`> suspensions: lifted ${done.length}`);
    } catch (e) {
      console.error("suspension sweep failed", e && e.message);
    }
  }
  sweepSuspensions();
  setInterval(sweepSuspensions, 10 * 60 * 1000); // every 10 minutes

  // ---- Job ads & seeker listings stop after their 30 days, and the owner is
  // reminded once that renewing brings them back. ----
  async function sweepJobAds() {
    try {
      const now = new Date();
      // company job ads
      const deadJobs = await prisma.job.findMany({
        where: { status: "open", expiresAt: { not: null, lte: now }, renewNotified: false },
        select: { id: true, companyId: true, title: true },
      });
      for (const j of deadJobs) {
        await prisma.job.update({ where: { id: j.id }, data: { status: "expired", renewNotified: true } }).catch(() => {});
        await prisma.notification
          .create({ data: { userId: j.companyId, kind: "job_expired", data: j.title, targetId: j.id } })
          .catch(() => {});
      }
      // individual "looking for work" listings
      const deadSeekers = await prisma.jobSeeker.findMany({
        where: { expiresAt: { not: null, lte: now }, renewNotified: false },
        select: { id: true, userId: true },
      });
      for (const s of deadSeekers) {
        await prisma.jobSeeker.update({ where: { id: s.id }, data: { renewNotified: true } }).catch(() => {});
        await prisma.notification
          .create({ data: { userId: s.userId, kind: "seeker_expired", data: null } })
          .catch(() => {});
      }
      if (deadJobs.length || deadSeekers.length) {
        console.log(`> job ads: expired ${deadJobs.length} jobs, ${deadSeekers.length} seeker listings`);
      }
    } catch (e) {
      console.error("job ads sweep failed", e && e.message);
    }
  }
  sweepJobAds();
  setInterval(sweepJobAds, 60 * 60 * 1000); // every hour

  // ---- Three days before anything ends, its owner hears about it. And premium
  // renews itself at today's dashboard price — unless the member cancelled. ----
  const WARN_MS = 3 * 24 * 60 * 60 * 1000;
  async function sweepRenewals() {
    try {
      const now = new Date();
      const soon = new Date(Date.now() + WARN_MS);

      // paid ads about to end
      const ads = await prisma.ad.findMany({
        where: { status: "active", endNotified: false, expiresAt: { gt: now, lte: soon } },
        select: { id: true, userId: true, caption: true },
      });
      for (const a of ads) {
        await prisma.ad.update({ where: { id: a.id }, data: { endNotified: true } }).catch(() => {});
        await prisma.notification.create({ data: { userId: a.userId, kind: "ad_ending", data: a.caption || null } }).catch(() => {});
      }

      // job ads about to end
      const jobs = await prisma.job.findMany({
        where: { status: "open", endNotified: false, expiresAt: { not: null, gt: now, lte: soon } },
        select: { id: true, companyId: true, title: true },
      });
      for (const j of jobs) {
        await prisma.job.update({ where: { id: j.id }, data: { endNotified: true } }).catch(() => {});
        await prisma.notification.create({ data: { userId: j.companyId, kind: "job_ending", data: j.title, targetId: j.id } }).catch(() => {});
      }

      // seeker listings about to end
      const seekers = await prisma.jobSeeker.findMany({
        where: { endNotified: false, expiresAt: { not: null, gt: now, lte: soon } },
        select: { id: true, userId: true },
      });
      for (const s of seekers) {
        await prisma.jobSeeker.update({ where: { id: s.id }, data: { endNotified: true } }).catch(() => {});
        await prisma.notification.create({ data: { userId: s.userId, kind: "seeker_ending", data: null } }).catch(() => {});
      }

      // premium about to renew (or end, if cancelled) — one heads-up, 3 days out
      const subsSoon = await prisma.user.findMany({
        where: { isPremium: true, subRenewNotified: false, premiumUntil: { not: null, gt: now, lte: soon } },
        select: { id: true, autoRenew: true },
      });
      for (const u of subsSoon) {
        await prisma.user.update({ where: { id: u.id }, data: { subRenewNotified: true } }).catch(() => {});
        await prisma.notification.create({ data: { userId: u.id, kind: u.autoRenew ? "sub_renewing" : "sub_ending" } }).catch(() => {});
      }

      // Premium that reached its end simply LAPSES. Real renewals come from the app store's
      // billing (a verified store notification re-activates), never from a free timer here.
      const due = await prisma.user.findMany({
        where: { isPremium: true, premiumUntil: { not: null, lte: now } },
        select: { id: true },
      });
      for (const u of due) {
        await prisma.user.update({ where: { id: u.id }, data: { isPremium: false, premiumTier: "basic", subRenewNotified: false } }).catch(() => {});
        await prisma.notification.create({ data: { userId: u.id, kind: "sub_ended", data: null } }).catch(() => {});
      }

      const warned = ads.length + jobs.length + seekers.length + subsSoon.length;
      if (warned || due.length) console.log(`> renewals: warned ${warned}, settled ${due.length} subscriptions`);
    } catch (e) {
      console.error("renewals sweep failed", e && e.message);
    }
  }
  sweepRenewals();
  setInterval(sweepRenewals, 60 * 60 * 1000); // every hour

  // ---- AI companion absence check-ins: an "are you ok?" ping after 8h away,
  // then a follow-up after 24h. Each fires once per absence; returning clears them. ----
  async function sweepCheckins() {
    try {
      // only when the AI assistant is enabled from the dashboard
      const s = await prisma.appSettings.findUnique({ where: { id: "app" }, select: { aiEnabled: true } }).catch(() => null);
      if (s && s.aiEnabled === false) return;

      const now = Date.now();
      const eightAgo = new Date(now - 8 * 60 * 60 * 1000);
      const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

      const due8 = await prisma.user.findMany({
        where: { isAdmin: false, lastSeenAt: { not: null, lt: eightAgo, gte: dayAgo }, checkin8Sent: false },
        select: { id: true },
      });
      for (const u of due8) {
        await prisma.user.update({ where: { id: u.id }, data: { checkin8Sent: true } }).catch(() => {});
        await prisma.notification.create({ data: { userId: u.id, kind: "ai_checkin", data: "8" } }).catch(() => {});
      }

      const due24 = await prisma.user.findMany({
        where: { isAdmin: false, lastSeenAt: { not: null, lt: dayAgo }, checkin24Sent: false },
        select: { id: true },
      });
      for (const u of due24) {
        await prisma.user.update({ where: { id: u.id }, data: { checkin24Sent: true } }).catch(() => {});
        await prisma.notification.create({ data: { userId: u.id, kind: "ai_checkin", data: "24" } }).catch(() => {});
      }

      if (due8.length || due24.length) console.log(`> check-ins: 8h=${due8.length}, 24h=${due24.length}`);
    } catch (e) {
      console.error("check-ins sweep failed", e && e.message);
    }
  }
  sweepCheckins();
  setInterval(sweepCheckins, 30 * 60 * 1000); // every 30 minutes

  /**
   * Presence reset on boot.
   *
   * `online` is only ever cleared by the socket "disconnect" handler. If the process dies
   * without that running — a container restart, a deploy, an instance stop — every user who
   * was connected stays `online: true` forever. They then look available to call while
   * having no live socket at all: the caller dials, `io.to(peerId)` relays to zero sockets,
   * and neither side sees anything happen.
   *
   * At boot, by definition, nobody is connected yet. So the truth is always "everyone
   * offline", and clients set themselves back online as they reconnect.
   */
  prisma.user
    .updateMany({ where: { online: true }, data: { online: false } })
    .then((r) => { if (r.count) console.log(`> presence: cleared ${r.count} stale online flag(s)`); })
    .catch((e) => console.error("presence reset failed", e && e.message));

  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`> Herot ready on http://localhost:${port}`));
});
