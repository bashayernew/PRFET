"use client";

import { useI18n } from "@/lib/i18n";

/**
 * Terms & Conditions — the client's official text. Arabic is the authoritative version
 * (these terms are governed by the laws of Kuwait, per clause 9); the English below is a
 * courtesy translation. Shown according to the app's current language.
 */

type Section = { h: string; body?: string; items?: string[] };

const AR: { intro: string; sections: Section[]; updated: string; title: string } = {
  title: "الشروط والأحكام وسياسة الاستخدام لتطبيق PRFET",
  updated: "آخر تحديث",
  intro:
    "أهلاً بك في تطبيق PRFET (المشار إليه لاحقاً بـ «التطبيق» أو «الإدارة» أو «نحن»). تشكّل هذه الوثيقة اتفاقية قانونية ملزمة بين التطبيق وبينك كـ «مستخدم» أو «مشترك». بمجرد إنشائك للحساب، أو تحميل التطبيق، أو استخدامه بأي شكل من الأشكال، فإنك تقر وتوافق صراحةً وبدون أي تحفظ على الالتزام الكامل بكافة الشروط والأحكام الموضحة أدناه.",
  sections: [
    { h: "المادة 1: الفئة العمرية وحظر قاصري السن", items: [
      "الشرط العمري: هذا التطبيق مخصص حصراً للمستخدمين الذين يبلغون من العمر 18 عاماً فما فوق (+18).",
      "إخلاء مسؤولية العمر: يُحظر تماماً استخدام التطبيق ممن هم دون سن 18 عاماً. ولا تتحمل إدارة التطبيق أي مسؤولية قانونية أو مدنية أو جنائية عن إدخال بيانات خاطئة أو تسجيل أي مستخدم تحت السن القانونية، وتقع المسؤولية كاملةً على المستخدم أو ولي أمره.",
    ] },
    { h: "المادة 2: طبيعة الخدمات، الخصوصية، والتحكم الذاتي للمستخدم", items: [
      "التحكم المستقل للخدمات: خدمات التواصل والبحث المعتمدة على (المسافة، الاسم، البلوتوث BLE، أو الذكاء الاصطناعي) تقع تحت التحكم الكامل والفاعل من قبل المستخدم نفسه وحده.",
      "حرية الفتح والإغلاق: يملك المستخدم مطلق الحرية والسيطرة الكاملة عبر إعدادات التطبيق في تفعيل أو إيقاف خدمات البلوتوث، وتحديد الموقع الجغرافي، وضبط حالة الحساب (خاص Private / عام Public / أصدقاء فقط)، أو قبول وارد الرسائل والتواصل.",
      "انعدام تدخل الإدارة: تقع جميع عمليات التفاعل والقبول والتوصيل والاكتشاف الجغرافي أو عبر البلوتوث بناءً على اختيارات المستخدم الصريحة دون أي تدخل أو إملاء من إدارة التطبيق.",
      "إخلاء المسؤولية عن التواصل: لا تتحمل إدارة التطبيق أي مسؤولية قانونية أو أمنية أو أخلاقية عن طبيعة الاتصالات أو اللقاءات أو تبادل البيانات والتفاعلات الناتجة بين المستخدمين عبر التطبيق.",
    ] },
    { h: "المادة 3: السلوكيات المحظورة وحظر المحتوى", body: "يُحظر على المستخدم حظراً مطلقاً استخدام التطبيق، أو البث المباشر (Live Streams)، أو الغرف الخاصة، أو الرسائل في ارتكاب أو تسهيل أي من الأفعال التالية:", items: [
      "الإساءة والسب: التلفظ بالشتائم أو الإساءات اللفظية أو القذف أو التحرش بكل أشكاله تجاه أي مستخدم آخر أو جهة.",
      "السياسة والمقدسات: الإساءة إلى الأديان أو المذاهب أو الشعائر الدينية أو السياسات أو الدول أو سيادتها أو رموزها أو حكامها أو الشخصيات العامة والاعتبارية.",
      "الكراهية والإرهاب: التحريض على الكراهية أو التمييز العنصري أو العنف أو الترهيب أو دعم وتأييد أي أنشطة إرهابية أو إجرامية.",
      "المساس بالآداب العامة: نشر أو بث أو مشاركة صور أو مقاطع أو نصوص مخلة بالآداب أو منافية للقيم والأخلاق والعادات والتقاليد الجارية في دولة الكويت والدول العربية والعالمية.",
    ] },
    { h: "المادة 4: صلاحيات الإدارة في الحظر والإلغاء وحظر التعويض", items: [
      "حق الإنهاء الفوري: يحق لإدارة التطبيق — بإرادتها المنفردة ودون الحاجة إلى إنذار مسبق أو إشعار رسمي أو حكم قضائي — إيقاف أو تعليق أو حذف حساب أي مستخدم يخالف هذه الشروط والأحكام، أو تتعدد بحقه بلاغات الإساءة من المستخدمين الآخرين.",
      "إسقاط الحق في التعويض: في حال إيقاف أو حذف الحساب بسبب المخالفة أو الإساءة، يسقط حق المستخدم نهائياً ولا يحق له مطالبة الإدارة بأي تعويضات مالية عن الرصيد المتبقي في الحساب أو قيمة الاشتراكات المدفوعة أو الأرصدة المتبقية.",
      "حذف الإعلانات: يحق للإدارة مسح أو إلغاء أي إعلان تجاري أو توظيفي يُنشر داخل التطبيق إذا تبين أنه يسيء للقيم أو العادات والتقاليد أو يدعو للعدائية أو يخالف الأنظمة العامة.",
    ] },
    { h: "المادة 5: إلغاء الحساب والاشتراكات من قبل المستخدم", items: [
      "إلغاء الحساب الذاتي: يمتلك كل مستخدم القدرة الكاملة على إغلاق قنوات التواصل أو إلغاء الاشتراك أو حذف حسابه نهائياً وفي أي وقت من خلال قائمة إعدادات التطبيق.",
      "عدم الاسترداد المالي: عند قيام المستخدم بإلغاء حسابه أو حذفه طواعية، فإنه يقر بإسقاط حقه في المطالبة باسترداد أي مبالغ مالية أو اشتراكات سارية أو أرصدة سابقة تم دفعها للتطبيق.",
    ] },
    { h: "المادة 6: حدود المسؤولية القانونية وتخليص الذمة", items: [
      "نطاق المسؤولية: يُقدم التطبيق والخدمات المرتبطة به «كما هي» (As-Is)، ولا تتحمل الإدارة أو ملاك التطبيق أو مطوروه أي مسؤولية مباشرة أو غير مباشرة عن أي أضرار مادية أو معنوية أو مدنية ينشئها سوء استخدام التطبيق من قبل أطراف أخرى.",
      "حماية الإدارة: يلتزم المستخدم بتعويض إدارة التطبيق وحمايتها من أي مطالبات أو خسائر أو تكاليف قضائية وقانونية تنتج عن مخالفته للقوانين المحلية أو الدولية أو بنود هذه الاتفاقية.",
    ] },
    { h: "المادة 7: الصيانة الدورية والأعطال التقنية وإخلاء المسؤولية المالية", items: [
      "أعمال الصيانة والتحديثات: يحق لإدارة التطبيق — في أي وقت ودون الحاجة إلى إشعار مسبق — إيقاف التطبيق أو تعطيل بعض خدماته مؤقتاً (سواءً لساعة أو لعدة ساعات أو لأي فترة زمنية تستدعي ذلك) لأغراض إجراء الصيانة الدورية أو التحديثات التقنية أو تطوير البنية التحتية أو إضافة ميزات جديدة.",
      "الأعطال والظروف الخارجة عن الإرادة: تخلي إدارة التطبيق مسؤوليتها الكاملة عن أي توقف أو انقطاع أو خلل فني في الخدمة ناتج عن خوادم الشركاء أو الهجمات الإلكترونية أو انقطاع شبكات الاتصالات أو أي ظروف وأسباب تقنية خارجة عن السيطرة المباشرة للإدارة.",
      "إسقاط الحق في التعويض والمطالبة المالية: يقر ويوافق المستخدم/المشترك صراحةً وبشكل نهائي لا رجعة فيه على أنه لا يحق له المطالبة بأي تعويض مالي أو قانوني أو استرداد لقيمة الاشتراكات المدفوعة (أو جزء منها) أو أي مطالبات من أي نوع مقابل فترات التوقف أو الصيانة أو الأعطال التقنية المشار إليها في هذه المادة.",
    ] },
    { h: "المادة 8: القانون الواجب التطبيق والتقاضي", items: [
      "القانون الحاكم: تخضع هذه الوثيقة وتُفسر وفقاً لقوانين دولة الكويت (لا سيما قانون الجرائم الإلكترونية رقم 63 لسنة 2015 وقانون المعاملات الإلكترونية رقم 20 لسنة 2014) والمواثيق الرقمية الدولية ذات الصلة.",
      "الاختصاص القضائي: تختص المحاكم الكويتية حصرياً بالفصل في أي نزاع أو خلاف نشأ أو قد ينشأ عن استخدام هذا التطبيق أو هذه الاتفاقية.",
    ] },
  ],
};

const EN: { intro: string; sections: Section[]; updated: string; title: string } = {
  title: "PRFET Terms of Use & Conditions",
  updated: "Last updated",
  intro:
    "Welcome to PRFET (referred to as “the App”, “the Administration”, or “we”). This document forms a binding legal agreement between the App and you as a “User” or “Subscriber.” By creating an account, downloading the App, or using it in any way, you expressly and unconditionally acknowledge and agree to be fully bound by all the terms and conditions set out below.",
  sections: [
    { h: "Article 1: Age Group & Prohibition of Minors", items: [
      "Age requirement: This App is intended exclusively for users aged 18 and over (18+).",
      "Age disclaimer: Use of the App by anyone under 18 is strictly prohibited. The App's administration bears no legal, civil, or criminal liability for false data entry or the registration of any underage user; full responsibility lies with the user or their guardian.",
    ] },
    { h: "Article 2: Nature of Services, Privacy & User Self-Control", items: [
      "Independent control of services: Communication and discovery services based on (distance, name, Bluetooth BLE, or AI) are under the full and active control of the user alone.",
      "Freedom to turn on/off: The user has complete freedom and control, through the App's settings, to enable or disable Bluetooth, set geolocation, set the account status (Private / Public / Friends only), or accept incoming messages and contact.",
      "No administration interference: All interactions, acceptances, connections, and geo- or Bluetooth-based discovery occur based on the user's explicit choices, without any interference or direction from the App's administration.",
      "Disclaimer for communications: The App's administration bears no legal, security, or moral responsibility for the nature of communications, meetings, or the exchange of data and interactions between users through the App.",
    ] },
    { h: "Article 3: Prohibited Conduct & Content", body: "The user is absolutely prohibited from using the App, live streams, private rooms, or messages to commit or facilitate any of the following:", items: [
      "Abuse and insults: Profanity, verbal abuse, defamation, or harassment of any kind toward any other user or party.",
      "Politics and sanctities: Insulting religions, sects, religious rites, politics, states, their sovereignty, symbols, rulers, or public and legal figures.",
      "Hate and terrorism: Incitement to hatred, racial discrimination, violence, intimidation, or the support of any terrorist or criminal activity.",
      "Public decency: Publishing, streaming, or sharing images, clips, or texts that are indecent or contrary to the values, morals, customs, and traditions of the State of Kuwait, the Arab countries, and the world.",
    ] },
    { h: "Article 4: Administration's Rights to Ban, Cancel & Deny Compensation", items: [
      "Right of immediate termination: The App's administration may — at its sole discretion and without prior warning, formal notice, or a court ruling — stop, suspend, or delete the account of any user who violates these Terms, or against whom abuse reports accumulate.",
      "Forfeiture of compensation: If an account is stopped or deleted due to a violation or abuse, the user permanently forfeits any right to claim financial compensation for a remaining balance, the value of paid subscriptions, or any remaining credit.",
      "Removal of ads: The administration may remove or cancel any commercial or recruitment ad published in the App if it is found to insult values, customs and traditions, incite hostility, or violate public regulations.",
    ] },
    { h: "Article 5: Account & Subscription Cancellation by the User", items: [
      "Self-cancellation: Every user has the full ability to close communication channels, cancel a subscription, or permanently delete their account at any time through the App's settings menu.",
      "No refunds: When a user voluntarily cancels or deletes their account, they acknowledge forfeiting the right to claim a refund of any monies, active subscriptions, or previous balances paid to the App.",
    ] },
    { h: "Article 6: Limitation of Liability & Indemnification", items: [
      "Scope of liability: The App and its associated services are provided “As-Is.” The administration, owners, and developers bear no direct or indirect liability for any material, moral, or civil damages caused by misuse of the App by other parties.",
      "Protection of the administration: The user undertakes to indemnify and hold the App's administration harmless from any claims, losses, or judicial and legal costs resulting from their violation of local or international laws or of the terms of this agreement.",
    ] },
    { h: "Article 7: Maintenance, Technical Outages & Financial Disclaimer", items: [
      "Maintenance and updates: The administration may — at any time and without prior notice — stop the App or temporarily disable some services (for an hour, several hours, or any needed period) for routine maintenance, technical updates, infrastructure development, or adding new features.",
      "Outages and force majeure: The administration disclaims all liability for any stoppage, interruption, or technical fault caused by partner servers, cyberattacks, network outages, or any technical circumstances beyond its direct control.",
      "Forfeiture of financial claims: The user/subscriber expressly and irrevocably agrees that they have no right to claim any financial or legal compensation, a refund of paid subscriptions (in whole or in part), or any claims of any kind, for the downtime, maintenance, or technical faults referred to in this article.",
    ] },
    { h: "Article 8: Governing Law & Jurisdiction", items: [
      "Governing law: This document is governed by and interpreted in accordance with the laws of the State of Kuwait (in particular Cybercrime Law No. 63 of 2015 and Electronic Transactions Law No. 20 of 2014) and relevant international digital conventions.",
      "Jurisdiction: The courts of Kuwait have exclusive jurisdiction to decide any dispute arising or that may arise from the use of this App or this agreement.",
    ] },
  ],
};

export default function TermsPage() {
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
