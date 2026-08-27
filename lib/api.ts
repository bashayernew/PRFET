export type ApiResult<T = unknown> = { ok: boolean; status: number; data: T };

function getRefresh() {
  return typeof localStorage !== "undefined" ? localStorage.getItem("herot.refresh") : null;
}

let refreshing: Promise<string | null> | null = null;

/**
 * Exchange the refresh token for a fresh access token (deduped across concurrent calls).
 * Exported as `refreshAccessToken` below so the socket layer can re-authenticate too —
 * access tokens live 15 minutes, and a socket that reconnects with a stale one is
 * rejected, which silently kills calls and live chat.
 */
async function refreshAccess(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const rt = getRefresh();
    if (!rt) return null;
    let res: Response;
    try {
      res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
    } catch {
      return null;
    }
    if (res.status === 401) {
      clearTokens(); // refresh token invalid/expired — session is over
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data?.accessToken) {
      localStorage.setItem("herot.access", data.accessToken);
      return data.accessToken as string;
    }
    return null;
  })();
  const r = await refreshing;
  refreshing = null;
  return r;
}

/** Public alias so non-fetch callers (the Socket.IO layer) can refresh the token too. */
export const refreshAccessToken = refreshAccess;

const NO_REFRESH = ["/api/auth/refresh", "/api/auth/login", "/api/auth/register", "/api/auth/verify-otp", "/api/auth/resend-otp", "/api/auth/forgot", "/api/auth/reset"];

/**
 * "ios" / "android" inside the Capacitor shell, "" in a browser.
 *
 * Capacitor injects this global synchronously before app code runs, so no dynamic import
 * is needed and the web bundle stays free of native modules. The server reads it to decide
 * whether App Store payment rules apply to a purchase (see `lib/credits.ts`).
 */
function platformHeader(): string {
  if (typeof window === "undefined") return "";
  const cap = (window as unknown as {
    Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
  }).Capacitor;
  if (!cap?.isNativePlatform?.()) return "";
  const p = cap.getPlatform?.() || "";
  return p === "ios" || p === "android" ? p : "";
}

async function request<T = unknown>(method: string, path: string, body?: unknown, token?: string): Promise<ApiResult<T>> {
  const doFetch = (tok?: string) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
    const platform = platformHeader();
    if (platform) headers["x-prfet-platform"] = platform;
    return fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  };

  let res = await doFetch(token);
  if (res.status === 401 && token && !NO_REFRESH.some((p) => path.startsWith(p))) {
    const fresh = await refreshAccess();
    if (fresh) res = await doFetch(fresh);
  }

  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

export async function apiPost<T = unknown>(path: string, body: unknown, token?: string): Promise<ApiResult<T>> {
  return request<T>("POST", path, body, token);
}
export async function apiGet<T = unknown>(path: string, token?: string): Promise<ApiResult<T>> {
  return request<T>("GET", path, undefined, token);
}
export async function apiPatch<T = unknown>(path: string, body: unknown, token?: string): Promise<ApiResult<T>> {
  return request<T>("PATCH", path, body, token);
}
export async function apiDelete<T = unknown>(path: string, token?: string): Promise<ApiResult<T>> {
  return request<T>("DELETE", path, undefined, token);
}

export async function apiUpload<T = unknown>(path: string, file: File, token?: string): Promise<ApiResult<T>> {
  const send = (tok?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    const headers: Record<string, string> = {};
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
    return fetch(path, { method: "POST", headers, body: fd });
  };
  let res = await send(token);
  if (res.status === 401 && token) {
    const fresh = await refreshAccess();
    if (fresh) res = await send(fresh);
  }
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

export function saveTokens(t: { accessToken: string; refreshToken: string }) {
  localStorage.setItem("herot.access", t.accessToken);
  localStorage.setItem("herot.refresh", t.refreshToken);
}
export function getAccessToken() {
  return localStorage.getItem("herot.access");
}
export async function logout() {
  const rt = typeof localStorage !== "undefined" ? localStorage.getItem("herot.refresh") : null;
  if (rt) {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }) });
    } catch { /* ignore */ }
  }
  clearTokens();
}

export function clearTokens() {
  localStorage.removeItem("herot.access");
  localStorage.removeItem("herot.refresh");
}
