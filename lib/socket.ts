// Client-side Socket.IO singleton. Connects with the access token; reused across screens.
import { getAccessToken, refreshAccessToken } from "@/lib/api";

let socket: any = null;
let wiredAuthRecovery = false;

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
    transports: ["websocket", "polling"],
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
        await refreshAccessToken();
      } finally {
        // Small gap so a permanently-invalid session can't spin in a tight loop.
        setTimeout(() => { refreshing = false; }, 5000);
      }
    });
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) { try { socket.disconnect(); } catch {} socket = null; wiredAuthRecovery = false; }
}
