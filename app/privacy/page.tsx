"use client";

import { useI18n } from "@/lib/i18n";

/**
 * Privacy Policy — written to match what PRFET actually does and to satisfy Google Play
 * (Data Safety) and Apple App Store privacy requirements. Arabic is authoritative (Kuwait
 * law); English is a courtesy translation. No third-party analytics/ad trackers are used.
 */

type Section = { h: string; body?: string; items?: string[] };

const AR: { title: string; updated: string; intro: string; sections: Section[] } = {
  title: "سياسة الخصوصية لتطبيق PRFET",
  updated: "آخر تحديث",
  intro:
    "خصوصيتك تهمّنا. توضّح هذه السياسة البيانات التي نجمعها عند استخدامك تطبيق PRFET (“التطبيق”، “نحن”)، وكيف نستخدمها ونحميها، وحقوقك تجاهها. باستخدامك التطبيق فإنك توافق على هذه السياسة.",
  sections: [
    { h: "1. البيانات التي نجمعها", body: "نجمع فقط ما يلزم لتشغيل التطبيق:", items: [
      "بيانات الحساب: الاسم، البريد الإلكتروني أو رقم الهاتف، كلمة المرور (تُخزَّن مشفّرة)، تاريخ الميلاد، الجنس، الجنسية، الصورة الشخصية، ونبذة تعريفية إن أضفتها.",
      "المحتوى الذي تنشئه: المنشورات، القصص، المقاطع، التعليقات، الرسائل، الوسائط، والرسائل الصوتية.",
      "الموقع الجغرافي: يُجمع فقط إذا فعّلت مشاركة الموقع، ويُستخدم لاكتشاف من حولك وحساب المسافة. يمكنك إيقافه في أي وقت.",
      "بيانات تقنية: عنوان IP ونوع الجهاز والمتصفّح، وسجلّات استخدام أساسية لأغراض الأمان وتشغيل الخدمة. لا نستخدم أدوات تتبّع إعلانية أو تحليلات خارجية.",
      "بيانات الدفع: تُعالَج عمليات الشراء عبر متجر التطبيقات أو بوابة دفع معتمدة؛ نحن لا نخزّن أرقام بطاقاتك.",
    ] },
    { h: "2. كيف نستخدم بياناتك", items: [
      "لإنشاء حسابك وتشغيل ميزات التطبيق: النشر، المراسلة، المكالمات، الغرف الصوتية، والاكتشاف.",
      "لإرسال الإشعارات التي تفعّلها، وللرد على طلبات الدعم.",
      "للحفاظ على أمان المنصّة ومكافحة الاحتيال والإساءة ومراجعة البلاغات.",
      "للامتثال للالتزامات القانونية.",
    ] },
    { h: "3. ميزات الذكاء الاصطناعي", items: [
      "عند استخدامك المساعد الذكي، يُرسَل ما تكتبه أو ترسله (نص، صورة، أو صوت) إلى خدمة الذكاء الاصطناعي من Google (Gemini) لتوليد الردود أو الصور أو المقاطع.",
      "يخضع هذا المحتوى لشروط وسياسات Google. يُرجى عدم مشاركة معلومات حساسة مع المساعد.",
    ] },
    { h: "4. مشاركة البيانات مع أطراف أخرى", body: "لا نبيع بياناتك. نشاركها فقط مع مزوّدي خدمات ضروريين لتشغيل التطبيق:", items: [
      "Google — لتشغيل ميزات الذكاء الاصطناعي.",
      "LiveKit — لبثّ الصوت والفيديو داخل الغرف والمكالمات.",
      "Resend — لإرسال رسائل البريد الإلكتروني (رموز التحقق والإشعارات).",
      "مزوّد الاستضافة (Hetzner) — لتخزين البيانات وتشغيل الخوادم.",
      "متجر التطبيقات وبوابات الدفع — لإتمام عمليات الاشتراك والشراء.",
      "الجهات المختصة — عند وجود التزام قانوني يستوجب ذلك.",
    ] },
    { h: "5. ما يراه المستخدمون الآخرون", items: [
      "ملفك الشخصي ومنشوراتك تكون ظاهرة للمستخدمين الآخرين وفق إعداداتك.",
      "إذا فعّلت مشاركة الموقع، قد تظهر المسافة بينك وبين المستخدمين الآخرين. المتابِعون والمتابَعون لا يظهرون إلا لك.",
    ] },
    { h: "6. مدة الاحتفاظ بالبيانات", items: [
      "نحتفظ ببياناتك طالما ظلّ حسابك فعّالاً. عند حذف حسابك تُحذف بياناتك الشخصية ومحتواك، باستثناء ما يلزم الاحتفاظ به قانونياً أو لأغراض الأمان.",
    ] },
    { h: "7. حقوقك وخياراتك", items: [
      "الوصول إلى بياناتك وتصحيحها من إعدادات الحساب.",
      "التحكّم في مشاركة الموقع والإشعارات في أي وقت.",
      "حذف حسابك وبياناتك (انظر البند التالي).",
    ] },
    { h: "8. حذف الحساب والبيانات", items: [
      "يمكنك طلب حذف حسابك وكل بياناتك المرتبطة به في أي وقت من داخل التطبيق، أو بمراسلتنا على admin@prfet.com، أو عبر صفحة الدعم داخل التطبيق.",
      "تُنفَّذ عملية الحذف خلال مدة معقولة، وتُزال بياناتك الشخصية ومحتواك نهائياً عدا ما يلزم الاحتفاظ به قانونياً.",
    ] },
    { h: "9. أمان البيانات", items: [
      "نستخدم التشفير أثناء النقل، ونخزّن كلمات المرور بصيغة مشفّرة، ونطبّق ضوابط وصول. لا توجد وسيلة نقل أو تخزين آمنة بنسبة 100%، لكننا نبذل جهداً معقولاً لحماية بياناتك.",
    ] },
    { h: "10. الأطفال", items: [
      "التطبيق مخصّص لمن هم في سنّ 18 عاماً فأكثر، ولا نجمع عن قصد بيانات ممّن هم دون ذلك. إذا علمنا بذلك نحذف الحساب.",
    ] },
    { h: "11. نقل البيانات دولياً", items: [
      "قد تُخزَّن بياناتك وتُعالَج على خوادم خارج بلدك (لدى مزوّد الاستضافة في أوروبا). باستخدامك التطبيق توافق على ذلك.",
    ] },
    { h: "12. التعديلات على هذه السياسة", items: [
      "قد نحدّث هذه السياسة من وقت لآخر، وسنُشعرك بالتعديلات الجوهرية عبر التطبيق أو البريد الإلكتروني.",
    ] },
    { h: "13. التواصل معنا", body: "لأي استفسار حول الخصوصية:", items: [
      "البريد الإلكتروني: admin@prfet.com",
      "من داخل التطبيق: الدعم الفني / المساعدة",
    ] },
    { h: "14. القانون الواجب التطبيق", items: [
      "تخضع هذه السياسة لقوانين دولة الكويت، وتختص محاكم الكويت بأي نزاع ينشأ عنها.",
    ] },
  ],
};

const EN: { title: string; updated: string; intro: string; sections: Section[] } = {
  title: "PRFET Privacy Policy",
  updated: "Last updated",
  intro:
    "Your privacy matters to us. This policy explains what data we collect when you use PRFET (“the App”, “we”), how we use and protect it, and your rights. By using the App you agree to this policy.",
  sections: [
    { h: "1. Information We Collect", body: "We collect only what the App needs to work:", items: [
      "Account data: name, email or phone, password (stored encrypted), date of birth, gender, nationality, profile photo, and a bio if you add one.",
      "Content you create: posts, stories, reels, comments, messages, media, and voice notes.",
      "Location: collected only if you enable location sharing, and used to discover people near you and show distance. You can turn it off at any time.",
      "Technical data: IP address, device and browser type, and basic usage logs for security and to run the service. We do not use advertising trackers or third-party analytics.",
      "Payment data: purchases are processed by the app store or an approved payment gateway; we do not store your card numbers.",
    ] },
    { h: "2. How We Use Your Data", items: [
      "To create your account and run the App's features: posting, messaging, calls, audio rooms, and discovery.",
      "To send the notifications you enable, and to respond to support requests.",
      "To keep the platform safe — fraud/abuse prevention and reviewing reports.",
      "To comply with legal obligations.",
    ] },
    { h: "3. AI Features", items: [
      "When you use the AI assistant, what you type or send (text, image, or voice) is sent to Google's AI service (Gemini) to generate responses, images, or clips.",
      "That content is subject to Google's terms and policies. Please do not share sensitive information with the assistant.",
    ] },
    { h: "4. Sharing With Third Parties", body: "We do not sell your data. We share it only with service providers needed to run the App:", items: [
      "Google — to power the AI features.",
      "LiveKit — to stream audio and video inside rooms and calls.",
      "Resend — to send emails (verification codes and notifications).",
      "Our hosting provider (Hetzner) — to store data and run the servers.",
      "The app store and payment gateways — to complete subscriptions and purchases.",
      "Authorities — where required by a legal obligation.",
    ] },
    { h: "5. What Other Users Can See", items: [
      "Your profile and posts are visible to other users according to your settings.",
      "If you enable location sharing, the distance between you and other users may be shown. Your followers and following lists are visible only to you.",
    ] },
    { h: "6. Data Retention", items: [
      "We keep your data while your account is active. When you delete your account, your personal data and content are deleted, except what we must keep for legal or security reasons.",
    ] },
    { h: "7. Your Rights & Choices", items: [
      "Access and correct your data from account settings.",
      "Control location sharing and notifications at any time.",
      "Delete your account and data (see the next section).",
    ] },
    { h: "8. Account & Data Deletion", items: [
      "You can request deletion of your account and all associated data at any time from within the App, by emailing us at admin@prfet.com, or via the in-app Support page.",
      "Deletion is carried out within a reasonable period, and your personal data and content are permanently removed except what must be retained by law.",
    ] },
    { h: "9. Data Security", items: [
      "We use encryption in transit, store passwords in encrypted form, and apply access controls. No method of transmission or storage is 100% secure, but we make reasonable efforts to protect your data.",
    ] },
    { h: "10. Children", items: [
      "The App is intended for users aged 18 and over, and we do not knowingly collect data from anyone younger. If we learn of such an account, we delete it.",
    ] },
    { h: "11. International Transfers", items: [
      "Your data may be stored and processed on servers outside your country (with our hosting provider in Europe). By using the App you consent to this.",
    ] },
    { h: "12. Changes to This Policy", items: [
      "We may update this policy from time to time and will notify you of material changes via the App or email.",
    ] },
    { h: "13. Contact Us", body: "For any privacy question:", items: [
      "Email: admin@prfet.com",
      "Inside the app: Support / Help",
    ] },
    { h: "14. Governing Law", items: [
      "This policy is governed by the laws of the State of Kuwait, and the courts of Kuwait have jurisdiction over any dispute arising from it.",
    ] },
  ],
};

export default function PrivacyPage() {
  const { dir } = useI18n();
  const ar = dir === "rtl";
  const c = ar ? AR : EN;
  return (
    <main dir={dir} className="mx-auto max-w-[760px] px-6 py-12 text-ink">
      <h1 className="text-3xl font-extrabold">{c.title}</h1>
      <p className="mt-2 text-sm text-muted">{c.updated}: {new Date().getFullYear()}</p>
      <p className="mt-6 text-[15px] leading-relaxed text-ink/80">{c.intro}</p>

      <div className="mt-8 space-y-7">
        {c.sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-xl font-bold text-ink">{s.h}</h2>
            {s.body && <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{s.body}</p>}
            {s.items && (
              <ul className={`mt-2 space-y-2 text-[15px] leading-relaxed text-ink/80 ${ar ? "pe-5" : "ps-5"} list-disc`}>
                {s.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
