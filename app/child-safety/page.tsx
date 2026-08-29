/**
 * Child Safety Standards page — required by Google Play for Social/Dating apps
 * (Child Safety Standards Policy / CSAE). A public, non-editable, non-PDF URL that states
 * the app's standards for combating child sexual abuse & exploitation, how users report
 * concerns, legal compliance, and a contact. Bilingual (Arabic authoritative, English courtesy).
 */

export const metadata = {
  title: "PRFET — Child Safety Standards",
  description: "PRFET's standards for preventing child sexual abuse and exploitation (CSAE).",
};

export default function ChildSafetyPage() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "32px 20px 64px",
        background: "#ffffff",
        color: "#111827",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        lineHeight: 1.7,
      }}
    >
      {/* Arabic (authoritative) */}
      <section dir="rtl" style={{ textAlign: "right", marginBottom: 40 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>معايير سلامة الأطفال في تطبيق PRFET</h1>
        <p>
          تطبيق <strong>PRFET</strong> مخصّص للبالغين (18 عاماً فأكثر) فقط، ولا يُسمح باستخدامه لمن هم
          دون 18 عاماً. لدينا سياسة <strong>عدم تسامح مطلق</strong> تجاه أي محتوى أو سلوك يتعلّق
          باستغلال الأطفال أو الاعتداء الجنسي عليهم (CSAE)، بما في ذلك مواد الاعتداء الجنسي على
          الأطفال (CSAM).
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>ما نلتزم به</h2>
        <ul>
          <li>منع أي شخص دون 18 عاماً من إنشاء حساب (بوابة عمر عند التسجيل).</li>
          <li>حظر ومنع أي محتوى يتعلّق باستغلال الأطفال، وإزالته فور رصده.</li>
          <li>إتاحة أدوات للحظر والإبلاغ داخل التطبيق لكل مستخدم.</li>
          <li>مراجعة البلاغات واتخاذ إجراءات فورية، بما في ذلك حظر الحسابات المخالفة.</li>
        </ul>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>الإبلاغ داخل التطبيق</h2>
        <p>
          يستطيع أي مستخدم الإبلاغ عن أي محتوى أو مستخدم يثير مخاوف تتعلّق بسلامة الأطفال عبر زر
          "إبلاغ" المتوفّر على الملفات الشخصية والمحتوى والرسائل. تصل هذه البلاغات إلى فريقنا
          للمراجعة الفورية.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>الالتزام القانوني</h2>
        <p>
          نلتزم بجميع القوانين المعمول بها المتعلّقة بسلامة الأطفال، ونتعاون مع الجهات المختصّة
          الإقليمية والوطنية، ونُبلّغ عن مواد الاعتداء الجنسي على الأطفال إلى الجهات المعنيّة عند
          رصدها.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>التواصل</h2>
        <p>
          للإبلاغ عن مخاوف تتعلّق بسلامة الأطفال أو للتواصل معنا بهذا الشأن:{" "}
          <a href="mailto:admin@prfet.com">admin@prfet.com</a>
        </p>
      </section>

      <hr style={{ border: 0, borderTop: "1px solid #e5e7eb", margin: "32px 0" }} />

      {/* English (courtesy) */}
      <section dir="ltr" style={{ textAlign: "left" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>PRFET Child Safety Standards</h1>
        <p>
          <strong>PRFET</strong> is for adults (18+) only; use by anyone under 18 is not permitted.
          We have a <strong>zero-tolerance</strong> policy toward any content or conduct involving
          child sexual abuse and exploitation (CSAE), including child sexual abuse material (CSAM).
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>Our commitments</h2>
        <ul>
          <li>Prevent anyone under 18 from creating an account (age gate at sign-up).</li>
          <li>Prohibit and remove any child-exploitation content immediately on detection.</li>
          <li>Provide in-app block and report tools to every user.</li>
          <li>Review reports and act promptly, including banning violating accounts.</li>
        </ul>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>In-app reporting</h2>
        <p>
          Any user can report content or a user that raises a child-safety concern using the
          "Report" button available on profiles, posts, and messages. These reports reach our team
          for immediate review.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>Legal compliance</h2>
        <p>
          We comply with all applicable child-safety laws, cooperate with regional and national
          authorities, and report child sexual abuse material to the relevant authorities when
          detected.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>Contact</h2>
        <p>
          To report a child-safety concern or contact us on this matter:{" "}
          <a href="mailto:admin@prfet.com">admin@prfet.com</a>
        </p>
        <p style={{ marginTop: 24, color: "#6b7280", fontSize: 13 }}>PRFET · prfet.com</p>
      </section>
    </main>
  );
}
