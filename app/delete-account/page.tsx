/**
 * Account & data deletion page — required by Google Play (Data safety) and Apple.
 * A public URL that names the app, explains how to request deletion, and states
 * what is removed vs. retained. Bilingual (Arabic authoritative, English courtesy).
 * Kept dependency-free and light-themed so it always renders as a readable legal page.
 */

export const metadata = {
  title: "Delete your PRFET account",
  description: "How to delete your PRFET account and associated data.",
};

export default function DeleteAccountPage() {
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
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>حذف حساب PRFET وبياناتك</h1>
        <p>
          يمكنك حذف حسابك في تطبيق <strong>PRFET</strong> وكل البيانات المرتبطة به في أي وقت،
          بإحدى الطريقتين:
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>من داخل التطبيق</h2>
        <p>
          افتح التطبيق ← <strong>الإعدادات</strong> ← <strong>حذف الحساب</strong> ← أكّد الحذف.
          يتم حذف حسابك نهائياً.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>عبر البريد الإلكتروني</h2>
        <p>
          أرسل طلباً من بريدك المسجّل إلى{" "}
          <a href="mailto:support@prfet.com">support@prfet.com</a> مع كتابة "حذف الحساب"،
          وسنعالج طلبك خلال مدة أقصاها 30 يوماً.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>ما الذي يُحذف</h2>
        <p>
          يُحذف نهائياً: ملفك الشخصي، منشوراتك وقصصك ومقاطعك وتعليقاتك، رسائلك ومحادثاتك،
          الصور والفيديوهات التي رفعتها، عناصر الخزنة، وسجلّ المساعد الذكي، واشتراكك.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>ما قد يُحتفظ به</h2>
        <p>
          قد نحتفظ بحدٍّ أدنى من السجلّات اللازمة قانونياً أو لمنع الاحتيال لمدة تصل إلى 90 يوماً،
          ثم تُحذف نهائياً.
        </p>
      </section>

      <hr style={{ border: 0, borderTop: "1px solid #e5e7eb", margin: "32px 0" }} />

      {/* English (courtesy) */}
      <section dir="ltr" style={{ textAlign: "left" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Delete your PRFET account &amp; data</h1>
        <p>
          You can delete your <strong>PRFET</strong> account and all associated data at any time,
          in one of two ways:
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>From inside the app</h2>
        <p>
          Open the app → <strong>Settings</strong> → <strong>Delete account</strong> → confirm.
          Your account is permanently deleted.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>By email</h2>
        <p>
          Send a request from your registered email to{" "}
          <a href="mailto:support@prfet.com">support@prfet.com</a> with the subject
          "Delete account". We process requests within 30 days.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>What is deleted</h2>
        <p>
          Permanently removed: your profile; your posts, stories, reels and comments; your messages
          and conversations; photos and videos you uploaded; vault items; AI assistant history; and
          your subscription.
        </p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>What may be retained</h2>
        <p>
          We may keep a minimal set of records required by law or for fraud prevention for up to
          90 days, after which they are permanently deleted.
        </p>
        <p style={{ marginTop: 24, color: "#6b7280", fontSize: 13 }}>PRFET · prfet.com</p>
      </section>
    </main>
  );
}
