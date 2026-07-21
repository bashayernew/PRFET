export const metadata = { title: "Privacy Policy · PRFET" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[720px] px-6 py-12 text-ink">
      <h1 className="text-3xl font-extrabold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted">Last updated: {new Date().getFullYear()}</p>

      <section className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink/80">
        <p>PRFET ("we", "the app") helps people discover nearby businesses and people, message
        them, share stories, and join audio rooms. This policy explains what we collect and how we use it.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Information we collect</h2>
        <p>Account details you provide (name, email or phone, date of birth, gender, nationality,
        country, and an optional profile photo). Content you create (messages, stories, posts, ads,
        job posts, meeting activity). Approximate or precise location only when you enable location
        sharing. Basic device and usage information needed to run the service.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">How we use it</h2>
        <p>To provide and secure the service: sign-in, showing nearby results and distance,
        delivering messages and notifications, hosting stories/reels/meetings, serving relevant
        ads by country, and preventing abuse.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Sharing</h2>
        <p>We do not sell your personal data. Content is shown to others according to your
        visibility settings (Public or Friends). Service providers (e.g. hosting) process data only
        to run PRFET.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Your choices</h2>
        <p>You can edit your profile, control visibility and location sharing, block or report
        users, and request deletion of your account and data by contacting us.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Children</h2>
        <p>PRFET is not intended for children under the age required in your region. We remove
        accounts that violate this.</p>

        <h2 className="pt-4 text-xl font-bold text-ink">Contact</h2>
        <p>Questions about this policy: <span className="font-semibold">support@your-domain.com</span></p>
      </section>

      <p className="mt-10 text-sm"><a href="/terms" className="font-bold text-brand-600 underline">Terms of Service</a></p>
    </main>
  );
}
