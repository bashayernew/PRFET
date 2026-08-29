import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromRequest, verifyAccessToken, identifierWhere } from "@/lib/auth";
import { COUNTRIES } from "@/lib/countries";

// Placeholder details so the page is never empty — the owner replaces them
// from the admin dashboard (the pencil on the contact page) whenever ready.
const DEFAULTS = {
  id: "app",
  adminEmail: "admin@prfet.com",
  supportPhone: "+96598905755",
  whatsapp: "+96598905755",
  aboutAr: "PRFET يقرّبك ممن حولك — اكتشف المتاجر والخدمات والأشخاص من حولك، تابعهم، وتواصل معهم مباشرة.",
  aboutEn: "PRFET connects you with what's around you — discover nearby businesses, services and people, follow them, and message them directly.",
  complaintsInfo: "نستقبل شكواك هنا وتُراجع من الإدارة خلال ٤٨ ساعة، وسنرد عليك على بريدك أو رقمك إن أضفته.",
  inquiriesInfo: "اكتب استفسارك وسترد عليك الإدارة في أقرب وقت، عادة خلال ٢٤ ساعة.",
  legalRepName: "المحامي / عمر علي الفودري",
  legalRepEmail: "legal@prfet.com",
  legalRepPhone: "", // his personal number is deliberately NOT shown anywhere
  legalRepAvatar: "",
  legalRepUserId: "",
  address: "الكويت",
  closedCountries: "", // CSV of ISO codes the admin has switched off
  sponsorName: "",
  sponsorLogo: "",
  sponsorText: "",
  sponsorUrl: "",
  priceSubscription: 4.99,
  priceSub3m: 13.99,
  priceSub6m: 26.99,
  priceSub12m: 53.99,
  priceVip: 9.99,
  priceAdBase: 14.99,
  priceAdExtraCountry: 1,
  priceAdExtraDay: 2,
  priceJobApply: 0,
  priceJobPost: 1.99,
  priceSeekerAd: 0.99,
  subEnabled: true,
  adsEnabled: true,
  jobsEnabled: true,
  aiImagesBasic: 35,
  aiImagesVip: 100,
  aiVideosBasic: 9,
  aiVideosVip: 20,
  aiMessagesBasic: 4000,
  aiMessagesVip: 7500,
  storageGbBasic: 25,
  storageGbVip: 50,
  callMinutesBasic: 2000,
  callMinutesVip: 480,
  vaultEnabled: true,
  walletEnabled: true,
  priceAddonVoice: 1.99,
  priceAddonMedia: 1.99,
  priceAddonStorage: 1.99,
  aiEnabled: true,
  aiPremiumOnly: true, // the assistant is a paid perk
};

// GET /api/settings — the app's public contact details (everyone can read).
export async function GET() {
  const s = await prisma.appSettings.findUnique({ where: { id: "app" } });
  // Never expose the dashboard secrets on this public endpoint.
  const safe = s
    ? (() => {
        const row = s as Record<string, unknown>;
        for (const k of ["adminPassHash", "dashEmail", "dashPendingEmail", "dashOtpHash", "dashOtpExp"]) delete row[k];
        return row;
      })()
    : DEFAULTS;
  return NextResponse.json({ settings: safe });
}

const patchSchema = z.object({
  adminEmail: z.string().max(160).optional(),
  supportPhone: z.string().max(40).optional(),
  whatsapp: z.string().max(40).optional(),
  aboutAr: z.string().max(4000).optional(),
  aboutEn: z.string().max(4000).optional(),
  complaintsInfo: z.string().max(2000).optional(),
  inquiriesInfo: z.string().max(2000).optional(),
  legalRepName: z.string().max(120).optional(),
  legalRepEmail: z.string().max(160).optional(),
  legalRepPhone: z.string().max(40).optional(),
  legalRepAvatar: z.string().max(2000000).optional(), // data URL, same budget as member avatars
  // email or phone of the lawyer's in-app account; "" unlinks. Resolved to an id below.
  legalRepAccount: z.string().max(160).optional(),
  address: z.string().max(300).optional(),
  closedCountries: z.string().max(2000).optional(), // CSV of ISO codes
  sponsorName: z.string().max(160).optional(),
  sponsorLogo: z.string().max(2000000).optional(), // data URL
  sponsorText: z.string().max(4000).optional(),
  sponsorUrl: z.string().max(500).optional(),
  // pricing — USD; rooms have no price of their own (they ride on the subscription)
  priceSubscription: z.number().min(0).max(100000).optional(),
  priceSub3m: z.number().min(0).max(100000).optional(),
  priceSub6m: z.number().min(0).max(100000).optional(),
  priceSub12m: z.number().min(0).max(100000).optional(),
  priceVip: z.number().min(0).max(100000).optional(),
  priceAdBase: z.number().min(0).max(100000).optional(),
  priceAdExtraCountry: z.number().min(0).max(100000).optional(),
  priceAdExtraDay: z.number().min(0).max(100000).optional(),
  priceJobApply: z.number().min(0).max(100000).optional(),
  priceJobPost: z.number().min(0).max(100000).optional(),
  priceSeekerAd: z.number().min(0).max(100000).optional(),
  // master on/off switches
  subEnabled: z.boolean().optional(),
  adsEnabled: z.boolean().optional(),
  jobsEnabled: z.boolean().optional(),
  // monthly AI caps per tier (0 = unlimited)
  aiImagesBasic: z.number().int().min(0).max(100000).optional(),
  aiImagesVip: z.number().int().min(0).max(100000).optional(),
  aiVideosBasic: z.number().int().min(0).max(100000).optional(),
  aiVideosVip: z.number().int().min(0).max(100000).optional(),
  aiMessagesBasic: z.number().int().min(0).max(10000000).optional(),
  aiMessagesVip: z.number().int().min(0).max(10000000).optional(),
  storageGbBasic: z.number().int().min(0).max(100000).optional(),
  storageGbVip: z.number().int().min(0).max(100000).optional(),
  callMinutesBasic: z.number().int().min(0).max(10000000).optional(),
  callMinutesVip: z.number().int().min(0).max(10000000).optional(),
  vaultEnabled: z.boolean().optional(),
  walletEnabled: z.boolean().optional(),
  priceAddonVoice: z.number().min(0).max(100000).optional(),
  priceAddonMedia: z.number().min(0).max(100000).optional(),
  priceAddonStorage: z.number().min(0).max(100000).optional(),
  aiEnabled: z.boolean().optional(),
  aiPremiumOnly: z.boolean().optional(), // false = open the assistant to free members too
});

/** Keep only real ISO codes, uppercase, deduped — garbage in the CSV never reaches the DB. */
function cleanClosedCountries(csv: string): string {
  const valid = new Set(COUNTRIES.map((c) => c.code));
  return [...new Set(csv.split(",").map((c) => c.trim().toUpperCase()).filter((c) => valid.has(c)))].join(",");
}
// PATCH /api/settings — the admin edits them from the dashboard.
export async function PATCH(req: Request) {
  const token = bearerFromRequest(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isAdmin: true } });
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  if (typeof parsed.data.closedCountries === "string") {
    parsed.data.closedCountries = cleanClosedCountries(parsed.data.closedCountries);
  }

  // legalRepAccount (email/phone) → legalRepUserId. Empty string unlinks.
  const { legalRepAccount, ...data } = parsed.data;
  const patch: Record<string, string | number | boolean> = { ...data } as Record<string, string | number | boolean>;
  if (typeof legalRepAccount === "string") {
    const id = legalRepAccount.trim();
    if (!id) {
      patch.legalRepUserId = "";
    } else {
      const lawyer = await prisma.user.findFirst({ where: identifierWhere(id) });
      if (!lawyer) return NextResponse.json({ error: "lawyer_not_found" }, { status: 404 });
      patch.legalRepUserId = lawyer.id;
    }
  }

  const settings = await prisma.appSettings.upsert({
    where: { id: "app" },
    create: { ...DEFAULTS, ...patch },
    update: patch,
  });
  return NextResponse.json({ settings });
}
