"use client";

/**
 * Dashboard → Users. Its own page, separate from Grants and Reports.
 *
 * What it does: find any member, create an account by hand, block an account for a set
 * number of days with a reason, restrict individual features instead of the whole account,
 * and disable (soft-delete) or restore.
 *
 * Kept in its own file because admin-screen.tsx is already ~2,000 lines; the sidebar just
 * renders <AdminUsers /> for the "users" tab.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Search, UserPlus, ShieldBan, ShieldCheck, Trash2, RotateCcw, Loader2, X, Ban, ExternalLink,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { apiGet, apiPost, apiPatch, getAccessToken } from "@/lib/api";

const FEATURES = ["calls", "posts", "ai", "jobs", "ads", "chat", "rooms"] as const;
type Feature = (typeof FEATURES)[number];

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  country: string | null;
  accountType: string;
  isAdmin: boolean;
  isOwner: boolean;
  createdAt: string;
  disabled: boolean;
  disabledReason: string | null;
  suspended: boolean;
  suspendReason: string | null;
  suspendedUntil: string | null;
  daysLeft: number;
  blockedFeatures: Feature[];
  restrictReason: string | null;
  restrictDaysLeft: number;
};

type Status = "all" | "blocked" | "restricted" | "disabled";

export default function AdminUsers() {
  const { t, locale, dir } = useI18n();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sheet, setSheet] = useState<Row | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2200); };

  /**
   * Nothing loads until you actually look for someone.
   *
   * Listing every member by default meant the page fetched hundreds of rows and avatars on
   * open — slow, and useless, since finding one person is what this page is for. A status
   * filter is the exception: "blocked", "restricted" and "disabled" are small, finite sets
   * that an admin genuinely wants to browse.
   */
  const term = q.trim();
  const browsing = status !== "all";
  const active = term.length >= 2 || browsing;

  const load = useCallback(async () => {
    if (!active) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const token = getAccessToken() || undefined;
    const res = await apiGet<{ users: Row[] }>(
      `/api/admin/users?scope=manage&status=${status}&take=100${term ? `&q=${encodeURIComponent(term)}` : ""}`,
      token,
    );
    if (res.ok && res.data?.users) setRows(res.data.users);
    setLoading(false);
  }, [term, status, active]);

  // Debounced so typing a name doesn't fire a query per keystroke.
  useEffect(() => {
    const id = window.setTimeout(load, 300);
    return () => window.clearTimeout(id);
  }, [load]);

  async function act(userId: string, body: Record<string, unknown>) {
    const token = getAccessToken() || undefined;
    const res = await apiPatch<{ ok: boolean; user: Row | null }>("/api/admin/users", { userId, ...body }, token);
    if (res.ok && res.data?.user) {
      const updated = res.data.user;
      setRows((r) => r.map((x) => (x.id === updated.id ? updated : x)));
      setSheet((s) => (s && s.id === updated.id ? updated : s));
      say(t("adm.usrSaved"));
    } else {
      say(t("adm.usrFailed"));
    }
  }

  return (
    <div dir={dir} className="space-y-4">
      {/* ===== search + filters + create ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("adm.usrSearchPh")}
            className="w-full rounded-2xl border border-black/10 bg-white py-2.5 ps-9 pe-3 text-[13.5px] font-semibold outline-none"
          />
        </div>

        {(["all", "blocked", "restricted", "disabled"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-2xl px-3 py-2 text-[12.5px] font-extrabold transition-colors ${
              status === s ? "bg-brand-600 text-white" : "border border-black/10 bg-white text-muted"
            }`}
          >
            {t(`adm.usrFilter_${s}`)}
          </button>
        ))}

        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-2.5 text-[13px] font-extrabold text-white"
        >
          <UserPlus className="h-4 w-4" />
          {t("adm.usrCreate")}
        </button>
      </div>

      {/* ===== list ===== */}
      {!active ? (
        <div className="py-14 text-center">
          <Search className="mx-auto mb-3 h-8 w-8 text-muted/40" />
          <p className="text-[13.5px] font-bold text-muted">{t("adm.usrSearchPrompt")}</p>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-[13px] font-semibold text-muted">{t("adm.usrNone")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3">
              {/* No /avatar.png exists in public/ — pointing at it gave every row a broken
                  image icon. Fall back to an initial, the same as the Grants list does. */}
              {u.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-[14px] font-extrabold text-brand-600">
                  {(u.name || "•").charAt(0).toUpperCase()}
                </span>
              )}
              {/* The name itself opens the member's profile — that's the first thing an
                  admin reaches for, and having it do nothing read as broken. */}
              <a
                href={`/business/${u.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1"
              >
                <p className="truncate text-[14px] font-extrabold text-ink underline-offset-2 hover:underline">
                  {u.name}
                  {u.isOwner && <span className="ms-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] text-white">{t("adm.usrOwner")}</span>}
                  {!u.isOwner && u.isAdmin && <span className="ms-2 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] text-white">{t("adm.usrAdmin")}</span>}
                </p>
                <p className="truncate text-[12px] font-semibold text-muted" dir="ltr">{u.email || u.phone || u.id}</p>

                {/* status line */}
                {u.disabled && (
                  <p className="mt-1 text-[11.5px] font-bold text-red-600">
                    {t("adm.usrDisabled")}{u.disabledReason ? ` — ${u.disabledReason}` : ""}
                  </p>
                )}
                {u.suspended && (
                  <p className="mt-1 text-[11.5px] font-bold text-red-600">
                    {t("adm.usrBlockedFor").replace("{n}", ld(u.daysLeft, locale))}
                    {u.suspendReason ? ` — ${u.suspendReason}` : ""}
                  </p>
                )}
                {!u.suspended && !u.disabled && u.blockedFeatures.length > 0 && (
                  <p className="mt-1 text-[11.5px] font-bold text-amber-600">
                    {u.blockedFeatures.map((f) => t(`adm.feat_${f}`)).join("، ")}
                    {u.restrictDaysLeft ? ` — ${t("adm.usrDaysLeft").replace("{n}", ld(u.restrictDaysLeft, locale))}` : ""}
                  </p>
                )}
              </a>

              <button
                onClick={() => setSheet(u)}
                disabled={u.isOwner}
                className="shrink-0 rounded-xl border border-black/10 px-3 py-2 text-[12.5px] font-extrabold text-ink disabled:opacity-40"
              >
                {t("adm.usrManage")}
              </button>
            </div>
          ))}
        </div>
      )}

      {creating && <CreateSheet onClose={() => setCreating(false)} onDone={(msg) => { say(msg); load(); }} />}
      {sheet && <ManageSheet user={sheet} onClose={() => setSheet(null)} onAct={act} />}

      {toast && (
        <div className="fixed bottom-6 start-1/2 z-[90] -translate-x-1/2 rounded-2xl bg-ink px-4 py-2.5 text-[13px] font-bold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── create account ───────────────────────── */

function CreateSheet({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const { t, dir } = useI18n();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<"personal" | "business">("personal");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deliberately NO minimum length here. Public signup demands 4+ characters; an admin
  // creating an account can use any name, of any length.
  const valid = displayName.trim().length > 0 && (email.trim() || phone.trim());

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const token = getAccessToken() || undefined;
    const res = await apiPost<{ ok: boolean }>(
      "/api/admin/users",
      {
        displayName: displayName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password: password.trim() || undefined,
        accountType,
        country: country.trim().toUpperCase() || undefined,
      },
      token,
    );
    setBusy(false);
    if (res.ok) {
      onDone(t("adm.usrCreated"));
      onClose();
    } else {
      const code = (res.data as { error?: string } | null)?.error;
      setError(
        code === "identifier_taken" ? t("adm.usrTaken")
        : code === "contact_required" ? t("adm.usrContactRequired")
        : t("adm.usrFailed"),
      );
    }
  }

  return (
    <div data-no-pull-refresh dir={dir} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[88vh] w-full max-w-[420px] overflow-y-auto rounded-3xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[16px] font-extrabold text-ink">{t("adm.usrCreate")}</p>
          <button onClick={onClose}><X className="h-5 w-5 text-muted" /></button>
        </div>

        <div className="space-y-3">
          <Labeled label={t("adm.usrName")} hint={t("adm.usrNameHint")}>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
          </Labeled>
          <Labeled label={t("adm.usrEmail")}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className={inputCls} />
          </Labeled>
          <Labeled label={t("adm.usrPhone")}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="+965…" className={inputCls} />
          </Labeled>
          <Labeled label={t("adm.usrPassword")} hint={t("adm.usrPasswordHint")}>
            <input value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className={inputCls} />
          </Labeled>
          <Labeled label={t("adm.usrCountry")}>
            <input value={country} onChange={(e) => setCountry(e.target.value)} dir="ltr" placeholder="KW" maxLength={4} className={inputCls} />
          </Labeled>

          <div className="flex gap-2">
            {(["personal", "business"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setAccountType(k)}
                className={`flex-1 rounded-2xl py-2.5 text-[13px] font-extrabold ${
                  accountType === k ? "bg-brand-600 text-white" : "border border-black/10 text-muted"
                }`}
              >
                {t(`adm.usrType_${k}`)}
              </button>
            ))}
          </div>

          {error && <p className="text-[12.5px] font-bold text-red-600">{error}</p>}

          <p className="text-[11.5px] font-semibold text-muted">{t("adm.usrNoOtpNote")}</p>

          <button
            onClick={submit}
            disabled={!valid || busy}
            className="w-full rounded-2xl bg-brand-600 py-3 text-[14px] font-extrabold text-white disabled:opacity-40"
          >
            {busy ? "…" : t("adm.usrCreate")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── manage one member ───────────────────────── */

function ManageSheet({
  user,
  onClose,
  onAct,
}: {
  user: Row;
  onClose: () => void;
  onAct: (userId: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const { t, locale, dir } = useI18n();
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<Feature[]>(user.blockedFeatures);
  const [busy, setBusy] = useState(false);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    await onAct(user.id, body);
    setBusy(false);
  }

  const toggle = (f: Feature) =>
    setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]));

  return (
    <div data-no-pull-refresh dir={dir} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[88vh] w-full max-w-[440px] overflow-y-auto rounded-3xl bg-white p-5">
        <div className="mb-1 flex items-center justify-between">
          <p className="truncate text-[16px] font-extrabold text-ink">{user.name}</p>
          <button onClick={onClose}><X className="h-5 w-5 text-muted" /></button>
        </div>
        <p className="mb-3 truncate text-[12px] font-semibold text-muted" dir="ltr">{user.email || user.phone}</p>

        {/* Opens the member's public profile in a new tab, so the dashboard and whatever
            block you were about to apply stay where they are. */}
        <a
          href={`/business/${user.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-black/10 py-2.5 text-[13px] font-extrabold text-ink"
        >
          <ExternalLink className="h-4 w-4" />
          {t("adm.usrViewProfile")}
        </a>

        {/* current state */}
        {user.suspended && (
          <div className="mb-4 rounded-2xl bg-red-50 p-3">
            <p className="text-[12.5px] font-extrabold text-red-700">
              {t("adm.usrBlockedFor").replace("{n}", ld(user.daysLeft, locale))}
            </p>
            {user.suspendReason && <p className="mt-1 text-[12px] font-semibold text-red-700/80">{user.suspendReason}</p>}
          </div>
        )}

        {/* duration + reason, shared by both block and restrict */}
        <Labeled label={t("adm.usrDays")} hint={t("adm.usrDaysHint")}>
          <input
            type="number"
            min={0}
            max={3650}
            value={days}
            onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))}
            dir="ltr"
            className={inputCls}
          />
        </Labeled>
        <div className="h-3" />
        <Labeled label={t("adm.usrReason")} hint={t("adm.usrReasonHint")}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </Labeled>

        {/* which features */}
        <p className="mb-2 mt-4 text-[13px] font-extrabold text-ink">{t("adm.usrRestrictWhat")}</p>
        <div className="flex flex-wrap gap-2">
          {FEATURES.map((f) => (
            <button
              key={f}
              onClick={() => toggle(f)}
              className={`rounded-2xl px-3 py-2 text-[12.5px] font-extrabold transition-colors ${
                picked.includes(f) ? "bg-amber-500 text-white" : "border border-black/10 text-muted"
              }`}
            >
              {t(`adm.feat_${f}`)}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          <button
            onClick={() => run({ action: "restrict", days, reason, features: picked })}
            disabled={busy || picked.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-40"
          >
            <Ban className="h-4 w-4" />
            {t("adm.usrApplyRestrict")}
          </button>

          <button
            onClick={() => run({ action: "block", days, reason })}
            disabled={busy || days < 1}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-40"
          >
            <ShieldBan className="h-4 w-4" />
            {t("adm.usrBlockAll")}
          </button>

          <button
            onClick={() => run({ action: "unblock" })}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-black/10 py-3 text-[13.5px] font-extrabold text-ink disabled:opacity-40"
          >
            <ShieldCheck className="h-4 w-4" />
            {t("adm.usrLift")}
          </button>

          {user.disabled ? (
            <button
              onClick={() => run({ action: "restore" })}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-black/10 py-3 text-[13.5px] font-extrabold text-ink disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              {t("adm.usrRestore")}
            </button>
          ) : (
            <button
              onClick={() => run({ action: "disable", reason })}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 py-3 text-[13.5px] font-extrabold text-red-600 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              {t("adm.usrDisable")}
            </button>
          )}
          <p className="text-[11.5px] font-semibold text-muted">{t("adm.usrDisableNote")}</p>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── small shared bits ───────────────────────── */

const inputCls =
  "w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-[13.5px] font-semibold text-ink outline-none";

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-extrabold text-ink">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] font-semibold text-muted">{hint}</p>}
    </div>
  );
}
