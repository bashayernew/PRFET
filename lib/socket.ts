// Client-side Socket.IO singleton. Connects with the access token; reused across screens.
let socket: any = null;
let connectedToken: string | null = null;

export async function getSocket(token: string): Promise<any> {
  if (socket && connectedToken === token) return socket;
  if (socket) { try { socket.disconnect(); } catch {} socket = null; }
  const mod = await import("socket.io-client");
  const io = mod.io || mod.default;
  socket = io({ auth: { token }, transports: ["websocket", "polling"] });
  connectedToken = token;
  return socket;
}

export function disconnectSocket() {
  if (socket) { try { socket.disconnect(); } catch {} socket = null; connectedToken = null; }
}
