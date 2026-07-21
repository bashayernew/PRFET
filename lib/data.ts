export type Business = {
  id: string;
  ar: string;
  en: string;
  catKey: string;
  online: boolean;
  dist: string;
  rating: string;
  reviews: number;
  followers: number;
  descAr: string;
  descEn: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  openNow: boolean;
  closesAr: string;
  closesEn: string;
  // account extras (optional)
  avatarUrl?: string;      // profile photo
  hasStory?: boolean;      // has an unseen story to view
  gender?: "male" | "female";
  nationality?: string;    // country code
  isPremium?: boolean;     // subscribed (gold VIP)
  shareLocation?: boolean; // precise location enabled by this user
  lat?: number;
  lng?: number;
};

// No sample/demo accounts — Herot runs on real accounts only.
export const BUSINESSES: Business[] = [];

export const getBusiness = (id: string) => BUSINESSES.find((b) => b.id === id);

export type Conversation = {
  id: string;
  ar: string;
  en: string;
  catKey: string;
  online: boolean;
  lastAr: string;
  lastEn: string;
  timeAr: string;
  timeEn: string;
  unread: number;
};

export const CONVERSATIONS: Conversation[] = [
  {
    id: "1",
    ar: "حلويات الحي",
    en: "Neighborhood Sweets",
    catKey: "cat.sweets",
    online: true,
    lastAr: "تم تجهيز طلبك ✅",
    lastEn: "Your order is ready ✅",
    timeAr: "١٠:٢٤",
    timeEn: "10:24",
    unread: 2,
  },
  {
    id: "4",
    ar: "سبّاك سريع",
    en: "Quick Plumber",
    catKey: "cat.plumber",
    online: true,
    lastAr: "أنا في الطريق إليك الآن",
    lastEn: "I'm on my way now",
    timeAr: "٩:٠٥",
    timeEn: "9:05",
    unread: 0,
  },
  {
    id: "2",
    ar: "مطعم البيت",
    en: "Home Kitchen",
    catKey: "cat.restaurants",
    online: false,
    lastAr: "شكراً لطلبك! 🙏",
    lastEn: "Thanks for your order! 🙏",
    timeAr: "أمس",
    timeEn: "Yesterday",
    unread: 0,
  },
  {
    id: "3",
    ar: "صيدلية النور",
    en: "Al Noor Pharmacy",
    catKey: "cat.pharmacy",
    online: false,
    lastAr: "الدواء متوفر لدينا",
    lastEn: "The medicine is in stock",
    timeAr: "الإثنين",
    timeEn: "Mon",
    unread: 1,
  },
  {
    id: "5",
    ar: "مغسلة اللؤلؤة",
    en: "Pearl Laundry",
    catKey: "cat.laundry",
    online: false,
    lastAr: "ملابسك جاهزة للاستلام",
    lastEn: "Your laundry is ready for pickup",
    timeAr: "السبت",
    timeEn: "Sat",
    unread: 0,
  },
];

export const getConversation = (id: string) => CONVERSATIONS.find((c) => c.id === id);

export type Job = {
  id: string;
  companyId: string; // links to a Business (employer)
  titleAr: string;
  titleEn: string;
  catKey: string;
  typeKey: "full" | "part" | "remote";
  locationAr: string;
  locationEn: string;
  salaryAr: string;
  salaryEn: string;
  postedAr: string;
  postedEn: string;
};

export const JOBS: Job[] = [
  { id: "j1", companyId: "1", titleAr: "بائع حلويات", titleEn: "Sweets Salesperson", catKey: "cat.sweets", typeKey: "full", locationAr: "الرياض، العليا", locationEn: "Riyadh, Al Olaya", salaryAr: "٣٬٠٠٠ ر.س", salaryEn: "SAR 3,000", postedAr: "منذ يومين", postedEn: "2d ago" },
  { id: "j2", companyId: "2", titleAr: "طاهٍ", titleEn: "Cook", catKey: "cat.restaurants", typeKey: "full", locationAr: "الرياض، السليمانية", locationEn: "Riyadh, Al Sulaimaniyah", salaryAr: "٤٬٥٠٠ ر.س", salaryEn: "SAR 4,500", postedAr: "منذ ٣ أيام", postedEn: "3d ago" },
  { id: "j3", companyId: "3", titleAr: "مساعد صيدلي", titleEn: "Pharmacy Assistant", catKey: "cat.pharmacy", typeKey: "part", locationAr: "الرياض، الورود", locationEn: "Riyadh, Al Wurud", salaryAr: "٢٬٥٠٠ ر.س", salaryEn: "SAR 2,500", postedAr: "منذ أسبوع", postedEn: "1w ago" },
  { id: "j4", companyId: "4", titleAr: "فني سباكة", titleEn: "Plumbing Technician", catKey: "cat.plumber", typeKey: "full", locationAr: "الرياض", locationEn: "Riyadh", salaryAr: "حسب الخبرة", salaryEn: "DOE", postedAr: "أمس", postedEn: "Yesterday" },
  { id: "j5", companyId: "5", titleAr: "عامل مغسلة", titleEn: "Laundry Worker", catKey: "cat.laundry", typeKey: "part", locationAr: "الرياض، الملز", locationEn: "Riyadh, Al Malaz", salaryAr: "٢٬٢٠٠ ر.س", salaryEn: "SAR 2,200", postedAr: "منذ ٤ أيام", postedEn: "4d ago" },
];
