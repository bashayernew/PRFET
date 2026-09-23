// Client-side Socket.IO singleton. Connects with the access token; reused across screens.
import { getAccessToken, refreshAccess } from "@/lib/api";

let socket: any = null;
let wiredAuthRecovery = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Access tokens expire after 15 minutes. The socket used to capture the token once at
 * creation, so any reconnect (tab sleep, network blip, wifi→cellular) re-handshaked with
 * an expired token, the server rejected it, and the socket stayed dead — which silently
 * broke calls and live chat with no visible error.
 *
 * Two fixes here:
 *  - `auth` is a CALLBACK, so every connection attempt sends the CURRENT token.
 *  - on an unauthorized handshake we refresh once and let Socket.IO retry.
 */
export async function getSocket(_token?: string): Promise<any> {
  if (socket) return socket;

  const mod = await import("socket.io-client");
  const io = mod.io || mod.default;

  socket = io({
    auth: (cb: (data: unknown) => void) => cb({ token: getAccessToken() }),
    // Long-polling ONLY. The server's proxy isn't upgrading WebSockets (the browser logged
    // "WebSocket is closed before the connection is established"), and every failed upgrade
    // was tearing the socket down — so the callee showed offline (callee sockets: 0) and
    // calls/live-text/end-events never arrived. Polling works through the proxy reliably and
    // is plenty for signaling (the actual call audio is peer-to-peer WebRTC, not the socket).
    transports: ["polling"],
    upgrade: false,
    // Keep trying to reconnect for the whole session so a brief network blip doesn't leave
    // the phone silently offline for calls.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  if (!wiredAuthRecovery) {
    wiredAuthRecovery = true;
    let refreshing = false;
    socket.on("connect_error", async (err: { message?: string }) => {
      if (!String(err?.message || "").includes("unauthorized")) return;
      if (refreshing) return;
      refreshing = true;
      try {
        // If this succeeds the next automatic retry picks the new token up via `auth`.
        // NOTE: this used to call a non-existent `refreshAccessToken()`, which threw a
        // ReferenceError instead of refreshing — so an expired token left the socket dead
        // for the rest of the session (offline for calls, live chat and end-of-live events).
        const fresh = await refreshAccess();
        // Log only WHETHER it worked. The first version printed the token itself, which put
        // a live JWT into the server log — anyone reading logs could have taken the session.
        console.warn("[socket] unauthorized — refresh succeeded:", !!fresh);
        fetch("/api/call/diag", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
          },
          body: JSON.stringify({ stage: "socket-unauthorized", detail: `refreshed=${!!fresh}` }),
        }).catch(() => {});

        /**
         * Reconnect NOW with the new token instead of waiting for the backoff.
         *
         * Socket.IO retries on a growing delay, and each retry between the token expiring
         * and the refresh completing is refused as "jwt expired". During that window the
         * device has no socket at all: callers see `callee sockets: 0` and get pushed to a
         * notification, live comments don't arrive, and the person looks offline. Forcing a
         * fresh handshake closes the window to about a second.
         */
        if (fresh && socket) {
          try { socket.disconnect(); socket.connect(); } catch { /* it'll retry on its own */ }
        }
      } catch (e) {
        console.warn("[socket] token refresh threw:", e);
      } finally {
        // Small gap so a permanently-invalid session can't spin in a tight loop.
        setTimeout(() => { refreshing = false; }, 5000);
      }
    });
  }

  /**
   * Keep the token fresh ahead of time.
   *
   * Access tokens last 15 minutes (ACCESS_TTL in lib/auth.ts). Waiting for a handshake to
   * fail means every 15 minutes there's a gap where this device is invisible to realtime —
   * uncallable, no live comments, shown as offline. Refreshing on a 12-minute cycle means
   * the token is almost never actually expired when the socket needs it, and the recovery
   * path above becomes the exception rather than the norm.
   */
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      refreshAccess().catch(() => { /* the connect_error path is still there as a backstop */ });
    }, 12 * 60 * 1000);
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) { try { socket.disconnect(); } catch {} socket = null; wiredAuthRecovery = false; }
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}
