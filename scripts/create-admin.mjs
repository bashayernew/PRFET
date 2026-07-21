// Creates (or updates) the owner/admin account.
// Run locally:      node scripts/create-admin.mjs
// Run on the VPS:   docker compose exec app node scripts/create-admin.mjs
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const EMAIL = "admin123@gmail.com";
const PASSWORD = "admin123"; // change here if you want a different password

const prisma = new PrismaClient();

const passwordHash = await bcrypt.hash(PASSWORD, 10);
const user = await prisma.user.upsert({
  where: { email: EMAIL },
  update: { isAdmin: true, isOwner: true, passwordHash },
  create: {
    email: EMAIL,
    contactMethod: "email",
    displayName: "Herot Admin",
    passwordHash,
    isAdmin: true,
    isOwner: true, // THE owner — appoints other admins and confirms their grants
    isVerified: true,
    isPremium: true, // owner gets premium perks (red name, socials, live)
    premiumUntil: new Date("2099-01-01"),
    country: "KW",
  },
});

console.log(`Admin ready: ${user.email} (id ${user.id})`);
await prisma.$disconnect();
