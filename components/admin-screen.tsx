"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Save, Mail, Info, MessageSquareText, Scale, LogOut,
  BarChart3, Flag, FileText, Users, Crown, Megaphone, Briefcase, Ban, Clock, ShieldAlert,
  Archive, Globe2, UserPlus, Lock, LockOpen, Camera, Link2, X, Gift, Search, Send, Check, Printer,
} from "lucide-react";
import { useI18n, ld } from "@/lib/i18n";
import { useRequireAuth } from "@/lib/use-auth";
import { apiGet, apiPatch, apiPost, apiUpload, apiDelete, getAccessToken } from "@/lib/api";
import { getCountry, COUNTRIES } from "@/lib/countries";
import { invalidateOpenCountries } from "@/lib/use-open-countries";

type Settings = {
  adminEmail: string; supportPhone: string; whatsapp: string;
  aboutAr: string; aboutEn: string;
  complaintsInfo: string; inquiriesInfo: string;
  legalRepName: string; legalRepEmail: string; legalRepPhone: string;
  legalRepAvatar: string; legalRepUserId: string;
  address: string;
  closedCountries: string; // CSV of ISO codes the admin switched off
  sponsorName: string; sponsorLogo: string; sponsorText: string; sponsorUrl: string;
  priceSubscription: number; priceSub3m: number; priceSub6m: number; priceSub12m: number; // USD bundles
  priceJobApply: number; priceJobPost: number; priceSeekerAd: number;
  priceAdBase: number; priceAdExtraCountry: number; priceAdExtraDay: number; // USD, ad formula
  subEnabled: boolean; adsEnabled: boolean; jobsEnabled: boolean; // master on/off switches
};

const EMPTY: Settings = {
  adminEmail: "", supportPhone: "", whatsapp: "",
  aboutAr: "", aboutEn: "",
  complaintsInfo: "", inquiriesInfo: "",
  legalRepName: "", legalRepEmail: "", legalRepPhone: "",
  legalRepAvatar: "", legalRepUserId: "",
  address: "",
  closedCountries: "",
  sponsorName: "", sponsorLogo: "", sponsorText: "", sponsorUrl: "",
  priceSubscription: 4.99, priceSub3m: 13.99, priceSub6m: 26.99, priceSub12m: 53.99,
  priceJobApply: 0, priceJobPost: 1.99, priceSeekerAd: 0.99,
  priceAdBase: 49.99, priceAdExtraCountry: 15, priceAdExtraDay: 11,
  subEnabled: true, adsEnabled: true, jobsEnabled: true,
};

/** Shrink an uploaded photo to a 256px JPEG data URL — same treatment as member avatars. */
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 256;
      const scale = Math.min(max / img.width, max / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no ctx"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

type Stats = {
  totalUsers: number; newUsers: number; premiumUsers: number; businessUsers: number; suspendedUsers: number;
  subscriptionCount: number; subscriptionRevenue: number;
  adsCount: number; advertisers: number; adRevenue: number;
  jobsCount: number; jobPosters: number; jobRevenue: number;
  reportsOpen: number; reportsTotal: number;
  blockedPeople: number;
};

type RepUser = { id: string; name: string; email?: string | null; avatarUrl?: string | null; country?: string | null; suspendedUntil?: string | null };
type Rep = {
  id: string; kind: string; reason: string | null; status: string; createdAt: string;
  reporter: RepUser | null; target: RepUser | null; mediaUrl: string | null; contentText: string | null;
};

type Tab = "stats" | "archive" | "reports" | "countries" | "grants" | "sponsor" | "invoices" | "broadcast" | "page";

type Invoice = {
  id: string; number: string; customerName: string; kind: string;
  description: string; amount: number; currency: string; createdAt: string;
};

type PromoUser = {
  id: string; name: string; email?: string | null; phone?: string | null; avatarUrl?: string | null;
  country?: string | null; accountType: string;
  promoVideoUrl: string | null; promoLinkUrl: string | null; parentId: string | null;
  branches: { id: string; name: string; url: string }[];
};

type GrantUser = {
  id: string; name: string; email?: string | null; phone?: string | null; avatarUrl?: string | null;
  country?: string | null; accountType: string; isPremium: boolean; premiumUntil: string | null; isAdmin: boolean;
  freeAdsLeft: number; freeJobPostLeft: number; freeSeekerLeft: number;
};

type SuspUser = {
  id: string; name: string; email?: string | null; phone?: string | null; avatarUrl?: string | null;
  country?: string | null; suspendedUntil: string | null; reason?: string | null;
};

type CountryStat = { code: string; users: number; closed: boolean };

/** The running month as "YYYY-MM" — everything resets around it on the 1st. */
function currentMonth(): string {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The owner's dashboard — a real desktop admin panel: sidebar, wide grids, tables. */
export default function AdminScreen() {
  const router = useRouter();
  const { t, dir, locale, setLocale } = useI18n();
  const ready = useRequireAuth();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [isOwner, setIsOwner] = useState(false); // THE owner sees admin management + the approval queue
  const [grantReqs, setGrantReqs] = useState<{ id: string; requester: { id: string; name: string }; target: { id: string; name: string; avatarUrl: string | null }; months: number | null; until: string | null }[]>([]);
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("stats");
  const [toast, setToast] = useState<string | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [countries, setCountries] = useState<CountryStat[]>([]);
  const [selCountry, setSelCountry] = useState("all");
  const [countryQ, setCountryQ] = useState(""); // search box on the Countries tab
  const [period, setPeriod] = useState<"month" | "all">("month"); // stats default to the running month
  // stat-card drilldown: the list of records behind a clicked number
  type StatRow = { id: string; title: string; subtitle?: string; meta?: string; userId?: string; suspended?: boolean };
  const [statList, setStatList] = useState<{ kind: string; rows: StatRow[] } | null>(null);
  const [statQ, setStatQ] = useState(""); // search within the drilldown
  const [statOpenId, setStatOpenId] = useState<string | null>(null); // which row's actions are showing
  const [months, setMonths] = useState<string[]>([]);

  // archive — any past month, replayed on demand
  const [archStats, setArchStats] = useState<Stats | null>(null);
  const [archMonth, setArchMonth] = useState<string>(currentMonth());
  const [archCountry, setArchCountry] = useState("all");
  const [archReports, setArchReports] = useState<Rep[]>([]); // archived reports, shown on the Archive page too

  const [repView, setRepView] = useState<"reports" | "archived" | "suspended" | "ads" | "jobs">("reports");
  const [modAds, setModAds] = useState<{ id: string; caption: string | null; mediaUrl: string | null; status: string; views: number; advertiser: string; createdAt: string }[]>([]);
  const [modJobs, setModJobs] = useState<{ id: string; title: string; imageUrl: string | null; status: string; advertiser: string; userId: string; createdAt: string }[]>([]);
  const [modSeekers, setModSeekers] = useState<{ id: string; title: string; imageUrl: string | null; status: string; advertiser: string; userId: string; createdAt: string }[]>([]);
  const [modAdsQ, setModAdsQ] = useState("");
  const [suspended, setSuspended] = useState<SuspUser[]>([]);
  const [reports, setReports] = useState<Rep[]>([]);
  const [days, setDays] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({}); // optional extra text for the suspension message
  const [repCountries, setRepCountries] = useState<{ code: string; count: number }[]>([]);
  const [repCountry, setRepCountry] = useState("all");
  const [search, setSearch] = useState("");

  // grants — gift premium and free-posting rights to specific members
  const [grantQ, setGrantQ] = useState("");
  const [grantResults, setGrantResults] = useState<GrantUser[]>([]);
  const [grantSel, setGrantSel] = useState<GrantUser | null>(null);
  // bulk-revoke of gifted perks
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeScope, setRevokeScope] = useState<"all" | "country" | "user">("all");
  const [revokeCountry, setRevokeCountry] = useState("KW");
  const [busyRevoke, setBusyRevoke] = useState(false);
  const [grantDate, setGrantDate] = useState("");
  const [busyGrant, setBusyGrant] = useState(false);

  // sponsor & branches — the official sponsor's account, pinned video/link, branch links
  const [spQ, setSpQ] = useState("");
  const [spResults, setSpResults] = useState<GrantUser[]>([]);
  const [spSel, setSpSel] = useState<PromoUser | null>(null);
  const [sponsorUserId, setSponsorUserId] = useState("");
  const [spLink, setSpLink] = useState("");
  const [brName, setBrName] = useState("");
  const [brUrl, setBrUrl] = useState("");
  const [busyPromo, setBusyPromo] = useState(false);

  // broadcast messaging
  const [bcScope, setBcScope] = useState<"user" | "countries" | "all">("user");
  const [bcQ, setBcQ] = useState("");
  const [bcResults, setBcResults] = useState<GrantUser[]>([]);
  const [bcUser, setBcUser] = useState<GrantUser | null>(null);
  const [bcCountries, setBcCountries] = useState<string[]>([]);
  const [bcCountryQ, setBcCountryQ] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcBusy, setBcBusy] = useState(false);

  // invoices
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invTotal, setInvTotal] = useState(0);
  const [selInv, setSelInv] = useState<Set<string>>(new Set()); // invoices ticked for printing
  const [invQ, setInvQ] = useState("");
  const [invFrom, setInvFrom] = useState("");
  const [invTo, setInvTo] = useState("");
  const [invView, setInvView] = useState<Invoice | null>(null);

  const [s, setS] = useState<Settings>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [lawyerAccount, setLawyerAccount] = useState(""); // email/phone typed by the admin to link the lawyer's account

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2600); }

  const loadStats = useCallback(async (country: string, p: "month" | "all") => {
    const periodParam = p === "month" ? currentMonth() : "all";
    const res = await apiGet<{ stats: Stats; countries: CountryStat[]; months: string[] }>(
      `/api/admin/stats?country=${encodeURIComponent(country)}&period=${periodParam}`, getAccessToken() || undefined);
    if (res.ok && res.data) { setStats(res.data.stats); setCountries(res.data.countries); setMonths(res.data.months); }
  }, []);

  const loadSuspended = useCallback(async () => {
    const res = await apiGet<{ users: SuspUser[] }>("/api/admin/suspend", getAccessToken() || undefined);
    if (res.ok && res.data?.users) setSuspended(res.data.users);
  }, []);

  const loadArchive = useCallback(async (month: string, country: string) => {
    const res = await apiGet<{ stats: Stats }>(
      `/api/admin/stats?country=${encodeURIComponent(country)}&period=${encodeURIComponent(month)}`,
      getAccessToken() || undefined);
    if (res.ok && res.data) setArchStats(res.data.stats);
  }, []);

  // archived (reviewed) reports — surfaced on the Archive page as well as the Reports tab
  const loadArchReports = useCallback(async (country = "all") => {
    const res = await apiGet<{ reports: Rep[] }>(
      `/api/admin/reports?country=${encodeURIComponent(country)}&archived=1`,
      getAccessToken() || undefined);
    if (res.ok && res.data?.reports) setArchReports(res.data.reports);
  }, []);

  const loadReports = useCallback(async (country = "all", q = "", archived = false) => {
    const res = await apiGet<{ reports: Rep[]; countries: { code: string; count: number }[] }>(
      `/api/admin/reports?country=${encodeURIComponent(country)}&q=${encodeURIComponent(q)}${archived ? "&archived=1" : ""}`,
      getAccessToken() || undefined
    );
    if (res.ok && res.data?.reports) {
      setReports(res.data.reports);
      setRepCountries(res.data.countries ?? []);
    }
  }, []);

  // defined before the boot effect below — they're in its dependency list
  const loadGrantReqs = useCallback(async () => {
    const res = await apiGet<{ requests: typeof grantReqs }>("/api/admin/grant-requests", getAccessToken() || undefined);
    if (res.ok && res.data?.requests) setGrantReqs(res.data.requests);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAdmins = useCallback(async () => {
    const res = await apiGet<{ admins: { id: string }[] }>("/api/admin/admins", getAccessToken() || undefined);
    if (res.ok && res.data?.admins) setAdminIds(new Set(res.data.admins.map((a) => a.id)));
  }, []);

  const loadSponsor = useCallback(async (userId?: string) => {
    const res = await apiGet<{ sponsorUserId: string; user: PromoUser | null }>(
      `/api/admin/promo${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`, getAccessToken() || undefined);
    if (res.ok && res.data) {
      setSponsorUserId(res.data.sponsorUserId);
      if (res.data.user) { setSpSel(res.data.user); setSpLink(res.data.user.promoLinkUrl ?? ""); }
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const token = getAccessToken();
    if (!token) return;
    apiGet<{ user: { isAdmin?: boolean; isOwner?: boolean } }>("/api/auth/me", token).then((r) => {
      const ok = !!(r.ok && r.data?.user?.isAdmin);
      setAllowed(ok);
      if (!ok) { router.replace("/home"); return; }
      if (r.data?.user?.isOwner) { setIsOwner(true); loadGrantReqs(); loadAdmins(); }
      loadStats("all", "month");
      loadArchive(currentMonth(), "all");
      loadReports();
      loadSponsor(); // the current sponsor, ready when the tab opens
      apiGet<{ settings: Settings }>("/api/settings").then((rs) => {
        if (rs.ok && rs.data?.settings) setS({ ...EMPTY, ...rs.data.settings });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, router, loadStats, loadArchive, loadReports, loadSponsor]);

  // load the invoice list the first time that tab opens
  useEffect(() => {
    if (tab === "invoices" && invoices.length === 0) loadInvoices();
    if (tab === "archive") loadArchReports(archCountry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function pickCountry(code: string) { setSelCountry(code); loadStats(code, period); }
  function pickPeriod(p: "month" | "all") { setPeriod(p); loadStats(selCountry, p); }

  /** Open the list of records behind a stat card. */
  async function openStatList(kind: string, country: string, periodParam: string) {
    setStatQ(""); setStatOpenId(null);
    const res = await apiGet<{ rows: StatRow[] }>(
      `/api/admin/stat-list?kind=${kind}&country=${encodeURIComponent(country)}&period=${periodParam}`, getAccessToken() || undefined);
    if (res.ok && res.data) setStatList({ kind, rows: res.data.rows });
    else flash(t("common.error"));
  }

  /** Suspend (30 days) or lift a suspension straight from the drilldown list. */
  async function suspendFromList(userId: string, suspend: boolean) {
    const res = await apiPost("/api/admin/suspend", { userId, days: suspend ? 30 : 0 }, getAccessToken() || undefined);
    if (res.ok) {
      setStatList((sl) => (sl ? { ...sl, rows: sl.rows.map((r) => (r.userId === userId ? { ...r, suspended: suspend } : r)) } : sl));
      flash(suspend ? t("adm.suspendDone") : t("adm.liftDone"));
    } else flash(t("common.error"));
  }

  /** Permanently remove an account from the drilldown list. */
  async function removeFromList(userId: string) {
    if (!confirm(t("adm.removeConfirm"))) return;
    const res = await apiDelete(`/api/admin/users?id=${encodeURIComponent(userId)}`, getAccessToken() || undefined);
    if (res.ok) {
      setStatList((sl) => (sl ? { ...sl, rows: sl.rows.filter((r) => r.userId !== userId) } : sl));
      flash(t("adm.removeDone"));
    } else flash(t("common.error"));
  }
  function pickArchMonth(m: string) { setArchMonth(m); loadArchive(m, archCountry); }
  function pickArchCountry(code: string) { setArchCountry(code); loadArchive(archMonth, code); loadArchReports(code); }

  // ----- countries open/close -----
  const closedSet = new Set(s.closedCountries.split(",").map((c) => c.trim()).filter(Boolean));
  async function toggleCountry(code: string) {
    const next = new Set(closedSet);
    if (next.has(code)) next.delete(code); else next.add(code);
    const csv = [...next].join(",");
    const res = await apiPatch("/api/settings", { closedCountries: csv }, getAccessToken() || undefined);
    if (res.ok) {
      setS((prev) => ({ ...prev, closedCountries: csv }));
      invalidateOpenCountries();
      flash(next.has(code) ? t("adm.countryClosedDone") : t("adm.countryOpenedDone"));
      loadStats(selCountry, period); // refresh the closed badges on the pickers
    } else flash(t("common.error"));
  }

  async function suspend(rep: Rep, liftIt: boolean) {
    if (!rep.target) return;
    const n = liftIt ? 0 : Math.max(1, parseInt(days[rep.id] || "3", 10) || 3);
    // The app sends the generic suspension message automatically; the admin's
    // note (or the report reason) rides along as the stated cause.
    const res = await apiPost("/api/admin/suspend", {
      userId: rep.target.id, days: n, reason: (notes[rep.id]?.trim() || rep.reason) || undefined, reportId: rep.id,
    }, getAccessToken() || undefined);
    if (res.ok) { flash(liftIt ? t("adm.liftDone") : t("adm.suspendDone")); loadReports(repCountry, search); loadStats(selCountry, period); }
    else flash(t("common.error"));
  }

  async function markReviewed(rep: Rep) {
    await apiPatch("/api/admin/reports", { id: rep.id, status: "reviewed" }, getAccessToken() || undefined);
    loadReports(repCountry, search, repView === "archived");
    loadArchReports(archCountry); // keep the Archive page's copy in sync
  }

  function pickRepCountry(code: string) { setRepCountry(code); loadReports(code, search); }
  function runSearch() { loadReports(repCountry, search, repView === "archived"); }

  // ----- invoices -----
  async function loadInvoices() {
    const p = new URLSearchParams();
    if (invQ.trim()) p.set("q", invQ.trim());
    if (invFrom) p.set("from", invFrom);
    if (invTo) p.set("to", invTo);
    const res = await apiGet<{ total: number; invoices: Invoice[] }>(`/api/admin/invoices?${p.toString()}`, getAccessToken() || undefined);
    if (res.ok && res.data) { setInvoices(res.data.invoices); setInvTotal(res.data.total); setSelInv(new Set()); }
  }
  function toggleInv(id: string) {
    setSelInv((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleInvAll() {
    setSelInv((s) => (s.size === invoices.length ? new Set() : new Set(invoices.map((i) => i.id))));
  }
  // Print the ticked invoices (or all of them if none is ticked) via a clean print window.
  function printInvoices(only?: Invoice[]) {
    const list = only ?? (selInv.size ? invoices.filter((i) => selInv.has(i.id)) : invoices);
    if (!list.length) return;
    const esc = (v: string) => String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const logo = `${location.origin}/prfet-logo.png`;
    const sheets = list.map((inv) => `
      <div class="inv">
        <div class="top"><img src="${logo}" alt="PRFET"/><div class="num"><div class="lbl">INVOICE</div><div class="val">${esc(inv.number)}</div></div></div>
        <div class="meta"><div><div class="lbl">Billed to</div><div class="val">${esc(inv.customerName || "—")}</div></div>
        <div class="r"><div class="lbl">Date</div><div class="val">${new Date(inv.createdAt).toLocaleDateString("en-GB")}</div></div></div>
        <div class="box"><div class="line"><span>${esc(invKindLabel(inv.kind, false))}</span><span>$${inv.amount}</span></div>
        <div class="total"><span>Total</span><span>$${inv.amount} ${esc(inv.currency)}</span></div></div>
        <p class="foot">PRFET · Thank you</p>
      </div>`).join("");
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>PRFET Invoices</title><style>
      *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
      body{margin:0;color:#0f1330}
      .inv{padding:40px;max-width:640px;margin:0 auto;page-break-after:always}
      .top{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eef;padding-bottom:16px}
      .top img{height:34px}
      .lbl{font-size:11px;color:#8890a5;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
      .val{font-size:14px;font-weight:800}
      .num{text-align:right}
      .meta{display:flex;justify-content:space-between;padding:18px 0}
      .r{text-align:right}
      .box{background:#f6f7fb;border-radius:16px;padding:18px}
      .line{display:flex;justify-content:space-between;font-size:14px;font-weight:700}
      .total{display:flex;justify-content:space-between;border-top:1px solid #e3e6f0;margin-top:14px;padding-top:14px;font-size:16px;font-weight:800;color:#047857}
      .foot{text-align:center;color:#8890a5;font-size:11px;margin-top:20px}
      @media print{.inv:last-child{page-break-after:auto}}
    </style></head><body>${sheets}<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`);
    w.document.close();
  }

  // ----- grants -----
  async function searchGrantUsers() {
    const res = await apiGet<{ users: GrantUser[] }>(
      `/api/admin/users?q=${encodeURIComponent(grantQ.trim())}`, getAccessToken() || undefined);
    if (res.ok && res.data?.users) { setGrantResults(res.data.users); setGrantSel(null); }
  }

  async function grant(payload: Record<string, unknown>) {
    if (!grantSel || busyGrant) return;
    setBusyGrant(true);
    const res = await apiPost<{ user?: GrantUser; pending?: boolean }>("/api/admin/grant", { userId: grantSel.id, ...payload }, getAccessToken() || undefined);
    setBusyGrant(false);
    if (res.ok && res.data?.pending) {
      // a sub-admin's gift — parked in the owner's queue
      flash(t("adm.grantPending"));
    } else if (res.ok && res.data?.user) {
      const u = res.data.user;
      setGrantSel(u);
      setGrantResults((list) => list.map((x) => (x.id === u.id ? u : x)));
      flash(t("adm.grantDone"));
    } else flash(t("common.error"));
  }

  async function doRevokeGifts() {
    if (busyRevoke) return;
    if (revokeScope === "user" && !grantSel) { flash(t("adm.revokePickPerson")); return; }
    if (!confirm(t("adm.revokeConfirm"))) return;
    setBusyRevoke(true);
    const body: Record<string, unknown> = { scope: revokeScope };
    if (revokeScope === "country") body.country = revokeCountry;
    if (revokeScope === "user") body.userId = grantSel!.id;
    const res = await apiPost<{ revokedPremium: number; revokedFreePosting: number }>("/api/admin/revoke-gifts", body, getAccessToken() || undefined);
    setBusyRevoke(false);
    setRevokeOpen(false);
    if (res.ok && res.data) {
      flash(`${t("adm.revokeDone")}: ${ld(res.data.revokedPremium, locale)} + ${ld(res.data.revokedFreePosting, locale)}`);
      if (grantSel && (revokeScope === "user" || revokeScope === "all")) searchGrantUsers();
    } else flash(t("common.error"));
  }

  // ----- owner-only: admins + the approval queue -----
  async function decideGrantReq(id: string, approve: boolean) {
    const res = await apiPost("/api/admin/grant-requests", { id, approve }, getAccessToken() || undefined);
    if (res.ok) { flash(t("adm.grantDone")); loadGrantReqs(); }
    else flash(t("common.error"));
  }

  async function toggleAdmin(userId: string, makeAdmin: boolean) {
    const res = await apiPost("/api/admin/admins", { userId, makeAdmin }, getAccessToken() || undefined);
    if (res.ok) { flash(t("adm.grantDone")); loadAdmins(); }
    else flash(t("common.error"));
  }

  // ----- sponsor & branches -----
  async function searchSponsorUsers(q: string, into: (u: GrantUser[]) => void) {
    const res = await apiGet<{ users: GrantUser[] }>(
      `/api/admin/users?q=${encodeURIComponent(q.trim())}`, getAccessToken() || undefined);
    if (res.ok && res.data?.users) into(res.data.users);
  }

  async function promo(payload: Record<string, unknown>) {
    if (!spSel || busyPromo) return;
    setBusyPromo(true);
    const res = await apiPost<{ sponsorUserId: string; user: PromoUser | null }>(
      "/api/admin/promo", { userId: spSel.id, ...payload }, getAccessToken() || undefined);
    setBusyPromo(false);
    if (res.ok && res.data) {
      setSponsorUserId(res.data.sponsorUserId);
      if (res.data.user) { setSpSel(res.data.user); setSpLink(res.data.user.promoLinkUrl ?? ""); }
      flash(t("adm.grantDone"));
    } else flash(t("common.error"));
  }

  async function uploadPromoVideo(file: File) {
    if (!spSel || busyPromo) return;
    setBusyPromo(true);
    const up = await apiUpload<{ url: string }>("/api/upload", file, getAccessToken() || undefined);
    setBusyPromo(false);
    if (up.ok && up.data?.url) promo({ videoUrl: up.data.url });
    else flash(t("common.error"));
  }

  /** The "Suspended accounts" stat card lands here — straight onto the list. */
  function openSuspended() { setTab("reports"); setRepView("suspended"); loadSuspended(); }

  async function loadModAds() {
    const res = await apiGet<{ ads: typeof modAds }>(`/api/admin/ads?q=${encodeURIComponent(modAdsQ.trim())}`, getAccessToken() || undefined);
    if (res.ok && res.data?.ads) setModAds(res.data.ads);
  }
  async function loadModJobs() {
    const res = await apiGet<{ jobs: typeof modJobs; seekers: typeof modSeekers }>(`/api/admin/jobs?q=${encodeURIComponent(modAdsQ.trim())}`, getAccessToken() || undefined);
    if (res.ok && res.data) { setModJobs(res.data.jobs ?? []); setModSeekers(res.data.seekers ?? []); }
  }
  async function moderateAd(id: string, action: "stop" | "delete" | "activate") {
    if (action === "delete" && !confirm(t("adm.adDeleteConfirm"))) return;
    const res = await apiPost("/api/admin/ads", { id, action }, getAccessToken() || undefined);
    if (res.ok) { flash(t("adm.grantDone")); loadModAds(); } else flash(t("common.error"));
  }
  async function moderateJob(kind: "job" | "seeker", id: string, action: "stop" | "delete" | "activate") {
    if (action === "delete" && !confirm(t("adm.adDeleteConfirm"))) return;
    const res = await apiPost("/api/admin/jobs", { kind, id, action }, getAccessToken() || undefined);
    if (res.ok) { flash(t("adm.grantDone")); loadModJobs(); } else flash(t("common.error"));
  }

  async function unsuspendUser(u: SuspUser) {
    const res = await apiPost("/api/admin/suspend", { userId: u.id, days: 0 }, getAccessToken() || undefined);
    if (res.ok) { flash(t("adm.liftDone")); loadSuspended(); loadStats(selCountry, period); }
    else flash(t("common.error"));
  }

  async function sendBroadcast() {
    if (bcBusy || !bcBody.trim()) return;
    if (bcScope === "user" && !bcUser) { flash(t("common.error")); return; }
    if (bcScope === "countries" && bcCountries.length === 0) { flash(t("common.error")); return; }
    if (bcScope === "all" && !confirm(t("adm.bcConfirmAll"))) return;
    setBcBusy(true);
    const res = await apiPost<{ sent: number }>("/api/admin/broadcast", {
      scope: bcScope,
      userId: bcScope === "user" ? bcUser?.id : undefined,
      countries: bcScope === "countries" ? bcCountries : undefined,
      body: bcBody.trim(),
    }, getAccessToken() || undefined);
    setBcBusy(false);
    if (res.ok && res.data) { flash(`${t("adm.bcSent")} · ${res.data.sent}`); setBcBody(""); }
    else flash(t("common.error"));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    // the account box only travels when the admin typed something — otherwise the link stays as-is
    const payload = lawyerAccount.trim() ? { ...s, legalRepAccount: lawyerAccount.trim() } : s;
    const res = await apiPatch<{ settings?: Settings; error?: string }>("/api/settings", payload, getAccessToken() || undefined);
    setBusy(false);
    if (res.ok) {
      if (res.data?.settings) setS({ ...EMPTY, ...res.data.settings });
      setLawyerAccount("");
      flash(t("admin.saved"));
    } else flash(t(res.data?.error === "lawyer_not_found" ? "admin.legalNotFound" : "common.error"));
  }

  async function unlinkLawyer() {
    const res = await apiPatch<{ settings?: Settings }>("/api/settings", { legalRepAccount: "" }, getAccessToken() || undefined);
    if (res.ok) { setS((prev) => ({ ...prev, legalRepUserId: "" })); flash(t("admin.saved")); }
    else flash(t("common.error"));
  }

  async function pickLawyerPhoto(file: File) {
    try { set("legalRepAvatar", await fileToAvatar(file)); } catch { /* ignore a bad file */ }
  }
  function set<K extends keyof Settings>(k: K, v: Settings[K]) { setS((prev) => ({ ...prev, [k]: v })); }

  /** Master feature switch — applies immediately (not waiting for the Save button). */
  async function toggleFeature(k: "subEnabled" | "adsEnabled" | "jobsEnabled", next: boolean) {
    set(k, next);
    const res = await apiPatch<{ settings?: Settings }>("/api/settings", { [k]: next }, getAccessToken() || undefined);
    if (res.ok) flash(t("admin.saved"));
    else { set(k, !next); flash(t("common.error")); }
  }

  if (!ready || allowed !== true) return null;

  const NAV: { k: Tab; icon: React.ReactNode; label: string; badge?: number }[] = [
    { k: "stats", icon: <BarChart3 className="h-[18px] w-[18px]" />, label: t("adm.tabStats") },
    { k: "archive", icon: <Archive className="h-[18px] w-[18px]" />, label: t("adm.tabArchive") },
    { k: "reports", icon: <Flag className="h-[18px] w-[18px]" />, label: t("adm.tabReports"), badge: stats?.reportsOpen || 0 },
    { k: "countries", icon: <Globe2 className="h-[18px] w-[18px]" />, label: t("adm.tabCountries"), badge: closedSet.size },
    { k: "grants", icon: <Gift className="h-[18px] w-[18px]" />, label: t("adm.tabGrants") },
    { k: "sponsor", icon: <Crown className="h-[18px] w-[18px]" />, label: t("adm.tabSponsor") },
    { k: "invoices", icon: <FileText className="h-[18px] w-[18px]" />, label: t("adm.tabInvoices") },
    { k: "broadcast", icon: <Send className="h-[18px] w-[18px]" />, label: t("adm.tabBroadcast") },
    { k: "page", icon: <FileText className="h-[18px] w-[18px]" />, label: t("adm.tabPage") },
  ];

  /** "2026-07" → "July 2026" / "يوليو ٢٠٢٦". */
  const monthLabel = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(locale === "ar" ? "ar" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  };

  return (
    <div dir={dir} className="flex min-h-[100dvh]">
      {/* ===== sidebar (top bar on phones) ===== */}
      <aside className="fixed inset-x-0 top-0 z-20 flex items-center gap-1 bg-[#131743] px-3 py-2 md:sticky md:top-0 md:h-[100dvh] md:w-60 md:shrink-0 md:flex-col md:items-stretch md:gap-0 md:px-4 md:py-6">
        <p className="hidden text-[19px] font-extrabold text-white md:block">PRFET</p>
        <p className="mb-0 hidden text-[11.5px] font-bold text-white/50 md:mb-6 md:block">{t("admin.title")}</p>
        <nav className="flex flex-1 items-center gap-1 md:flex-none md:flex-col md:items-stretch md:gap-1.5">
          {NAV.map((o) => (
            <button key={o.k} onClick={() => setTab(o.k)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-colors md:flex-none md:justify-start ${
                tab === o.k ? "bg-white text-[#131743]" : "text-white/75 hover:bg-white/10"
              }`}>
              {o.icon}
              <span>{o.label}</span>
              {!!o.badge && (
                <span className="ms-auto hidden rounded-full bg-red-500 px-2 py-0.5 text-[10.5px] font-extrabold text-white md:inline">{ld(o.badge, locale)}</span>
              )}
              {!!o.badge && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-extrabold text-white md:hidden">{ld(o.badge, locale)}</span>}
            </button>
          ))}
        </nav>
        {/* dashboard language — flips instantly, saved like everywhere else in the app */}
        <button onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
          className="flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold text-white/75 hover:bg-white/10 md:mt-auto md:justify-start">
          <Globe2 className="h-[18px] w-[18px]" /> <span>{locale === "ar" ? "English" : "العربية"}</span>
        </button>
        <button onClick={() => router.push("/home")}
          className="flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold text-white/75 hover:bg-white/10 md:justify-start">
          <LogOut className="h-[18px] w-[18px]" /> <span className="hidden md:inline">{t("adm.backToApp")}</span>
        </button>
      </aside>

      {/* ===== main ===== */}
      <main className="w-full flex-1 px-4 pb-10 pt-16 md:px-8 md:pt-8 lg:px-12">
        {/* ---------- STATS ---------- */}
        {tab === "stats" && (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-[22px] font-extrabold text-ink">{t("adm.tabStats")}</h1>
                {/* the numbers roll over on the 1st — this flips between the running month and since-launch */}
                <div className="flex overflow-hidden rounded-full ring-1 ring-slate-200">
                  <button onClick={() => pickPeriod("month")}
                    className={`px-3.5 py-1.5 text-[12px] font-extrabold ${period === "month" ? "bg-[#131743] text-white" : "bg-white text-muted hover:text-ink"}`}>
                    {t("adm.thisMonth")}
                  </button>
                  <button onClick={() => pickPeriod("all")}
                    className={`px-3.5 py-1.5 text-[12px] font-extrabold ${period === "all" ? "bg-[#131743] text-white" : "bg-white text-muted hover:text-ink"}`}>
                    {t("adm.allTime")}
                  </button>
                </div>
              </div>
              <CountryFilter value={selCountry} onPick={pickCountry} counts={countries} />
            </div>

            {stats && <StatsGrid stats={stats} monthMode={period === "month"} onReports={() => { setTab("reports"); setRepView("reports"); }} onSuspended={openSuspended} onOpen={(k) => openStatList(k, selCountry, period === "month" ? currentMonth() : "all")} />}
          </>
        )}

        {/* ---------- ARCHIVE — replay any past month ---------- */}
        {tab === "archive" && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-[22px] font-extrabold text-ink">{t("adm.tabArchive")}</h1>
              <CountryFilter value={archCountry} onPick={pickArchCountry} counts={countries} />
            </div>
            <p className="mb-4 text-[12.5px] font-medium text-muted">{t("adm.archiveHint")}</p>

            {/* month picker — newest first, back to the very first member */}
            <div className="no-scrollbar mb-6 flex items-center gap-2 overflow-x-auto pb-1">
              {months.map((m) => (
                <button key={m} onClick={() => pickArchMonth(m)}
                  className={`shrink-0 rounded-full px-4 py-2 text-[12.5px] font-bold ${archMonth === m ? "bg-[#131743] text-white" : "bg-white text-ink ring-1 ring-slate-200 hover:ring-slate-300"}`}>
                  {monthLabel(m)}{m === currentMonth() ? ` · ${t("adm.runningMonth")}` : ""}
                </button>
              ))}
            </div>

            {archStats && <StatsGrid stats={archStats} monthMode onReports={() => { setTab("reports"); setRepView("reports"); }} onSuspended={openSuspended} onOpen={(k) => openStatList(k, archCountry, archMonth)} />}

            {/* archived reports — a read-only copy of what's in Reports → Archived */}
            <div className="mt-8 mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[16px] font-extrabold text-ink">{t("adm.archivedReports")}</h2>
              <button onClick={() => { setTab("reports"); setRepView("archived"); loadReports(repCountry, search, true); }}
                className="text-[12px] font-bold text-brand-600 hover:underline">{t("adm.viewInReports")}</button>
            </div>
            {archReports.length === 0 ? (
              <div className="grid place-items-center rounded-3xl bg-white py-12 ring-1 ring-slate-200">
                <Archive className="h-8 w-8 text-slate-300" />
                <p className="mt-2 text-[13px] font-bold text-muted">{t("adm.noArchivedReports")}</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {archReports.map((r) => (
                  <div key={r.id} className="flex flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
                    <div className="flex flex-1 flex-col p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10.5px] font-extrabold text-brand-700">{t(`adm.kind.${r.kind}`)}</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-extrabold text-emerald-600">{t(`adm.status.${r.status}`)}</span>
                      </div>
                      <p className="text-[14px] font-extrabold text-ink">
                        {r.target ? r.target.name : "—"}
                        {r.target?.country && <span className="ms-1.5 text-[11.5px] font-medium text-muted">({getCountry(r.target.country)?.[locale] ?? r.target.country})</span>}
                      </p>
                      <p className="mt-0.5 text-[12px] font-medium text-muted">{t("adm.reportedBy")}: {r.reporter?.name ?? "—"} · {new Date(r.createdAt).toLocaleDateString(locale === "ar" ? "ar" : "en-GB")}</p>
                      {r.reason && <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[12.5px] font-medium text-ink">{t("adm.reason")}: {r.reason}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ---------- COUNTRIES — open / close any country ---------- */}
        {tab === "countries" && (
          <>
            <h1 className="mb-2 text-[22px] font-extrabold text-ink">{t("adm.tabCountries")}</h1>
            <p className="mb-4 max-w-2xl text-[12.5px] font-medium leading-relaxed text-muted">{t("adm.countriesHint")}</p>
            <div className="mb-5 flex h-11 max-w-md items-center gap-2 rounded-2xl bg-white px-3.5 ring-1 ring-slate-200 focus-within:ring-brand-400">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input value={countryQ} onChange={(e) => setCountryQ(e.target.value)} placeholder={t("country.search")}
                className="h-full flex-1 bg-transparent text-[13.5px] font-medium text-ink outline-none placeholder:text-muted" />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {COUNTRIES.filter((c) => {
                const q = countryQ.trim().toLowerCase();
                return !q || c.ar.includes(countryQ.trim()) || c.en.toLowerCase().includes(q) || c.code.toLowerCase() === q;
              }).map((c) => {
                const isClosed = closedSet.has(c.code);
                const users = countries.find((x) => x.code === c.code)?.users ?? 0;
                return (
                  <div key={c.code} className={`flex items-center gap-3 rounded-2xl p-3.5 ring-1 ${isClosed ? "bg-red-50/60 ring-red-200" : "bg-white ring-slate-200"}`}>
                    <span className="text-xl leading-none">{c.flag}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-extrabold text-ink">{c[locale]}</p>
                      <p className="text-[11.5px] font-medium text-muted">
                        {ld(users, locale)} {t("adm.users")}{isClosed ? ` · ${t("adm.closedBadge")}` : ""}
                      </p>
                    </div>
                    <button onClick={() => toggleCountry(c.code)}
                      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12px] font-extrabold active:scale-95 ${
                        isClosed ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-100 text-ink hover:bg-red-100 hover:text-red-600"
                      }`}>
                      {isClosed ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      {isClosed ? t("adm.reopenCountry") : t("adm.closeCountry")}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ---------- GRANTS — gift premium & free posting to specific members ---------- */}
        {tab === "grants" && (
          <>
            <h1 className="mb-2 text-[22px] font-extrabold text-ink">{t("adm.tabGrants")}</h1>
            <p className="mb-5 max-w-2xl text-[12.5px] font-medium leading-relaxed text-muted">{t("adm.grantHint")}</p>

            {/* the owner's approval queue — sub-admin gifts waiting for a verdict */}
            {isOwner && grantReqs.length > 0 && (
              <div className="mb-6 max-w-2xl rounded-3xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <p className="mb-3 text-[13px] font-extrabold text-amber-800">⏳ {t("adm.pendingReqs")} ({ld(grantReqs.length, locale)})</p>
                <div className="flex flex-col gap-2">
                  {grantReqs.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3.5 py-3 ring-1 ring-amber-100">
                      <p className="min-w-0 flex-1 text-[12.5px] font-bold text-ink">
                        {r.requester.name} ← 🎁 → <span className="font-extrabold">{r.target.name}</span>
                        <span className="ms-1.5 text-muted">
                          {r.months ? `(${ld(r.months, locale)} ${locale === "ar" ? "شهر" : "mo"})` : r.until ? `(${new Date(r.until).toLocaleDateString(locale === "ar" ? "ar" : "en-GB")})` : ""}
                        </span>
                      </p>
                      <button onClick={() => decideGrantReq(r.id, true)} className="h-9 rounded-xl bg-emerald-600 px-3.5 text-[12px] font-extrabold text-white hover:bg-emerald-700 active:scale-95">
                        {t("adm.approve")}
                      </button>
                      <button onClick={() => decideGrantReq(r.id, false)} className="h-9 rounded-xl bg-red-50 px-3.5 text-[12px] font-bold text-red-600 hover:bg-red-100 active:scale-95">
                        {t("adm.deny")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* find the member */}
            <div className="mb-5 flex w-full max-w-md items-center gap-2">
              <input
                value={grantQ}
                onChange={(e) => setGrantQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchGrantUsers(); }}
                placeholder={t("adm.grantSearchPh")}
                className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-4 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500"
              />
              <button onClick={searchGrantUsers} className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-[#131743] px-5 text-[13px] font-bold text-white active:scale-95">
                <Search className="h-4 w-4" /> {t("discover.search")}
              </button>
              {isOwner && (
                <button onClick={() => setRevokeOpen(true)} className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-red-50 px-4 text-[13px] font-bold text-red-600 ring-1 ring-red-200 hover:bg-red-100 active:scale-95">
                  <Ban className="h-4 w-4" /> {t("adm.revokeGifts")}
                </button>
              )}
            </div>

            {/* revoke gifted perks — all / a country / one person */}
            {revokeOpen && (
              <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setRevokeOpen(false)}>
                <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[15px] font-extrabold text-ink">{t("adm.revokeGifts")}</p>
                    <button onClick={() => setRevokeOpen(false)} aria-label={t("close")} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-ink"><X className="h-4 w-4" /></button>
                  </div>
                  <p className="mb-4 text-[12px] font-medium leading-relaxed text-muted">{t("adm.revokeHint")}</p>

                  <div className="mb-3 flex flex-col gap-1.5 rounded-2xl bg-slate-100 p-1.5">
                    {([
                      { v: "all" as const, label: t("adm.revokeAll") },
                      { v: "country" as const, label: t("adm.revokeCountry") },
                      { v: "user" as const, label: t("adm.revokePerson") },
                    ]).map((o) => (
                      <button key={o.v} onClick={() => setRevokeScope(o.v)}
                        className={`rounded-xl py-2.5 text-[13px] font-bold transition-all ${revokeScope === o.v ? "bg-white text-brand-700 shadow-sm" : "text-muted"}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>

                  {revokeScope === "country" && (
                    <select value={revokeCountry} onChange={(e) => setRevokeCountry(e.target.value)}
                      className="mb-3 h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500">
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c[locale]}</option>)}
                    </select>
                  )}
                  {revokeScope === "user" && (
                    <p className="mb-3 rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] font-bold text-ink">
                      {grantSel ? grantSel.name : t("adm.revokePickPerson")}
                    </p>
                  )}

                  <button onClick={doRevokeGifts} disabled={busyRevoke}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-500 text-[14px] font-extrabold text-white hover:bg-red-600 disabled:opacity-40 active:scale-[0.99]">
                    <Ban className="h-4 w-4" /> {t("adm.revokeGifts")}
                  </button>
                </div>
              </div>
            )}

            {/* results */}
            {grantResults.length > 0 && (
              <div className="mb-6 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {grantResults.map((u) => (
                  <button key={u.id} onClick={() => { setGrantSel(u); setGrantDate(""); }}
                    className={`flex items-center gap-3 rounded-2xl p-3 text-start ring-1 ${grantSel?.id === u.id ? "bg-brand-50 ring-brand-300" : "bg-white ring-slate-200 hover:ring-slate-300"}`}>
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-[14px] font-extrabold text-brand-600">{(u.name || "•").charAt(0).toUpperCase()}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-extrabold text-ink">{u.name}{u.isPremium ? " 👑" : ""}</span>
                      <span className="block truncate text-[11.5px] font-medium text-muted" dir="ltr">{u.email ?? u.phone ?? ""}</span>
                    </span>
                    {u.country && <span className="shrink-0 text-[14px]">{getCountry(u.country)?.flag ?? ""}</span>}
                  </button>
                ))}
              </div>
            )}

            {/* the selected member — everything the admin can gift */}
            {grantSel && (
              <div className="max-w-2xl rounded-3xl bg-white p-5 ring-1 ring-slate-200">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="text-[15px] font-extrabold text-ink">
                    {grantSel.name}{(adminIds.has(grantSel.id) || grantSel.isAdmin) ? " 🛡️" : ""}
                  </p>
                  {/* only THE owner mints or removes admins */}
                  {isOwner && (
                    (adminIds.has(grantSel.id) || grantSel.isAdmin) ? (
                      <button onClick={() => toggleAdmin(grantSel.id, false)} disabled={busyGrant}
                        className="h-9 rounded-xl bg-red-50 px-3.5 text-[12px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
                        {t("adm.removeAdmin")}
                      </button>
                    ) : (
                      <button onClick={() => toggleAdmin(grantSel.id, true)} disabled={busyGrant}
                        className="h-9 rounded-xl bg-[#131743] px-3.5 text-[12px] font-extrabold text-white active:scale-95 disabled:opacity-40">
                        🛡️ {t("adm.makeAdmin")}
                      </button>
                    )
                  )}
                </div>
                <p className="mb-4 text-[12px] font-medium text-muted">
                  {grantSel.isPremium && grantSel.premiumUntil
                    ? `${t("settings.premiumUntil")} ${new Date(grantSel.premiumUntil).toLocaleDateString(locale === "ar" ? "ar" : "en-GB")} 👑`
                    : t("adm.grantNoPremium")}
                </p>

                {/* gift a bundle — stacks on any remaining time */}
                <p className="mb-2 text-[12px] font-extrabold uppercase tracking-wider text-muted">{t("adm.grantPremium")}</p>
                <div className="mb-3 grid grid-cols-4 gap-2">
                  {([1, 3, 6, 12] as const).map((m) => (
                    <button key={m} onClick={() => grant({ premiumMonths: m })} disabled={busyGrant}
                      className="rounded-2xl border-2 border-slate-200 bg-white py-2.5 text-[12.5px] font-extrabold text-ink hover:border-amber-400 disabled:opacity-40">
                      🎁 {t(`premium.m${m}`)}
                    </button>
                  ))}
                </div>

                {/* or an exact end date */}
                <div className="mb-4 flex items-center gap-2">
                  <input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} dir="ltr"
                    className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500" />
                  <button onClick={() => { if (grantDate) grant({ premiumUntil: grantDate }); }} disabled={busyGrant || !grantDate}
                    className="h-11 shrink-0 rounded-2xl bg-amber-500 px-4 text-[12.5px] font-extrabold text-white hover:bg-amber-600 disabled:opacity-40">
                    {t("adm.grantUntilDate")}
                  </button>
                  {grantSel.isPremium && (
                    <button onClick={() => grant({ revokePremium: true })} disabled={busyGrant}
                      className="h-11 shrink-0 rounded-2xl bg-red-50 px-4 text-[12.5px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
                      {t("adm.grantRevoke")}
                    </button>
                  )}
                </div>

                {/* free posting credits — how many free ones the admin gifts */}
                <p className="mb-1 text-[12px] font-extrabold uppercase tracking-wider text-muted">{t("adm.grantFreeSection")}</p>
                <p className="mb-2 text-[11px] font-medium text-muted">{t("adm.grantFreeHint")}</p>
                <div className="flex flex-col gap-2">
                  {([
                    { k: "freeAdsLeft" as const, label: t("adm.grantFreeAds") },
                    { k: "freeJobPostLeft" as const, label: t("adm.grantFreeJobs") },
                    { k: "freeSeekerLeft" as const, label: t("adm.grantFreeSeeker") },
                  ]).map((o) => (
                    <div key={o.k} className="flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-2.5 ring-1 ring-slate-200">
                      <span className="text-[13px] font-bold text-ink">{o.label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-muted">{t("adm.grantRemaining")}: {ld(grantSel[o.k], locale)}</span>
                        <input type="number" min={0} defaultValue={grantSel[o.k]} dir="ltr"
                          onKeyDown={(e) => { if (e.key === "Enter") grant({ [o.k]: Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0) }); }}
                          onBlur={(e) => { const v = Math.max(0, parseInt(e.target.value) || 0); if (v !== grantSel[o.k]) grant({ [o.k]: v }); }}
                          className="h-9 w-16 rounded-xl border-2 border-slate-200 bg-white text-center text-[13px] font-extrabold text-ink outline-none focus:border-brand-500" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ---------- INVOICES ---------- */}
        {tab === "invoices" && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-[22px] font-extrabold text-ink">{t("adm.tabInvoices")}</h1>
              <div className="flex items-center gap-2">
                {invoices.length > 0 && (
                  <button onClick={() => printInvoices()}
                    className="flex h-10 items-center gap-1.5 rounded-2xl bg-brand-600 px-4 text-[13px] font-extrabold text-white hover:bg-brand-700 active:scale-95">
                    <Printer className="h-4 w-4" /> {selInv.size ? `${t("adm.invPrintSel")} (${ld(selInv.size, locale)})` : t("adm.invPrintAll")}
                  </button>
                )}
                <span className="rounded-2xl bg-emerald-50 px-4 py-2 text-[13px] font-extrabold text-emerald-700">
                  {t("adm.invTotal")}: ${ld(Math.round(invTotal), locale)} · {ld(invoices.length, locale)}
                </span>
              </div>
            </div>

            {/* search by name/number + date range */}
            <div className="mb-5 flex flex-wrap items-end gap-2">
              <div className="flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-2xl bg-white px-3.5 ring-1 ring-slate-200 focus-within:ring-brand-400">
                <Search className="h-4 w-4 shrink-0 text-muted" />
                <input value={invQ} onChange={(e) => setInvQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") loadInvoices(); }}
                  placeholder={t("adm.invSearchPh")} className="h-full flex-1 bg-transparent text-[13.5px] font-medium text-ink outline-none placeholder:text-muted" />
              </div>
              <input type="date" value={invFrom} onChange={(e) => setInvFrom(e.target.value)} dir="ltr"
                className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-[13px] font-medium text-ink outline-none focus:border-brand-500" />
              <input type="date" value={invTo} onChange={(e) => setInvTo(e.target.value)} dir="ltr"
                className="h-11 rounded-2xl border-2 border-slate-200 bg-white px-3 text-[13px] font-medium text-ink outline-none focus:border-brand-500" />
              <button onClick={loadInvoices} className="h-11 rounded-2xl bg-[#131743] px-5 text-[13px] font-bold text-white active:scale-95">{t("discover.search")}</button>
            </div>

            {invoices.length === 0 ? (
              <div className="grid place-items-center rounded-3xl bg-white py-16 ring-1 ring-slate-200">
                <FileText className="h-9 w-9 text-slate-300" />
                <p className="mt-2 text-[14px] font-bold text-muted">{t("adm.invEmpty")}</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                {/* select-all header */}
                <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <input type="checkbox" checked={selInv.size === invoices.length && invoices.length > 0}
                    onChange={toggleInvAll} className="h-4 w-4 accent-brand-600" />
                  <span className="text-[12.5px] font-bold text-muted">{t("adm.invSelectAll")}</span>
                </label>
                {invoices.map((inv, i) => (
                  <div key={inv.id}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 ${i ? "border-t border-slate-100" : ""}`}>
                    <input type="checkbox" checked={selInv.has(inv.id)} onChange={() => toggleInv(inv.id)}
                      onClick={(e) => e.stopPropagation()} className="h-4 w-4 shrink-0 accent-brand-600" />
                    <button onClick={() => setInvView(inv)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><FileText className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-extrabold text-ink">{inv.customerName || "—"}</span>
                        <span className="block truncate text-[11.5px] font-medium text-muted" dir="ltr">{inv.number} · {invKindLabel(inv.kind, locale === "ar")}</span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-[13.5px] font-extrabold text-emerald-700" dir="ltr">${inv.amount}</span>
                        <span className="block text-[11px] font-medium text-muted">{new Date(inv.createdAt).toLocaleDateString(locale === "ar" ? "ar" : "en-GB")}</span>
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* the simple invoice view */}
            {invView && (
              <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setInvView(null)}>
                <div dir="ltr" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/prfet-logo.png" alt="PRFET" className="h-8 w-auto object-contain" />
                    <div className="text-end">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Invoice</p>
                      <p className="text-[13px] font-extrabold text-ink">{invView.number}</p>
                    </div>
                  </div>
                  <div className="flex justify-between py-4 text-[12.5px]">
                    <div>
                      <p className="font-bold text-muted">Billed to</p>
                      <p className="font-extrabold text-ink">{invView.customerName || "—"}</p>
                    </div>
                    <div className="text-end">
                      <p className="font-bold text-muted">Date</p>
                      <p className="font-extrabold text-ink">{new Date(invView.createdAt).toLocaleDateString("en-GB")}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-bold text-ink">{invKindLabel(invView.kind, locale === "ar")}</span>
                      <span className="font-extrabold text-ink">${invView.amount}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-[15px]">
                      <span className="font-extrabold text-ink">Total</span>
                      <span className="font-extrabold text-emerald-700">${invView.amount} {invView.currency}</span>
                    </div>
                  </div>
                  <p className="mt-4 text-center text-[11px] font-medium text-muted">PRFET · Thank you</p>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => printInvoices([invView])} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-brand-600 text-[13.5px] font-bold text-white hover:bg-brand-700 active:scale-[0.99]">
                      <Printer className="h-4 w-4" /> {t("adm.invPrintOne")}
                    </button>
                    <button onClick={() => setInvView(null)} className="h-11 flex-1 rounded-2xl bg-[#131743] text-[13.5px] font-bold text-white active:scale-[0.99]">{t("close")}</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ---------- SPONSOR & BRANCHES ---------- */}
        {tab === "sponsor" && (
          <>
            <h1 className="mb-2 text-[22px] font-extrabold text-ink">{t("adm.tabSponsor")}</h1>
            <p className="mb-5 max-w-2xl text-[12.5px] font-medium leading-relaxed text-muted">{t("adm.sponsorTabHint")}</p>

            {/* the white /sponsor page content — name, logo, blurb, link. All empty = page closed. */}
            <div className="mb-6 max-w-2xl">
              <Card icon={<Crown className="h-4 w-4 text-amber-500" />} title={t("admin.sponsorSection")}>
                <div className="flex items-center gap-3">
                  {s.sponsorLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.sponsorLogo} alt="" className="h-16 w-16 rounded-2xl object-contain ring-1 ring-slate-200" />
                  ) : (
                    <span className="grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-400"><Crown className="h-6 w-6" /></span>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-[12px] font-bold text-ink hover:bg-slate-200">
                      <Camera className="h-3.5 w-3.5" /> {t("admin.sponsorLogo")}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { set("sponsorLogo", await fileToAvatar(f)); } catch { /* bad file */ } } e.target.value = ""; }} />
                    </label>
                    {s.sponsorLogo && (
                      <button onClick={() => set("sponsorLogo", "")}
                        className="flex h-9 items-center gap-1.5 rounded-xl bg-red-50 px-3 text-[12px] font-bold text-red-600 hover:bg-red-100">
                        <X className="h-3.5 w-3.5" /> {t("admin.legalPhotoRemove")}
                      </button>
                    )}
                  </div>
                </div>
                <Field label={t("admin.sponsorName")} value={s.sponsorName} onChange={(v) => set("sponsorName", v)} />
                <Area label={t("admin.sponsorText")} value={s.sponsorText} onChange={(v) => set("sponsorText", v)} rows={2} />
                <Field label={t("admin.sponsorUrl")} value={s.sponsorUrl} onChange={(v) => set("sponsorUrl", v)} ltr />
                <p className="text-[11px] font-medium leading-snug text-muted">{t("admin.sponsorHint")}</p>
                <button onClick={save} disabled={busy}
                  className="mt-1 flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand-600 px-6 text-[14px] font-extrabold text-white hover:bg-brand-700 disabled:opacity-40 active:scale-[0.99]">
                  <Save className="h-4 w-4" /> {t("admin.save")}
                </button>
              </Card>
            </div>

            {/* find the account */}
            <div className="mb-3 flex w-full max-w-md items-center gap-2">
              <input
                value={spQ}
                onChange={(e) => setSpQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchSponsorUsers(spQ, setSpResults); }}
                placeholder={t("adm.grantSearchPh")}
                className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-4 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500"
              />
              <button onClick={() => searchSponsorUsers(spQ, setSpResults)} className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-[#131743] px-5 text-[13px] font-bold text-white active:scale-95">
                <Search className="h-4 w-4" /> {t("discover.search")}
              </button>
              {sponsorUserId && spSel?.id !== sponsorUserId && (
                <button onClick={() => loadSponsor()} className="h-11 shrink-0 rounded-2xl bg-amber-50 px-4 text-[12.5px] font-bold text-amber-600 ring-1 ring-amber-200">
                  👑 {t("adm.sponsorCurrent")}
                </button>
              )}
            </div>

            {spResults.length > 0 && (
              <div className="mb-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {spResults.map((u) => (
                  <button key={u.id} onClick={() => loadSponsor(u.id)}
                    className={`flex items-center gap-3 rounded-2xl p-3 text-start ring-1 ${spSel?.id === u.id ? "bg-brand-50 ring-brand-300" : "bg-white ring-slate-200 hover:ring-slate-300"}`}>
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-[14px] font-extrabold text-brand-600">{(u.name || "•").charAt(0).toUpperCase()}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-extrabold text-ink">{u.name}{u.id === sponsorUserId ? " 👑" : ""}</span>
                      <span className="block truncate text-[11.5px] font-medium text-muted" dir="ltr">{u.email ?? u.phone ?? ""}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {spSel && (
              <div className="max-w-2xl rounded-3xl bg-white p-5 ring-1 ring-slate-200">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-[15px] font-extrabold text-ink">{spSel.name}{spSel.id === sponsorUserId ? " 👑" : ""}</p>
                  {spSel.id === sponsorUserId ? (
                    <button onClick={() => promo({ makeSponsor: false })} disabled={busyPromo}
                      className="h-10 rounded-xl bg-red-50 px-4 text-[12.5px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
                      {t("adm.sponsorRemove")}
                    </button>
                  ) : (
                    <button onClick={() => promo({ makeSponsor: true })} disabled={busyPromo}
                      className="h-10 rounded-xl bg-amber-500 px-4 text-[12.5px] font-extrabold text-white hover:bg-amber-600 disabled:opacity-40">
                      👑 {t("adm.sponsorAppoint")}
                    </button>
                  )}
                </div>

                {/* the pinned video */}
                <p className="mb-2 text-[12px] font-extrabold uppercase tracking-wider text-muted">{t("adm.sponsorVideo")}</p>
                {spSel.promoVideoUrl && (
                  <video src={spSel.promoVideoUrl} controls preload="metadata" className="mb-2 max-h-56 w-full rounded-2xl bg-black" />
                )}
                <div className="mb-4 flex items-center gap-2">
                  <label className={`flex h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-[12px] font-bold text-ink hover:bg-slate-200 ${busyPromo ? "pointer-events-none opacity-40" : ""}`}>
                    <Camera className="h-3.5 w-3.5" /> {spSel.promoVideoUrl ? t("adm.sponsorVideoReplace") : t("adm.sponsorVideoAdd")}
                    <input type="file" accept="video/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPromoVideo(f); e.target.value = ""; }} />
                  </label>
                  {spSel.promoVideoUrl && (
                    <button onClick={() => promo({ videoUrl: null })} disabled={busyPromo}
                      className="flex h-10 items-center gap-1.5 rounded-xl bg-red-50 px-3 text-[12px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
                      <X className="h-3.5 w-3.5" /> {t("admin.legalPhotoRemove")}
                    </button>
                  )}
                </div>

                {/* the link under the video */}
                <p className="mb-2 text-[12px] font-extrabold uppercase tracking-wider text-muted">{t("adm.sponsorLink")}</p>
                <div className="mb-5 flex items-center gap-2">
                  <input value={spLink} onChange={(e) => setSpLink(e.target.value)} dir="ltr"
                    placeholder="https://…"
                    className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500" />
                  <button onClick={() => promo({ linkUrl: spLink })} disabled={busyPromo}
                    className="h-11 shrink-0 rounded-2xl bg-brand-600 px-4 text-[12.5px] font-extrabold text-white hover:bg-brand-700 disabled:opacity-40">
                    {t("admin.save")}
                  </button>
                </div>

                {/* branches — just a name + link each (no linked account) */}
                <p className="mb-2 text-[12px] font-extrabold uppercase tracking-wider text-muted">{t("adm.branches")}</p>
                {spSel.branches.length > 0 && (
                  <div className="mb-3 flex flex-col gap-1.5">
                    {spSel.branches.map((br) => (
                      <div key={br.id} className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-bold text-ink">{br.name}</span>
                          {br.url && <span className="block truncate text-[11px] font-medium text-brand-600" dir="ltr">{br.url}</span>}
                        </span>
                        <button onClick={() => promo({ removeBranchId: br.id })} disabled={busyPromo} aria-label="remove"
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 hover:bg-red-100">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input value={brName} onChange={(e) => setBrName(e.target.value)}
                    placeholder={t("adm.branchNamePh")}
                    className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[13px] font-medium text-ink outline-none focus:border-brand-500" />
                  <input value={brUrl} onChange={(e) => setBrUrl(e.target.value)} dir="ltr"
                    placeholder="https://…"
                    className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[13px] font-medium text-ink outline-none focus:border-brand-500" />
                  <button
                    onClick={() => { if (brName.trim()) { promo({ addBranch: { name: brName.trim(), url: brUrl.trim() } }); setBrName(""); setBrUrl(""); } }}
                    disabled={busyPromo || !brName.trim()}
                    className="h-11 shrink-0 rounded-2xl bg-[#131743] px-5 text-[12.5px] font-bold text-white active:scale-95 disabled:opacity-40">
                    ＋ {t("adm.branchAdd")}
                  </button>
                </div>
              </div>
            )}

            {/* Always-visible preview: the video, link & branch sections. Disabled until an
                account is picked, so the admin can see what the sponsor's profile will hold. */}
            {!spSel && (
              <div className="max-w-2xl rounded-3xl bg-white p-5 ring-1 ring-slate-200 opacity-90">
                <p className="mb-4 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-bold text-amber-700">
                  {t("adm.sponsorPickFirst")}
                </p>

                {/* pinned video (disabled preview) */}
                <p className="mb-2 text-[12px] font-extrabold uppercase tracking-wider text-muted">{t("adm.sponsorVideo")}</p>
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-10 items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-[12px] font-bold text-slate-400">
                    <Camera className="h-3.5 w-3.5" /> {t("adm.sponsorVideoAdd")}
                  </span>
                </div>

                {/* link under the video (disabled preview) */}
                <p className="mb-2 text-[12px] font-extrabold uppercase tracking-wider text-muted">{t("adm.sponsorLink")}</p>
                <input disabled dir="ltr" placeholder="https://…"
                  className="mb-5 h-11 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 text-[13.5px] font-medium text-slate-400 outline-none" />

                {/* branches (disabled preview) */}
                <p className="mb-2 text-[12px] font-extrabold uppercase tracking-wider text-muted">{t("adm.branches")}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input disabled placeholder={t("adm.branchNamePh")}
                    className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 text-[13px] font-medium text-slate-400 outline-none" />
                  <input disabled dir="ltr" placeholder="https://…"
                    className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-slate-50 px-3.5 text-[13px] font-medium text-slate-400 outline-none" />
                  <span className="h-11 shrink-0 rounded-2xl bg-slate-200 px-5 text-[12.5px] font-bold leading-[44px] text-slate-400">
                    ＋ {t("adm.branchAdd")}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* ---------- REPORTS ---------- */}
        {tab === "reports" && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-[22px] font-extrabold text-ink">{t("adm.tabReports")}</h1>
                <div className="flex overflow-hidden rounded-full ring-1 ring-slate-200">
                  <button onClick={() => { setRepView("reports"); loadReports(repCountry, search, false); }}
                    className={`px-3.5 py-1.5 text-[12px] font-extrabold ${repView === "reports" ? "bg-[#131743] text-white" : "bg-white text-muted hover:text-ink"}`}>
                    {t("adm.viewReports")}
                  </button>
                  <button onClick={() => { setRepView("archived"); loadReports(repCountry, search, true); }}
                    className={`px-3.5 py-1.5 text-[12px] font-extrabold ${repView === "archived" ? "bg-[#131743] text-white" : "bg-white text-muted hover:text-ink"}`}>
                    {t("adm.viewArchived")}
                  </button>
                  <button onClick={() => { setRepView("suspended"); loadSuspended(); }}
                    className={`px-3.5 py-1.5 text-[12px] font-extrabold ${repView === "suspended" ? "bg-[#131743] text-white" : "bg-white text-muted hover:text-ink"}`}>
                    {t("adm.viewSuspended")}
                  </button>
                  <button onClick={() => { setRepView("ads"); loadModAds(); }}
                    className={`px-3.5 py-1.5 text-[12px] font-extrabold ${repView === "ads" ? "bg-[#131743] text-white" : "bg-white text-muted hover:text-ink"}`}>
                    {t("adm.viewAds")}
                  </button>
                  <button onClick={() => { setRepView("jobs"); loadModJobs(); }}
                    className={`px-3.5 py-1.5 text-[12px] font-extrabold ${repView === "jobs" ? "bg-[#131743] text-white" : "bg-white text-muted hover:text-ink"}`}>
                    {t("adm.viewJobs")}
                  </button>
                </div>
              </div>
              {/* search accounts / keywords across ALL reports, old ones included */}
              {(repView === "reports" || repView === "archived") && (
              <div className="flex w-full max-w-md items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                  placeholder={t("adm.searchPh")}
                  className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-4 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500"
                />
                <button onClick={runSearch} className="h-11 shrink-0 rounded-2xl bg-[#131743] px-5 text-[13px] font-bold text-white active:scale-95">
                  {t("discover.search")}
                </button>
              </div>
              )}
            </div>

            {(repView === "reports" || repView === "archived") && (
            <>
            {/* reports per country — chips with counts, plus the whole world */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <button onClick={() => pickRepCountry("all")}
                className={`rounded-full px-4 py-2 text-[12.5px] font-bold ${repCountry === "all" ? "bg-[#131743] text-white" : "bg-white text-ink ring-1 ring-slate-200 hover:ring-slate-300"}`}>
                🌍 {t("adm.allCountries")}
              </button>
              {repCountries.map((c) => {
                const info = getCountry(c.code);
                return (
                  <button key={c.code} onClick={() => pickRepCountry(c.code)}
                    className={`rounded-full px-4 py-2 text-[12.5px] font-bold ${repCountry === c.code ? "bg-[#131743] text-white" : "bg-white text-ink ring-1 ring-slate-200 hover:ring-slate-300"}`}>
                    {info?.flag ?? "🏳"} {info?.[locale] ?? c.code} · {ld(c.count, locale)}
                  </button>
                );
              })}
            </div>

            {reports.length === 0 ? (
              <div className="grid place-items-center rounded-3xl bg-white py-20 ring-1 ring-slate-200">
                <Flag className="h-9 w-9 text-slate-300" />
                <p className="mt-2 text-[14px] font-bold text-muted">{t("adm.noReports")}</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {reports.map((r) => (
                  <div key={r.id} className={`flex flex-col overflow-hidden rounded-3xl bg-white ring-1 ${r.status === "open" ? "ring-red-200" : "ring-slate-200"}`}>
                    {r.mediaUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.mediaUrl} alt="" className="max-h-48 w-full object-cover" />
                    )}
                    <div className="flex flex-1 flex-col p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10.5px] font-extrabold text-brand-700">{t(`adm.kind.${r.kind}`)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${r.status === "open" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>
                          {t(`adm.status.${r.status}`)}
                        </span>
                        {r.target?.suspendedUntil && (
                          <span className="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10.5px] font-extrabold text-orange-600">
                            <Clock className="h-3 w-3" /> {t("adm.suspendedUntilShort")} {new Date(r.target.suspendedUntil).toLocaleDateString(locale === "ar" ? "ar" : "en-GB")}
                          </span>
                        )}
                      </div>
                      <p className="text-[14px] font-extrabold text-ink">
                        {r.target ? r.target.name : "—"}
                        {r.target?.country && <span className="ms-1.5 text-[11.5px] font-medium text-muted">({getCountry(r.target.country)?.[locale] ?? r.target.country})</span>}
                      </p>
                      <p className="mt-0.5 text-[12px] font-medium text-muted">{t("adm.reportedBy")}: {r.reporter?.name ?? "—"} · {new Date(r.createdAt).toLocaleDateString(locale === "ar" ? "ar" : "en-GB")}</p>
                      {/* the evidence — a reported chat message / caption shows as a quote */}
                      {r.contentText && (
                        <p className="mt-2 rounded-xl border-s-4 border-violet-400 bg-violet-50 p-2.5 text-[12.5px] font-medium text-ink">
                          {t("adm.content")}: “{r.contentText}”
                        </p>
                      )}
                      {r.reason && <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[12.5px] font-medium text-ink">{t("adm.reason")}: {r.reason}</p>}

                      {/* optional extra line the admin adds to the automatic suspension message */}
                      {r.target && !r.target.suspendedUntil && (
                        <input
                          value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes((d) => ({ ...d, [r.id]: e.target.value }))}
                          placeholder={t("adm.notePh")}
                          className="mt-2 h-10 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-[12.5px] font-medium text-ink outline-none focus:border-brand-500"
                        />
                      )}

                      {r.target && (
                        <div className="mt-auto flex items-center gap-2 pt-3">
                          {r.target.suspendedUntil ? (
                            <button onClick={() => suspend(r, true)} className="h-10 flex-1 rounded-xl bg-emerald-600 text-[12.5px] font-extrabold text-white hover:bg-emerald-700 active:scale-[0.98]">
                              {t("adm.unsuspend")}
                            </button>
                          ) : (
                            <>
                              <input type="number" min={1} max={365} inputMode="numeric" value={days[r.id] ?? "3"}
                                onChange={(e) => setDays((d) => ({ ...d, [r.id]: e.target.value }))} dir="ltr"
                                className="h-10 w-16 rounded-xl border-2 border-slate-200 bg-white text-center text-[14px] font-extrabold text-ink outline-none focus:border-brand-500" />
                              <span className="text-[11.5px] font-bold text-muted">{t("adm.days")}</span>
                              <button onClick={() => suspend(r, false)} className="h-10 flex-1 rounded-xl bg-red-500 text-[12.5px] font-extrabold text-white hover:bg-red-600 active:scale-[0.98]">
                                {t("adm.suspend")}
                              </button>
                            </>
                          )}
                          <button onClick={() => markReviewed(r)} className="h-10 rounded-xl bg-slate-100 px-3 text-[12px] font-bold text-ink hover:bg-slate-200 active:scale-[0.98]">
                            {t("adm.sendToArchive")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            </>
            )}

            {/* the suspended list — every locked account, with a release button */}
            {repView === "suspended" && (
              suspended.length === 0 ? (
                <div className="grid place-items-center rounded-3xl bg-white py-20 ring-1 ring-slate-200">
                  <ShieldAlert className="h-9 w-9 text-slate-300" />
                  <p className="mt-2 text-[14px] font-bold text-muted">{t("adm.noSuspended")}</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {suspended.map((u) => (
                    <div key={u.id} className="flex flex-col rounded-3xl bg-white p-4 ring-1 ring-orange-200">
                      <div className="flex items-center gap-3">
                        {u.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.avatarUrl} alt="" className="h-11 w-11 rounded-2xl object-cover" />
                        ) : (
                          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-50 text-orange-500"><Ban className="h-5 w-5" /></span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-extrabold text-ink">{u.name}</p>
                          <p className="truncate text-[11.5px] font-medium text-muted" dir="ltr">{u.email ?? u.phone ?? ""}</p>
                        </div>
                        {u.country && (
                          <span className="shrink-0 text-[11.5px] font-bold text-muted">
                            {getCountry(u.country)?.flag ?? ""} {getCountry(u.country)?.[locale] ?? u.country}
                          </span>
                        )}
                      </div>
                      {u.suspendedUntil && (
                        <p className="mt-2.5 flex items-center gap-1.5 rounded-xl bg-orange-50 px-3 py-2 text-[12px] font-bold text-orange-700">
                          <Clock className="h-3.5 w-3.5" /> {t("adm.suspendedUntilShort")} {new Date(u.suspendedUntil).toLocaleDateString(locale === "ar" ? "ar" : "en-GB")}
                        </p>
                      )}
                      {u.reason && <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[12.5px] font-medium text-ink">{t("adm.reason")}: {u.reason}</p>}
                      <button onClick={() => unsuspendUser(u)}
                        className="mt-3 h-10 rounded-xl bg-emerald-600 text-[12.5px] font-extrabold text-white hover:bg-emerald-700 active:scale-[0.98]">
                        {t("adm.unsuspend")}
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ads moderation — stop or remove any ad */}
            {repView === "ads" && (
              <>
                <div className="mb-4 flex w-full max-w-md items-center gap-2">
                  <input value={modAdsQ} onChange={(e) => setModAdsQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") loadModAds(); }}
                    placeholder={t("adm.adSearchPh")} className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-4 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500" />
                  <button onClick={loadModAds} className="h-11 rounded-2xl bg-[#131743] px-5 text-[13px] font-bold text-white active:scale-95">{t("discover.search")}</button>
                </div>
                {modAds.length === 0 ? (
                  <div className="grid place-items-center rounded-3xl bg-white py-16 ring-1 ring-slate-200">
                    <Megaphone className="h-9 w-9 text-slate-300" />
                    <p className="mt-2 text-[14px] font-bold text-muted">{t("adm.noAds")}</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {modAds.map((ad) => (
                      <div key={ad.id} className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                        <div className="relative grid h-24 place-items-center bg-gradient-to-br from-brand-600 to-accent-600">
                          {ad.mediaUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={ad.mediaUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <p className="line-clamp-2 px-3 text-center text-[13px] font-extrabold text-white">{ad.caption}</p>
                          )}
                          <span className={`absolute end-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-extrabold text-white ${ad.status === "active" ? "bg-emerald-500" : ad.status === "rejected" ? "bg-red-500" : "bg-slate-500"}`}>{ad.status}</span>
                        </div>
                        <div className="flex flex-1 flex-col p-3">
                          <p className="truncate text-[13px] font-extrabold text-ink">{ad.caption || ad.advertiser}</p>
                          <p className="truncate text-[11.5px] font-medium text-muted">{ad.advertiser} · 👁 {ld(ad.views, locale)}</p>
                          <div className="mt-2 flex gap-2">
                            {ad.status === "active" ? (
                              <button onClick={() => moderateAd(ad.id, "stop")} className="h-9 flex-1 rounded-xl bg-orange-50 text-[12px] font-bold text-orange-600 hover:bg-orange-100">{t("adm.adStop")}</button>
                            ) : (
                              <button onClick={() => moderateAd(ad.id, "activate")} className="h-9 flex-1 rounded-xl bg-emerald-50 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100">{t("adm.adActivate")}</button>
                            )}
                            <button onClick={() => moderateAd(ad.id, "delete")} className="h-9 flex-1 rounded-xl bg-red-50 text-[12px] font-bold text-red-600 hover:bg-red-100">{t("adm.adDelete")}</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* jobs & seekers moderation — a separate tab from ads */}
            {repView === "jobs" && (
              <>
                <div className="mb-4 flex w-full max-w-md items-center gap-2">
                  <input value={modAdsQ} onChange={(e) => setModAdsQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") loadModJobs(); }}
                    placeholder={t("adm.adSearchPh")} className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-4 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500" />
                  <button onClick={loadModJobs} className="h-11 rounded-2xl bg-[#131743] px-5 text-[13px] font-bold text-white active:scale-95">{t("discover.search")}</button>
                </div>

                {/* job posts — company listings, with stop / delete */}
                <h2 className="mb-3 text-[16px] font-extrabold text-ink">{t("adm.jobPostsSection")}</h2>
                {modJobs.length === 0 ? (
                  <div className="grid place-items-center rounded-3xl bg-white py-10 ring-1 ring-slate-200">
                    <p className="text-[13px] font-bold text-muted">{t("adm.noJobPosts")}</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {modJobs.map((j) => (
                      <div key={j.id} className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                        <div className="relative grid h-24 place-items-center bg-gradient-to-br from-brand-600 to-accent-600">
                          {j.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={j.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <p className="line-clamp-2 px-3 text-center text-[13px] font-extrabold text-white">{j.title}</p>
                          )}
                          <span className={`absolute end-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-extrabold text-white ${j.status === "open" ? "bg-emerald-500" : "bg-slate-500"}`}>{j.status}</span>
                        </div>
                        <div className="flex flex-1 flex-col p-3">
                          <p className="truncate text-[13px] font-extrabold text-ink">{j.title}</p>
                          <p className="truncate text-[11.5px] font-medium text-muted">{j.advertiser}</p>
                          <div className="mt-2 flex gap-2">
                            {j.status === "open" ? (
                              <button onClick={() => moderateJob("job", j.id, "stop")} className="h-9 flex-1 rounded-xl bg-orange-50 text-[12px] font-bold text-orange-600 hover:bg-orange-100">{t("adm.adStop")}</button>
                            ) : (
                              <button onClick={() => moderateJob("job", j.id, "activate")} className="h-9 flex-1 rounded-xl bg-emerald-50 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100">{t("adm.adActivate")}</button>
                            )}
                            <button onClick={() => moderateJob("job", j.id, "delete")} className="h-9 flex-1 rounded-xl bg-red-50 text-[12px] font-bold text-red-600 hover:bg-red-100">{t("adm.adDelete")}</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* job-seeker ads — CVs, with stop / delete */}
                <h2 className="mb-3 mt-8 text-[16px] font-extrabold text-ink">{t("adm.seekerAdsSection")}</h2>
                {modSeekers.length === 0 ? (
                  <div className="grid place-items-center rounded-3xl bg-white py-10 ring-1 ring-slate-200">
                    <p className="text-[13px] font-bold text-muted">{t("adm.noSeekerAds")}</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {modSeekers.map((s) => (
                      <div key={s.id} className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                        <div className="relative grid h-24 place-items-center bg-gradient-to-br from-violet-600 to-brand-600">
                          {s.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <p className="line-clamp-2 px-3 text-center text-[13px] font-extrabold text-white">{s.title}</p>
                          )}
                          <span className={`absolute end-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-extrabold text-white ${s.status === "open" ? "bg-emerald-500" : "bg-slate-500"}`}>{s.status}</span>
                        </div>
                        <div className="flex flex-1 flex-col p-3">
                          <p className="truncate text-[13px] font-extrabold text-ink">{s.title}</p>
                          <p className="truncate text-[11.5px] font-medium text-muted">{s.advertiser}</p>
                          <div className="mt-2 flex gap-2">
                            {s.status === "open" ? (
                              <button onClick={() => moderateJob("seeker", s.id, "stop")} className="h-9 flex-1 rounded-xl bg-orange-50 text-[12px] font-bold text-orange-600 hover:bg-orange-100">{t("adm.adStop")}</button>
                            ) : (
                              <button onClick={() => moderateJob("seeker", s.id, "activate")} className="h-9 flex-1 rounded-xl bg-emerald-50 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100">{t("adm.adActivate")}</button>
                            )}
                            <button onClick={() => moderateJob("seeker", s.id, "delete")} className="h-9 flex-1 rounded-xl bg-red-50 text-[12px] font-bold text-red-600 hover:bg-red-100">{t("adm.adDelete")}</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ---------- PAGE SETTINGS ---------- */}
        {tab === "broadcast" && (
          <>
            <h1 className="mb-2 text-[22px] font-extrabold text-ink">{t("adm.tabBroadcast")}</h1>
            <p className="mb-5 max-w-2xl text-[12.5px] font-medium leading-relaxed text-muted">{t("adm.bcHint")}</p>

            <div className="max-w-2xl rounded-3xl bg-white p-5 ring-1 ring-slate-200">
              {/* who receives it */}
              <div className="mb-4 flex gap-1.5 rounded-2xl bg-slate-100 p-1.5">
                {([
                  { v: "user" as const, label: t("adm.bcScopeUser") },
                  { v: "countries" as const, label: t("adm.bcScopeCountries") },
                  { v: "all" as const, label: t("adm.bcScopeAll") },
                ]).map((o) => (
                  <button key={o.v} onClick={() => setBcScope(o.v)}
                    className={`flex-1 rounded-xl py-2 text-[12.5px] font-bold transition-colors ${bcScope === o.v ? "bg-brand-600 text-white" : "text-muted"}`}>
                    {o.label}
                  </button>
                ))}
              </div>

              {/* pick a person */}
              {bcScope === "user" && (
                <div className="mb-4">
                  {bcUser ? (
                    <div className="flex items-center gap-2 rounded-2xl bg-brand-50 px-3.5 py-2.5 ring-1 ring-brand-200">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-extrabold text-ink">{bcUser.name}</span>
                        <span className="block truncate text-[11.5px] font-medium text-muted" dir="ltr">{bcUser.email ?? bcUser.phone ?? ""}</span>
                      </span>
                      <button onClick={() => setBcUser(null)} aria-label="clear" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-red-600 ring-1 ring-slate-200"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <input value={bcQ} onChange={(e) => setBcQ(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") searchSponsorUsers(bcQ, setBcResults); }}
                          placeholder={t("adm.grantSearchPh")}
                          className="h-11 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[13.5px] font-medium text-ink outline-none focus:border-brand-500" />
                        <button onClick={() => searchSponsorUsers(bcQ, setBcResults)} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#131743] text-white active:scale-95"><Search className="h-4 w-4" /></button>
                      </div>
                      {bcResults.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1.5">
                          {bcResults.map((u) => (
                            <button key={u.id} onClick={() => { setBcUser(u); setBcResults([]); setBcQ(""); }}
                              className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-start hover:bg-brand-50">
                              <span className="text-[13px] font-bold text-ink">{u.name}</span>
                              <span className="truncate text-[11px] font-medium text-muted" dir="ltr">{u.email ?? u.phone ?? ""}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* pick countries */}
              {bcScope === "countries" && (
                <div className="mb-4">
                  {bcCountries.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {bcCountries.map((code) => {
                        const c = getCountry(code);
                        return (
                          <span key={code} className="flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-bold text-brand-700 ring-1 ring-brand-200">
                            {c ? `${c.flag} ${c[locale]}` : code}
                            <button onClick={() => setBcCountries((l) => l.filter((x) => x !== code))} aria-label="remove"><X className="h-3 w-3" /></button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <input value={bcCountryQ} onChange={(e) => setBcCountryQ(e.target.value)} placeholder={t("country.search")}
                    className="mb-2 h-10 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 text-[13px] font-medium text-ink outline-none focus:border-brand-500" />
                  <div className="no-scrollbar flex max-h-44 flex-col gap-1 overflow-y-auto">
                    {COUNTRIES.filter((c) => { const s = bcCountryQ.trim().toLowerCase(); return !s || c.ar.includes(bcCountryQ.trim()) || c.en.toLowerCase().includes(s); }).map((c) => {
                      const on = bcCountries.includes(c.code);
                      return (
                        <button key={c.code} onClick={() => setBcCountries((l) => (on ? l.filter((x) => x !== c.code) : [...l, c.code]))}
                          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-start ${on ? "bg-brand-50" : "hover:bg-slate-50"}`}>
                          <span className="text-lg leading-none">{c.flag}</span>
                          <span className={`flex-1 text-[13px] font-bold ${on ? "text-brand-700" : "text-ink"}`}>{c[locale]}</span>
                          {on && <Check className="h-4 w-4 text-brand-600" strokeWidth={3} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* the message */}
              <textarea value={bcBody} onChange={(e) => setBcBody(e.target.value)} rows={4} maxLength={2000}
                placeholder={t("adm.bcBodyPh")}
                className="mb-3 w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 py-3 text-[14px] font-medium text-ink outline-none focus:border-brand-500" />

              <button onClick={sendBroadcast} disabled={bcBusy || !bcBody.trim()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white hover:bg-brand-700 disabled:opacity-40 active:scale-[0.99]">
                <Send className="h-4 w-4" /> {t("adm.bcSend")}
              </button>
              <p className="mt-2 text-[11px] font-medium leading-snug text-muted">{t("adm.bcNote")}</p>
            </div>
          </>
        )}

        {tab === "page" && (
          <>
            <h1 className="mb-6 text-[22px] font-extrabold text-ink">{t("adm.tabPage")}</h1>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card icon={<Mail className="h-4 w-4 text-brand-600" />} title={t("admin.contactSection")}>
                <Field label={t("admin.adminEmail")} value={s.adminEmail} onChange={(v) => set("adminEmail", v)} ltr />
                <Field label={t("admin.supportPhone")} value={s.supportPhone} onChange={(v) => set("supportPhone", v)} ltr />
                <Field label={t("admin.whatsapp")} value={s.whatsapp} onChange={(v) => set("whatsapp", v)} ltr />
                <Field label={t("admin.address")} value={s.address} onChange={(v) => set("address", v)} />
              </Card>
              <Card icon={<Scale className="h-4 w-4 text-violet-600" />} title={t("admin.legalSection")}>
                {/* his photo — shown on the contact page next to his details */}
                <div className="flex items-center gap-3">
                  {s.legalRepAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.legalRepAvatar} alt="" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-slate-200" />
                  ) : (
                    <span className="grid h-16 w-16 place-items-center rounded-2xl bg-violet-50 text-violet-400"><Scale className="h-6 w-6" /></span>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 px-3 text-[12px] font-bold text-ink hover:bg-slate-200">
                      <Camera className="h-3.5 w-3.5" /> {t("admin.legalPhoto")}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) pickLawyerPhoto(f); e.target.value = ""; }} />
                    </label>
                    {s.legalRepAvatar && (
                      <button onClick={() => set("legalRepAvatar", "")}
                        className="flex h-9 items-center gap-1.5 rounded-xl bg-red-50 px-3 text-[12px] font-bold text-red-600 hover:bg-red-100">
                        <X className="h-3.5 w-3.5" /> {t("admin.legalPhotoRemove")}
                      </button>
                    )}
                  </div>
                </div>

                <Field label={t("admin.legalName")} value={s.legalRepName} onChange={(v) => set("legalRepName", v)} />
                <Field label={t("admin.legalEmail")} value={s.legalRepEmail} onChange={(v) => set("legalRepEmail", v)} ltr />
                <Field label={t("admin.legalPhone")} value={s.legalRepPhone} onChange={(v) => set("legalRepPhone", v)} ltr />

                {/* his in-app account — when linked, the contact page grows a "message him" button */}
                <div>
                  <span className="mb-1 block text-[11.5px] font-bold text-muted">{t("admin.legalAccount")}</span>
                  {s.legalRepUserId ? (
                    <div className="flex items-center gap-2">
                      <span className="flex h-11 flex-1 items-center gap-2 rounded-2xl bg-emerald-50 px-3.5 text-[13px] font-bold text-emerald-700">
                        <Link2 className="h-4 w-4" /> {t("admin.legalLinked")}
                      </span>
                      <button onClick={unlinkLawyer}
                        className="h-11 rounded-2xl bg-red-50 px-4 text-[12.5px] font-bold text-red-600 hover:bg-red-100">
                        {t("admin.legalUnlink")}
                      </button>
                    </div>
                  ) : (
                    <input
                      value={lawyerAccount}
                      onChange={(e) => setLawyerAccount(e.target.value)}
                      dir="ltr"
                      placeholder={t("admin.legalAccountPh")}
                      className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500"
                    />
                  )}
                  <p className="mt-1 text-[11px] font-medium leading-snug text-muted">{t("admin.legalAccountHint")}</p>
                </div>
              </Card>
              {/* pricing + master on/off switches. A disabled feature is removed from the whole app. */}
              <Card icon={<Crown className="h-4 w-4 text-amber-500" />} title={t("admin.pricingSection")}>
                {/* Subscription — the switch only controls whether users can subscribe; prices stay editable either way */}
                <FeatureRow label={t("admin.featSubscription")} on={s.subEnabled} onToggle={(v) => toggleFeature("subEnabled", v)} />
                <div className="grid grid-cols-2 gap-3">
                  <PriceField label={t("admin.priceSubscription")} value={s.priceSubscription} onChange={(v) => set("priceSubscription", v)} />
                  <PriceField label={t("admin.priceSub3m")} value={s.priceSub3m} onChange={(v) => set("priceSub3m", v)} />
                  <PriceField label={t("admin.priceSub6m")} value={s.priceSub6m} onChange={(v) => set("priceSub6m", v)} />
                  <PriceField label={t("admin.priceSub12m")} value={s.priceSub12m} onChange={(v) => set("priceSub12m", v)} />
                </div>

                {/* Ads */}
                <FeatureRow label={t("admin.featAds")} on={s.adsEnabled} onToggle={(v) => toggleFeature("adsEnabled", v)} />
                <PriceField label={t("admin.priceAdBase")} value={s.priceAdBase} onChange={(v) => set("priceAdBase", v)} />
                <div className="grid grid-cols-2 gap-3">
                  <PriceField label={t("admin.priceAdExtraCountry")} value={s.priceAdExtraCountry} onChange={(v) => set("priceAdExtraCountry", v)} />
                  <PriceField label={t("admin.priceAdExtraDay")} value={s.priceAdExtraDay} onChange={(v) => set("priceAdExtraDay", v)} />
                </div>

                {/* Jobs */}
                <FeatureRow label={t("admin.featJobs")} on={s.jobsEnabled} onToggle={(v) => toggleFeature("jobsEnabled", v)} />
                <div className="grid grid-cols-2 gap-3">
                  <PriceField label={t("admin.priceJobPost")} value={s.priceJobPost} onChange={(v) => set("priceJobPost", v)} />
                  <PriceField label={t("admin.priceSeekerAd")} value={s.priceSeekerAd} onChange={(v) => set("priceSeekerAd", v)} />
                </div>

                <p className="text-[11px] font-medium leading-snug text-muted">{t("admin.pricingHint")}</p>
              </Card>

              <Card icon={<Info className="h-4 w-4 text-brand-600" />} title={t("admin.aboutSection")}>
                <Area label={t("admin.aboutAr")} value={s.aboutAr} onChange={(v) => set("aboutAr", v)} />
                <Area label={t("admin.aboutEn")} value={s.aboutEn} onChange={(v) => set("aboutEn", v)} />
              </Card>
              <Card icon={<MessageSquareText className="h-4 w-4 text-brand-600" />} title={t("admin.boxesSection")}>
                <Area label={t("admin.complaintsInfo")} value={s.complaintsInfo} onChange={(v) => set("complaintsInfo", v)} rows={2} />
                <Area label={t("admin.inquiriesInfo")} value={s.inquiriesInfo} onChange={(v) => set("inquiriesInfo", v)} rows={2} />
              </Card>
            </div>
            <button onClick={save} disabled={busy}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white hover:bg-brand-700 disabled:opacity-40 active:scale-[0.99] lg:w-64">
              <Save className="h-4 w-4" /> {t("admin.save")}
            </button>
          </>
        )}
      </main>

      {/* stat-card drilldown — the people/records behind a number, with search + suspend */}
      {statList && (() => {
        const label = ({ newUsers: t("adm.newUsers"), premiumUsers: t("adm.premium"), businessUsers: t("adm.business"), blockedPeople: t("adm.blocked"), ads: t("adm.ads"), jobs: t("adm.jobs"), subscriptions: t("adm.subscriptions") } as Record<string, string>)[statList.kind] ?? statList.kind;
        const q = statQ.trim().toLowerCase();
        const rows = q ? statList.rows.filter((r) => r.title.toLowerCase().includes(q) || (r.subtitle ?? "").toLowerCase().includes(q)) : statList.rows;
        return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setStatList(null)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-3xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-extrabold text-ink">{label} · {ld(rows.length, locale)}</p>
              <button onClick={() => setStatList(null)} aria-label={t("close")} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-ink"><X className="h-4 w-4" /></button>
            </div>
            {/* search within the list */}
            <div className="mb-3 flex items-center gap-2 rounded-2xl bg-slate-50 px-3.5 ring-1 ring-slate-200 focus-within:ring-brand-400">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input value={statQ} onChange={(e) => setStatQ(e.target.value)} placeholder={t("adm.grantSearchPh")}
                className="h-10 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-muted" />
            </div>
            {rows.length === 0 ? (
              <p className="py-10 text-center text-[13px] font-bold text-muted">—</p>
            ) : (
              <div className="no-scrollbar flex-1 overflow-y-auto">
                {rows.map((r) => (
                  <div key={r.id} className="border-b border-slate-100">
                    <button onClick={() => r.userId && setStatOpenId(statOpenId === r.id ? null : r.id)}
                      className={`flex w-full items-center gap-3 py-2.5 text-start ${r.userId ? "hover:bg-slate-50" : "cursor-default"}`}>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13.5px] font-bold text-ink">{r.title}</span>
                          {r.suspended && <span className="shrink-0 rounded-full bg-orange-50 px-1.5 py-0.5 text-[9.5px] font-extrabold text-orange-600">{t("adm.suspendedTag")}</span>}
                        </span>
                        {r.subtitle && <span className="block truncate text-[11.5px] font-medium text-muted" dir="ltr">{r.subtitle}</span>}
                      </span>
                      {r.meta && <span className="shrink-0 text-[11.5px] font-bold text-muted" dir="ltr">{r.meta}</span>}
                    </button>
                    {r.userId && statOpenId === r.id && (
                      <div className="flex flex-wrap gap-2 pb-2.5">
                        <button onClick={() => window.open(`/business/${r.userId}`, "_blank")} className="flex-1 rounded-xl bg-slate-100 py-2 text-[12px] font-bold text-ink hover:bg-slate-200">{t("adm.visitAccount")}</button>
                        {r.suspended ? (
                          <button onClick={() => suspendFromList(r.userId!, false)} className="flex-1 rounded-xl bg-emerald-50 py-2 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100">{t("adm.unsuspend")}</button>
                        ) : (
                          <button onClick={() => suspendFromList(r.userId!, true)} className="flex-1 rounded-xl bg-orange-50 py-2 text-[12px] font-bold text-orange-600 hover:bg-orange-100">{t("adm.suspend")}</button>
                        )}
                        <button onClick={() => removeFromList(r.userId!)} className="flex-1 rounded-xl bg-red-50 py-2 text-[12px] font-bold text-red-600 hover:bg-red-100">{t("adm.removeAccount")}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {toast && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none fixed bottom-8 left-1/2 z-30 -translate-x-1/2 rounded-full bg-emerald-600 px-5 py-2.5 text-[13.5px] font-bold text-white shadow-lg">
          {toast}
        </motion.div>
      )}
    </div>
  );
}

/** A master on/off switch row for a paid feature (subscription/ads/jobs). */
function FeatureRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button onClick={() => onToggle(!on)} className="mb-1 flex w-full items-center justify-between rounded-2xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-200">
      <span className="flex items-center gap-2 text-[13.5px] font-extrabold text-ink">
        {label}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${on ? "bg-emerald-50 text-emerald-600" : "bg-slate-200 text-slate-500"}`}>{on ? "ON" : "OFF"}</span>
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "start-[22px]" : "start-0.5"}`} />
      </span>
    </button>
  );
}

/** Localized invoice label from its kind — the dashboard is Arabic. */
function invKindLabel(kind: string, ar: boolean): string {
  const m: Record<string, [string, string]> = {
    subscription: ["اشتراك بريميوم", "Premium subscription"],
    ad: ["إعلان", "Ad"],
    job: ["إعلان وظيفة", "Job ad"],
    seeker: ["إعلان باحث عن عمل", "Job-seeker ad"],
  };
  const pair = m[kind];
  return pair ? (ar ? pair[0] : pair[1]) : kind;
}

/**
 * Filter by any country on earth: quick chips for the countries that already
 * have members, and a dropdown carrying the rest of the world.
 */
function CountryFilter({ value, onPick, counts }: { value: string; onPick: (code: string) => void; counts: CountryStat[] }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const have = new Set(counts.map((c) => c.code));
  const chipSelected = value === "all" || have.has(value);
  const picked = !chipSelected ? getCountry(value) : null;

  const s = q.trim().toLowerCase();
  const rest = COUNTRIES.filter((c) => !have.has(c.code))
    .filter((c) => !s || c.ar.includes(q.trim()) || c.en.toLowerCase().includes(s) || c.code.toLowerCase() === s);

  function choose(code: string) { onPick(code); setOpen(false); setQ(""); }

  return (
    <div className="flex max-w-full flex-wrap items-center gap-2">
      <button onClick={() => onPick("all")}
        className={`rounded-full px-4 py-2 text-[12.5px] font-bold ${value === "all" ? "bg-[#131743] text-white" : "bg-white text-ink ring-1 ring-slate-200 hover:ring-slate-300"}`}>
        🌍 {t("adm.allCountries")}
      </button>
      {counts.map((c) => {
        const info = getCountry(c.code);
        return (
          <button key={c.code} onClick={() => onPick(c.code)}
            className={`rounded-full px-4 py-2 text-[12.5px] font-bold ${value === c.code ? "bg-[#131743] text-white" : "bg-white text-ink ring-1 ring-slate-200 hover:ring-slate-300"}`}>
            {info?.flag ?? "🏳"} {info?.[locale] ?? c.code} · {ld(c.users, locale)}{c.closed ? " 🔒" : ""}
          </button>
        );
      })}

      {/* the rest of the world — searchable */}
      <div className="relative">
        <button onClick={() => setOpen((o) => !o)}
          className={`rounded-full px-4 py-2 text-[12.5px] font-bold ${!chipSelected ? "bg-[#131743] text-white" : "bg-white text-ink ring-1 ring-slate-200 hover:ring-slate-300"}`}>
          {picked ? `${picked.flag} ${picked[locale]}` : `${t("adm.otherCountry")} ▾`}
        </button>

        {open && (
          <>
            {/* click-away layer */}
            <button aria-hidden className="fixed inset-0 z-30 cursor-default" onClick={() => { setOpen(false); setQ(""); }} />
            <div className="absolute end-0 top-11 z-40 w-72 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
              <div className="border-b border-slate-100 p-2.5">
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("country.search")}
                  className="h-10 w-full rounded-xl bg-slate-100 px-3.5 text-[13px] font-medium text-ink outline-none placeholder:text-muted"
                />
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {rest.length === 0 ? (
                  <p className="py-6 text-center text-[12.5px] font-bold text-muted">{t("discover.empty")}</p>
                ) : (
                  rest.map((c) => (
                    <button key={c.code} onClick={() => choose(c.code)}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-start hover:bg-slate-50">
                      <span className="text-lg leading-none">{c.flag}</span>
                      <span className="flex-1 text-[13px] font-bold text-ink">{c[locale]}</span>
                      <span className="text-[10.5px] font-bold text-muted">{c.code}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The stat cards — one component, two homes: the live Stats tab and the Archive.
 * monthMode leads with the month's new members instead of the all-time total.
 */
function StatsGrid({ stats, monthMode, onReports, onSuspended, onOpen }: { stats: Stats; monthMode?: boolean; onReports: () => void; onSuspended?: () => void; onOpen?: (kind: string) => void }) {
  const { t, locale } = useI18n();
  const money = (v: number) => `$${ld(Math.round(v), locale)}`;
  const subs = stats.subscriptionRevenue, ads = stats.adRevenue, jobs = stats.jobRevenue;
  const open = (k: string) => (onOpen ? () => onOpen(k) : undefined);

  return (
    <>
      <SectionTitle>{t("adm.secMembers")}</SectionTitle>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {monthMode ? (
          <StatCard icon={<UserPlus className="h-5 w-5" />} tint="bg-brand-50 text-brand-600" label={t("adm.newUsers")} value={ld(stats.newUsers, locale)} sub={`${t("adm.users")}: ${ld(stats.totalUsers, locale)}`} onClick={open("newUsers")} />
        ) : (
          <StatCard icon={<Users className="h-5 w-5" />} tint="bg-brand-50 text-brand-600" label={t("adm.users")} value={ld(stats.totalUsers, locale)} onClick={open("newUsers")} />
        )}
        <StatCard icon={<Crown className="h-5 w-5" />} tint="bg-amber-50 text-amber-500" label={t("adm.premium")} value={ld(stats.premiumUsers, locale)} sub={`${t("adm.subRevenue")}: ${money(subs)}`} onClick={open("premiumUsers")} />
        <StatCard icon={<Users className="h-5 w-5" />} tint="bg-emerald-50 text-emerald-600" label={t("adm.business")} value={ld(stats.businessUsers, locale)} onClick={open("businessUsers")} />
        <StatCard icon={<Ban className="h-5 w-5" />} tint="bg-red-50 text-red-500" label={t("adm.blocked")} value={ld(stats.blockedPeople, locale)} sub={`${t("adm.suspendedCount")}: ${ld(stats.suspendedUsers, locale)}`} onClick={open("blockedPeople")} />
      </div>

      <SectionTitle>{t("adm.secRevenue")}</SectionTitle>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Megaphone className="h-5 w-5" />} tint="bg-violet-50 text-violet-600" label={t("adm.ads")} value={ld(stats.adsCount, locale)} sub={`${t("adm.advertisers")}: ${ld(stats.advertisers, locale)} · ${money(ads)}`} onClick={open("ads")} />
        <StatCard icon={<Briefcase className="h-5 w-5" />} tint="bg-sky-50 text-sky-600" label={t("adm.jobs")} value={ld(stats.jobsCount, locale)} sub={`${t("adm.jobPosters")}: ${ld(stats.jobPosters, locale)} · ${money(jobs)}`} onClick={open("jobs")} />
        <StatCard icon={<Crown className="h-5 w-5" />} tint="bg-amber-50 text-amber-500" label={t("adm.subscriptions")} value={ld(stats.subscriptionCount, locale)} sub={money(subs)} onClick={open("subscriptions")} />
        <StatCard icon={<BarChart3 className="h-5 w-5" />} tint="bg-brand-50 text-brand-600" label={t("adm.totalRevenue")} value={money(subs + ads + jobs)} big />
      </div>

      {/* how the streams relate — each pair combined in one card */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <PairCard title={t("adm.pairSubsAds")} total={money(subs + ads)}
          a={{ label: t("adm.subscriptions"), value: money(subs) }} b={{ label: t("adm.ads"), value: money(ads) }} />
        <PairCard title={t("adm.pairSubsJobs")} total={money(subs + jobs)}
          a={{ label: t("adm.subscriptions"), value: money(subs) }} b={{ label: t("adm.jobs"), value: money(jobs) }} />
        <PairCard title={t("adm.pairJobsAds")} total={money(jobs + ads)}
          a={{ label: t("adm.jobs"), value: money(jobs) }} b={{ label: t("adm.ads"), value: money(ads) }} />
      </div>

      <SectionTitle>{t("adm.secSafety")}</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Flag className="h-5 w-5" />} tint="bg-red-50 text-red-500" label={t("adm.reportsOpen")} value={ld(stats.reportsOpen, locale)} sub={`${t("adm.reportsTotal")}: ${ld(stats.reportsTotal, locale)}`} onClick={onReports} />
        <StatCard icon={<ShieldAlert className="h-5 w-5" />} tint="bg-orange-50 text-orange-500" label={t("adm.suspendedCount")} value={ld(stats.suspendedUsers, locale)} onClick={onSuspended} />
      </div>
    </>
  );
}

/** Two revenue streams side by side with their combined total on top. */
function PairCard({ title, total, a, b }: { title: string; total: string; a: { label: string; value: string }; b: { label: string; value: string } }) {
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
      <p className="text-[12px] font-extrabold uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-1 text-[24px] font-extrabold text-ink">{total}</p>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 rounded-2xl bg-slate-50 p-2.5 text-center">
          <p className="text-[11px] font-bold text-muted">{a.label}</p>
          <p className="text-[14px] font-extrabold text-ink">{a.value}</p>
        </div>
        <span className="text-[14px] font-extrabold text-muted">+</span>
        <div className="flex-1 rounded-2xl bg-slate-50 p-2.5 text-center">
          <p className="text-[11px] font-bold text-muted">{b.label}</p>
          <p className="text-[14px] font-extrabold text-ink">{b.value}</p>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[12px] font-extrabold uppercase tracking-wider text-muted">{children}</p>;
}

function StatCard({ icon, tint, label, value, sub, onClick, big }: { icon: React.ReactNode; tint: string; label: string; value: string; sub?: string; onClick?: () => void; big?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`rounded-3xl bg-white p-5 text-start ring-1 ring-slate-200 transition-shadow hover:shadow-md ${onClick ? "active:scale-[0.99]" : ""}`}>
      <span className={`mb-3 grid h-10 w-10 place-items-center rounded-2xl ${tint}`}>{icon}</span>
      <p className={`font-extrabold leading-tight text-ink ${big ? "text-[26px]" : "text-[24px]"}`}>{value}</p>
      <p className="mt-0.5 text-[12.5px] font-bold text-muted">{label}</p>
      {sub && <p className="mt-1 text-[11.5px] font-medium text-muted">{sub}</p>}
    </Tag>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
      <p className="mb-3 flex items-center gap-1.5 text-[14px] font-extrabold text-ink">{icon} {title}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

/** A USD amount — number input with a $ sign, zero allowed (= free). */
function PriceField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-bold text-muted">{label}</span>
      <div className="flex items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-3.5 focus-within:border-brand-500" dir="ltr">
        <span className="text-[14px] font-extrabold text-muted">$</span>
        <input
          type="number" min={0} step={0.5} inputMode="decimal"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
          className="h-11 w-full bg-transparent text-[14px] font-medium text-ink outline-none"
        />
      </div>
    </label>
  );
}

function Field({ label, value, onChange, ltr }: { label: string; value: string; onChange: (v: string) => void; ltr?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-bold text-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} dir={ltr ? "ltr" : undefined}
        className="h-11 w-full rounded-2xl border-2 border-slate-200 bg-white px-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500" />
    </label>
  );
}

function Area({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-bold text-muted">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows}
        className="w-full resize-none rounded-2xl border-2 border-slate-200 bg-white p-3.5 text-[14px] font-medium text-ink outline-none focus:border-brand-500" />
    </label>
  );
}
