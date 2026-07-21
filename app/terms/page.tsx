export const metadata = { title: "Terms of Service · PRFET" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-[720px] px-6 py-12 text-ink">
      <h1 className="text-3xl font-extrabold">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted">Last updated: {new Date().getFullYear()}</p>

      <section className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink/80">
        <p>By using PRFET you agree to these terms. If you do not agree, do not use the app.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Your account</h2>
        <p>You are responsible for your account and for the content you post. Provide accurate
        information and keep your credentials secure.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Acceptable use</h2>
        <p>Do not post illegal, harmful, hateful, or infringing content; do not harass, impersonate,
        spam, or attempt to break or abuse the service. We may remove content and suspend accounts
        that violate these rules.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Content &amp; ownership</h2>
        <p>You keep ownership of what you post and grant PRFET the permission needed to display and
        distribute it within the app. You are responsible for having the rights to what you share.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Paid features</h2>
        <p>Ads, premium subscriptions, and paid meeting rooms may be offered. Prices and terms are
        shown at purchase. Billing is handled through the applicable app store or payment provider.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Disclaimer &amp; liability</h2>
        <p>The service is provided "as is". To the extent permitted by law, PRFET is not liable for
        indirect or incidental damages arising from use of the app.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Changes</h2>
        <p>We may update these terms; continued use means you accept the changes.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Contact</h2>
        <p><span className="font-semibold">support@your-domain.com</span></p>
      </section>

      <p className="mt-10 text-sm"><a href="/privacy" className="font-bold text-brand-600 underline">Privacy Policy</a></p>
    </main>
  );
}
