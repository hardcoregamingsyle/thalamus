import { Link } from "react-router";

// Real, indexable legal + contact pages. A paid product (Buy Me a Coffee
// credit packs) needs Privacy, Terms, Refund, and Contact to satisfy payment
// processors, Indian consumer-disclosure norms, and basic E-E-A-T trust —
// and each is a genuine crawlable URL for the internal link graph. One
// component renders all four; the route picks which via `doc`.

const SUPPORT_EMAIL = "hardcorgamingstyle@gmail.com";
const SITE = "https://thalamus.aphantic.skinticals.com";
const COMPANY = "Aphantic Corporations";
const EFFECTIVE = "18 July 2026";

type Doc = "privacy" | "terms" | "refund" | "contact";

interface Section {
  h: string;
  p: string[];
}

const DOCS: Record<Doc, { title: string; metaTitle: string; description: string; intro: string; sections: Section[] }> = {
  privacy: {
    title: "Privacy Policy",
    metaTitle: "Privacy Policy — Thalamus AI",
    description: "How Thalamus AI collects, uses, and protects your data across chat, research, study, and build modes.",
    intro: `This Privacy Policy explains what ${COMPANY} ("we", "us") collects when you use Thalamus, why, and the choices you have. It applies to the Thalamus website, the Windows desktop app, and the API.`,
    sections: [
      { h: "What we collect", p: [
        "Account data: your email address (for sign-in via one-time code) and, if you connect GitHub, your GitHub username and an access token used only to sync your repositories.",
        "Content you provide: chat messages, research queries, study questions, uploaded notes and files, and build instructions. Study materials you upload are stored so study mode can ground answers in them.",
        "Usage data: credits consumed, model usage, and basic diagnostics needed to run the service and prevent abuse.",
      ] },
      { h: "How we use it", p: [
        "To provide the service: routing your requests to AI models, storing your conversations and projects, and metering credits.",
        "To improve reliability and prevent abuse. We do not sell your personal data.",
        "AI model calls are processed by our model providers (AWS Bedrock, Google Gemini) solely to generate your response.",
      ] },
      { h: "Data retention and deletion", p: [
        "Your conversations and uploaded materials are retained while your account is active so you can return to them. You can delete individual conversations and study resources in-app at any time.",
        `To delete your account and associated data, email ${SUPPORT_EMAIL} and we will remove it.`,
      ] },
      { h: "Security", p: [
        "User-supplied provider keys are encrypted at rest (AES-256-GCM). Platform API keys are stored only as SHA-256 hashes. We use HTTPS everywhere. No system is perfectly secure, but we take reasonable measures to protect your data.",
      ] },
      { h: "Children and students", p: [
        "Thalamus is used by students, including minors, through their schools. Where a school provides study mode to its students, the school administers those accounts. We collect only what is needed to provide study help and do not use student content for advertising.",
      ] },
      { h: "Your rights", p: [
        `You may request access to, correction of, or deletion of your personal data by contacting ${SUPPORT_EMAIL}.`,
      ] },
    ],
  },
  terms: {
    title: "Terms of Service",
    metaTitle: "Terms of Service — Thalamus AI",
    description: "The terms that govern your use of Thalamus AI's chat, research, study, and build features.",
    intro: `These Terms govern your use of Thalamus, provided by ${COMPANY}. By using Thalamus you agree to them.`,
    sections: [
      { h: "Your account", p: [
        "You are responsible for activity under your account and for keeping your sign-in secure. You must be old enough to use the service under your local law, or use it under a school or guardian's supervision.",
      ] },
      { h: "Acceptable use", p: [
        "Use Thalamus lawfully. Do not use it to generate illegal content, to attack or overload the service, to infringe others' rights, or to cheat in a way your institution prohibits. Study mode is a learning tool intended to help you understand and prepare — use it honestly.",
      ] },
      { h: "Credits and payments", p: [
        "Thalamus includes free daily credits (AgentBucks). You may optionally buy additional credit packs. Credits are a prepaid, in-app balance used to access AI features; they have no cash value and are not transferable.",
        "Prices are shown before purchase. See the Refund & Cancellation Policy for details on refunds.",
      ] },
      { h: "AI output", p: [
        "AI-generated answers and code may be inaccurate or incomplete. Verify important information and review generated code before relying on it. You are responsible for how you use the output.",
      ] },
      { h: "Availability and changes", p: [
        "We may update, suspend, or discontinue features. We aim to keep the service running but do not guarantee uninterrupted availability.",
      ] },
      { h: "Liability", p: [
        `To the extent permitted by law, ${COMPANY} is not liable for indirect or consequential damages arising from your use of Thalamus. The service is provided "as is".`,
      ] },
    ],
  },
  refund: {
    title: "Refund & Cancellation Policy",
    metaTitle: "Refund & Cancellation Policy — Thalamus AI",
    description: "How refunds and cancellations work for Thalamus AI credit purchases.",
    intro: "This policy covers optional credit-pack purchases. The core service, including free daily credits, is free to use.",
    sections: [
      { h: "Cancellation", p: [
        "Thalamus credit packs are one-time purchases, not a recurring subscription, so there is nothing to cancel for future billing. You can simply stop buying credits at any time.",
      ] },
      { h: "Refunds", p: [
        `If a purchase failed, was charged twice, or credits were not delivered, email ${SUPPORT_EMAIL} within 7 days with your payment reference and we will investigate and refund verified issues to the original payment method.`,
        "Because credits unlock immediate access to paid AI compute, credits already consumed are generally non-refundable. Unused credits from a mischarge are refundable.",
      ] },
      { h: "How to request a refund", p: [
        `Email ${SUPPORT_EMAIL} with the email on your account, the approximate date and amount, and the payment reference. We respond within a few business days.`,
      ] },
    ],
  },
  contact: {
    title: "Contact",
    metaTitle: "Contact — Thalamus AI Support",
    description: "Get in touch with the Thalamus AI team for support, refunds, partnerships, or data requests.",
    intro: "We're a small team and we read every message.",
    sections: [
      { h: "Support & general enquiries", p: [
        `Email: ${SUPPORT_EMAIL}`,
        "For account or billing issues, include the email on your account and, for payments, your payment reference.",
      ] },
      { h: "Schools & partnerships", p: [
        "If you run a school and want free unlimited study mode for your students, email us and we'll set your institution up.",
      ] },
      { h: "Data requests", p: [
        `To access or delete your data, email ${SUPPORT_EMAIL} from your account email.`,
      ] },
    ],
  },
};

export default function Legal({ doc }: { doc: Doc }) {
  const d = DOCS[doc];
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <title>{d.metaTitle}</title>
      <meta name="description" content={d.description} />
      <link rel="canonical" href={`${SITE}/${doc}`} />

      <header className="border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="h-8 w-8 overflow-hidden rounded-lg border border-white/15 bg-card">
              <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
            </div>
            <span className="text-sm font-bold tracking-[0.22em] text-foreground">THALAMUS</span>
          </Link>
          <Link to="/" className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">{d.title}</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Effective {EFFECTIVE} · {COMPANY}</p>
        <p className="mt-6 text-sm leading-7 text-muted-foreground">{d.intro}</p>

        <div className="mt-10 space-y-8">
          {d.sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-lg font-semibold text-foreground">{s.h}</h2>
              {s.p.map((para, i) => (
                <p key={i} className="mt-3 text-sm leading-7 text-muted-foreground">{para}</p>
              ))}
            </section>
          ))}
        </div>

        <nav className="mt-14 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-xs text-muted-foreground" aria-label="Legal">
          <Link to="/privacy" className="transition-colors hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="transition-colors hover:text-foreground">Terms</Link>
          <Link to="/refund" className="transition-colors hover:text-foreground">Refunds</Link>
          <Link to="/contact" className="transition-colors hover:text-foreground">Contact</Link>
        </nav>
      </main>
    </div>
  );
}
