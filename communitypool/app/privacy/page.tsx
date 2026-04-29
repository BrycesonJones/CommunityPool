import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy Policy | CommunityPool",
  description:
    "How CommunityPool collects, uses, shares, and protects your personal information.",
};

const LAST_UPDATED = "April 22, 2026";
const LEGAL_ENTITY = "CommunityPool"; // TODO: replace with the legal entity name once formed.
const CONTACT_EMAIL = "privacy@communitypool.app"; // TODO: replace with operating contact email.
const COMPANY_ADDRESS = "[Company mailing address]"; // TODO: add postal address for privacy notices.
const KYC_VENDOR = "our identity-verification provider"; // TODO: name the KYC vendor (e.g., Persona, Onfido, Stripe Identity).
const PAYMENT_PROCESSOR = "our payment processor"; // TODO: name the payment processor (e.g., Stripe).
const ANALYTICS_VENDOR = "our product-analytics provider"; // TODO: name the analytics vendor or remove if none.

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black font-sans flex flex-col">
      <div
        className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.08),transparent)] pointer-events-none"
        aria-hidden
      />
      <SiteHeader brandHref="/">
        <nav className="flex items-center gap-4">
          <Link
            href="/pricing"
            className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black rounded px-3 py-2"
          >
            Login
          </Link>
        </nav>
      </SiteHeader>

      <main className="relative flex-1 mx-auto w-full max-w-3xl px-4 py-12">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-300">
            Legal
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 mb-10">
          <p className="text-sm text-amber-200">
            <strong className="font-semibold">A note on blockchain data.</strong>{" "}
            Public blockchains are public. Any wallet address, deposit,
            withdrawal, or pool deployment associated with you is recorded on
            chain and is visible to anyone with a block explorer. We cannot
            erase, alter, or anonymize on-chain data — including data
            voluntarily linked to your account through your use of the Service.
          </p>
        </div>

        <nav
          aria-label="Table of contents"
          className="mb-12 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white">
            Contents
          </h2>
          <ol className="mt-3 grid grid-cols-1 gap-y-1 text-sm text-zinc-400 sm:grid-cols-2">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="hover:text-white transition-colors"
                >
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="space-y-12 text-zinc-300">
          <Section id="introduction" number={1} title="Introduction and scope">
            <P>
              This Privacy Policy describes how {LEGAL_ENTITY} (&ldquo;
              <B>CommunityPool</B>,&rdquo; &ldquo;<B>we</B>,&rdquo; &ldquo;
              <B>us</B>,&rdquo; or &ldquo;<B>our</B>&rdquo;) collects, uses,
              shares, retains, and protects personal information when you
              access or use the CommunityPool website, dashboard, smart-contract
              interface, APIs, and related services (collectively, the
              &ldquo;<B>Service</B>&rdquo;).
            </P>
            <P>
              This Policy is incorporated into and forms part of our{" "}
              <Link href="/terms" className="text-brand-300 hover:text-brand-200">
                Terms of Service
              </Link>
              . Capitalized terms not defined here have the meanings given in
              the Terms.
            </P>
            <P>
              The Service is non-custodial: we do not hold your private keys
              or your funds. We do, however, collect personal information
              required to provide the Service, verify your identity, comply
              with law, and protect against fraud and abuse.
            </P>
          </Section>

          <Section id="information-we-collect" number={2} title="Information we collect">
            <P>We collect the following categories of information.</P>

            <h3 className="mt-6 text-base font-semibold text-white">
              (a) Information you provide directly
            </h3>
            <Ul>
              <Li>
                <B>Account information</B> — email address, username, and any
                profile fields you choose to add (display name, address, phone
                number). The Service is passwordless: we authenticate you with
                email one-time codes or Google sign-in. We do not collect or
                store passwords.
              </Li>
              <Li>
                <B>Identity-verification (KYC) information</B> — full legal
                name, date of birth, residential address, phone number, and
                images of a government-issued identification document. KYC
                information may include sensitive personal information as
                defined under applicable privacy law.
              </Li>
              <Li>
                <B>Wallet information</B> — public wallet addresses you connect
                to or designate within the Service. We do not collect or store
                private keys or seed phrases.
              </Li>
              <Li>
                <B>Pool-related information</B> — pool addresses, pool
                configuration parameters, co-Owner addresses, and metadata you
                attach to a Pool.
              </Li>
              <Li>
                <B>Communications</B> — messages, support requests, feedback,
                and any other content you submit to us.
              </Li>
            </Ul>

            <h3 className="mt-6 text-base font-semibold text-white">
              (b) Information collected automatically
            </h3>
            <Ul>
              <Li>
                <B>Device and connection information</B> — IP address, browser
                type and version, operating system, device identifiers,
                referring URL, language preference, and approximate location
                derived from IP.
              </Li>
              <Li>
                <B>Usage information</B> — pages and features accessed, time
                stamps, session duration, error logs, and interaction events.
              </Li>
              <Li>
                <B>Cookies and similar technologies</B> — see Section 6.
              </Li>
            </Ul>

            <h3 className="mt-6 text-base font-semibold text-white">
              (c) Information from third parties
            </h3>
            <Ul>
              <Li>
                <B>Identity-verification providers</B> — verification results,
                risk scores, and metadata returned by {KYC_VENDOR} when you
                complete KYC.
              </Li>
              <Li>
                <B>Payment processor</B> — for paid subscriptions, we receive
                billing status, last four digits of card, expiration date, and
                similar information from {PAYMENT_PROCESSOR}. We do not
                receive or store full payment-card numbers.
              </Li>
              <Li>
                <B>Public blockchain data</B> — balances, transactions, and
                contract interactions associated with addresses you connect to
                or that we display in your portfolio.
              </Li>
              <Li>
                <B>Fraud and compliance providers</B> — sanctions screening,
                wallet-risk scoring, and similar signals from third-party
                providers.
              </Li>
            </Ul>
          </Section>

          <Section id="how-we-use" number={3} title="How we use your information">
            <P>We use the information described above to:</P>
            <Ul>
              <Li>Provide, maintain, and improve the Service, including authenticating sessions, presenting your portfolio, and recording your Pool activity;</Li>
              <Li>Verify your identity and meet our regulatory and contractual obligations, including KYC, sanctions screening, and recordkeeping;</Li>
              <Li>Process subscription payments and manage your account on the applicable tier;</Li>
              <Li>Detect, investigate, and prevent fraud, security incidents, prohibited activity, and violations of our Terms;</Li>
              <Li>Communicate with you about the Service, including service announcements, security notices, support responses, and — where you have consented or where permitted — marketing messages;</Li>
              <Li>Generate aggregated or de-identified analytics that do not identify you;</Li>
              <Li>Comply with applicable law, lawful requests from regulators or law-enforcement agencies, court orders, and our legal rights and obligations.</Li>
            </Ul>
            <P>
              For users in the European Economic Area, the United Kingdom, or
              other jurisdictions with similar law, the legal bases on which we
              rely include performance of a contract (providing the Service),
              compliance with a legal obligation (KYC, sanctions, tax),
              legitimate interests (security, fraud prevention, product
              improvement), and consent (marketing, certain cookies). You may
              withdraw consent at any time without affecting the lawfulness of
              prior processing.
            </P>
          </Section>

          <Section id="how-we-share" number={4} title="How we share your information">
            <P>
              We do not sell your personal information. We share personal
              information only as described below.
            </P>
            <Ul>
              <Li>
                <B>Service providers and processors.</B> Hosting, database,
                authentication, identity verification, payments, customer
                support, email delivery, analytics, and security vendors that
                process personal information on our behalf under contract,
                including but not limited to {KYC_VENDOR}, {PAYMENT_PROCESSOR},
                Supabase (authentication and database), our hosting provider,
                and {ANALYTICS_VENDOR}.
              </Li>
              <Li>
                <B>Legal and compliance.</B> Regulators, courts, law-enforcement
                agencies, and other governmental authorities when required by
                law, in response to a lawful request, or to protect our or
                others&rsquo; rights, property, or safety.
              </Li>
              <Li>
                <B>Corporate transactions.</B> A successor entity in the event
                of a merger, acquisition, financing, reorganization, sale of
                assets, or insolvency. We will require any such successor to
                honor the commitments in this Policy.
              </Li>
              <Li>
                <B>With your direction.</B> When you direct us to share
                information — for example, by inviting a co-Owner to a Pool or
                publishing a portfolio link.
              </Li>
              <Li>
                <B>Aggregated or de-identified information.</B> Information
                that does not reasonably identify you, used for research,
                analytics, marketing, or product development.
              </Li>
            </Ul>
            <P>
              We do not share personal information with third parties for their
              own marketing purposes without your consent.
            </P>
          </Section>

          <Section id="onchain-disclosure" number={5} title="On-chain data and public information">
            <P>
              When you deploy a Pool, fund a Pool, or sign any other
              transaction through the Service, the resulting transaction is
              broadcast to a public blockchain. The wallet address you used,
              the contract address, the asset and amount, the time of the
              transaction, and the link between funder and recipient are
              recorded permanently and publicly. Anyone with internet access
              and a block explorer can view this information.
            </P>
            <P>
              Linking a wallet address to your account, your name, or other
              identifying information you provide to us increases the
              likelihood that on-chain activity associated with that address
              can be attributed to you by third parties — including chain
              analytics firms, regulators, and the public. You should consider
              this before connecting an address that you wish to keep private.
            </P>
          </Section>

          <Section id="cookies" number={6} title="Cookies and similar technologies">
            <P>
              We and our service providers use cookies, local storage, and
              similar technologies to operate the Service, remember your
              preferences, maintain your session, prevent fraud, and measure
              performance. Some of these technologies are strictly necessary
              and cannot be disabled without breaking the Service. Others are
              optional and you may control them through your browser settings
              or any cookie-preferences interface we provide.
            </P>
            <P>
              We do not currently respond to browser &ldquo;Do Not Track&rdquo;
              signals because there is no industry consensus on how to
              interpret them. Where required by law, we will honor recognized
              opt-out preference signals such as Global Privacy Control.
            </P>
          </Section>

          <Section id="retention" number={7} title="Data retention">
            <P>
              We retain personal information for as long as we need it to
              provide the Service, comply with our legal and regulatory
              obligations, resolve disputes, and enforce our agreements.
              Specifically:
            </P>
            <Ul>
              <Li>
                <B>Account information</B> is retained while your account is
                active and for a reasonable period after closure to allow for
                reactivation, dispute resolution, and audit;
              </Li>
              <Li>
                <B>KYC information</B> is retained for the period required by
                applicable anti-money-laundering and recordkeeping laws,
                typically at least five (5) years from the closure of your
                account or the date of the relevant transaction;
              </Li>
              <Li>
                <B>Transaction and activity records</B> are retained for
                accounting, tax, and audit purposes for the period required by
                law;
              </Li>
              <Li>
                <B>Logs and security data</B> are retained for the period
                necessary to investigate and respond to incidents.
              </Li>
            </Ul>
            <P>
              On-chain data is permanent and outside our control; closing your
              account does not erase any data already recorded on a public
              blockchain.
            </P>
          </Section>

          <Section id="security" number={8} title="Data security">
            <P>
              We implement administrative, technical, and physical safeguards
              designed to protect personal information from unauthorized access,
              disclosure, alteration, and destruction. These include encryption
              in transit, access controls, authentication requirements,
              hardware-backed credential storage where available, monitoring,
              and vendor diligence.
            </P>
            <P>
              No system is perfectly secure. You are responsible for keeping
              your account credentials, recovery factors, Wallet seed phrases,
              and devices secure, and for notifying us promptly at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand-300 hover:text-brand-200"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              of any suspected unauthorized access.
            </P>
          </Section>

          <Section id="international-transfers" number={9} title="International data transfers">
            <P>
              We are based in the United States and may process personal
              information in the United States and in any country where our
              service providers operate. If you access the Service from outside
              the United States, your information may be transferred to,
              stored, and processed in jurisdictions whose data-protection
              laws may differ from those of your country.
            </P>
            <P>
              Where required by law, we use appropriate safeguards for
              international transfers, such as the European Commission&rsquo;s
              Standard Contractual Clauses or equivalent mechanisms.
            </P>
          </Section>

          <Section id="your-rights" number={10} title="Your privacy rights">
            <P>
              Depending on where you live, you may have rights with respect to
              your personal information. Subject to verification of your
              identity and to limits set by law, these may include the right
              to:
            </P>
            <Ul>
              <Li>Access the personal information we hold about you and obtain a copy in a portable format;</Li>
              <Li>Correct inaccurate or incomplete information;</Li>
              <Li>Delete personal information, subject to our retention obligations and other legal exceptions;</Li>
              <Li>Restrict or object to certain processing, including processing based on legitimate interests;</Li>
              <Li>Withdraw consent where processing is based on consent;</Li>
              <Li>Opt out of the &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; of personal information, and limit the use of sensitive personal information, where those concepts apply;</Li>
              <Li>Lodge a complaint with a supervisory authority in your jurisdiction;</Li>
              <Li>Be free from discrimination for exercising these rights.</Li>
            </Ul>
            <P>
              To exercise any of these rights, contact us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand-300 hover:text-brand-200"
              >
                {CONTACT_EMAIL}
              </a>
              . We may need to verify your identity before responding. You may
              also use an authorized agent to submit a request on your behalf,
              subject to applicable law. We will respond within the time
              required by law.
            </P>
            <P>
              <B>California residents:</B> the categories of personal
              information described in Section 2 correspond to the CCPA
              categories of identifiers, customer records, characteristics of
              protected classifications, commercial information, internet or
              network activity, geolocation data, professional information (in
              limited cases), and inferences. We disclose personal information
              for the business purposes described in Sections 3 and 4. We do
              not sell personal information and do not knowingly share personal
              information for cross-context behavioral advertising.
            </P>
          </Section>

          <Section id="children" number={11} title="Children's privacy">
            <P>
              The Service is not directed to, and we do not knowingly collect
              personal information from, individuals under the age of 18. If
              you believe a minor has provided us with personal information,
              contact us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand-300 hover:text-brand-200"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              and we will take appropriate steps to delete it.
            </P>
          </Section>

          <Section id="third-parties" number={12} title="Third-party services and links">
            <P>
              The Service integrates with and links to third-party services,
              including self-custodied wallets (such as MetaMask, Coinbase
              Wallet, and Binance Wallet), public blockchains, price oracles
              (including Chainlink), block explorers, KYC providers, and
              payment processors. We are not responsible for the privacy
              practices of those services. Their handling of your information
              is governed by their own privacy policies, and you should review
              them.
            </P>
          </Section>

          <Section id="changes" number={13} title="Changes to this Policy">
            <P>
              We may update this Policy from time to time. The &ldquo;Last
              updated&rdquo; date at the top reflects the most recent
              revision. For material changes, we will provide reasonable
              advance notice (for example, by email or through an in-app
              notice). Your continued use of the Service after the changes
              take effect constitutes acceptance of the revised Policy.
            </P>
          </Section>

          <Section id="contact" number={14} title="Contact us">
            <P>
              For privacy questions, requests, or complaints, contact us at:
            </P>
            <P>
              <B>Email:</B>{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand-300 hover:text-brand-200"
              >
                {CONTACT_EMAIL}
              </a>
              <br />
              <B>Mail:</B> {LEGAL_ENTITY}, {COMPANY_ADDRESS}
            </P>
            <P>
              If you are located in the European Economic Area or the United
              Kingdom and we are unable to resolve your concern, you may lodge
              a complaint with your local supervisory authority.
            </P>
          </Section>
        </article>

        <p className="mt-16 text-xs text-zinc-500">
          This Policy applies in addition to any product- or feature-specific
          notices we provide at the point of collection.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}

const SECTIONS: { id: string; title: string }[] = [
  { id: "introduction", title: "Introduction and scope" },
  { id: "information-we-collect", title: "Information we collect" },
  { id: "how-we-use", title: "How we use your information" },
  { id: "how-we-share", title: "How we share your information" },
  { id: "onchain-disclosure", title: "On-chain data and public information" },
  { id: "cookies", title: "Cookies and similar technologies" },
  { id: "retention", title: "Data retention" },
  { id: "security", title: "Data security" },
  { id: "international-transfers", title: "International data transfers" },
  { id: "your-rights", title: "Your privacy rights" },
  { id: "children", title: "Children's privacy" },
  { id: "third-parties", title: "Third-party services and links" },
  { id: "changes", title: "Changes to this Policy" },
  { id: "contact", title: "Contact us" },
];

function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
        {number}. {title}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function P({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={className}>{children}</p>;
}

function Ul({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc space-y-2 pl-6 marker:text-zinc-600">
      {children}
    </ul>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-white">{children}</strong>;
}
