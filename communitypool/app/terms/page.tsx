import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Terms of Service | CommunityPool",
  description:
    "The terms governing your use of CommunityPool — a non-custodial platform for deploying and managing community-owned smart-contract pools.",
};

const LAST_UPDATED = "April 22, 2026";
const LEGAL_ENTITY = "CommunityPool"; // TODO: replace with the legal entity name once formed.
const CONTACT_EMAIL = "legal@communitypool.app"; // TODO: replace with operating contact email.
const GOVERNING_JURISDICTION = "the State of Delaware, United States"; // TODO: confirm with counsel.
const ARBITRATION_VENUE = "Wilmington, Delaware";

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            Last updated: {LAST_UPDATED}
          </p>
        </header>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 mb-10">
          <p className="text-sm text-amber-200">
            <strong className="font-semibold">Important — please read carefully.</strong>{" "}
            CommunityPool is a non-custodial smart-contract interface. We never
            hold your private keys or your funds. Transactions on public
            blockchains are final and irreversible. Section 13 contains a
            binding arbitration agreement and a class-action waiver.
          </p>
        </div>

        <nav aria-label="Table of contents" className="mb-12 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
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
          <Section
            id="acceptance"
            number={1}
            title="Acceptance of these Terms"
          >
            <P>
              These Terms of Service (the &ldquo;<B>Terms</B>&rdquo;) form a
              legally binding agreement between you (&ldquo;<B>you</B>&rdquo;
              or &ldquo;<B>User</B>&rdquo;) and {LEGAL_ENTITY} (&ldquo;
              <B>CommunityPool</B>,&rdquo; &ldquo;<B>we</B>,&rdquo; &ldquo;
              <B>us</B>,&rdquo; or &ldquo;<B>our</B>&rdquo;) governing your
              access to and use of the CommunityPool website, smart contracts,
              dashboard, APIs, and related services (collectively, the
              &ldquo;<B>Service</B>&rdquo;).
            </P>
            <P>
              By creating an account, connecting a wallet, deploying a pool, or
              otherwise using the Service, you agree to be bound by these
              Terms and our Privacy Policy. If you do not agree, do not use
              the Service.
            </P>
          </Section>

          <Section id="definitions" number={2} title="Definitions">
            <Ul>
              <Li>
                <B>Pool</B> means a smart-contract escrow deployed through the
                Service that accepts deposits in supported assets, supports
                multi-owner administration, and enforces an on-chain expiration.
              </Li>
              <Li>
                <B>Deployer</B> means the User who initiates the deployment of
                a Pool and whose address is recorded as the deployer on chain.
              </Li>
              <Li>
                <B>Owner</B> means an address granted co-management rights to a
                Pool by the Deployer.
              </Li>
              <Li>
                <B>Wallet</B> means any self-custodied browser or mobile wallet
                you use to interact with the Service, including but not limited
                to MetaMask, Coinbase Wallet, and Binance Wallet.
              </Li>
              <Li>
                <B>Supported Asset</B> means an asset the Service is configured
                to accept at the time of your transaction, currently ETH, PAXG,
                and XAU₮ on Ethereum mainnet and Sepolia testnet. The list of
                Supported Assets and networks may change without notice.
              </Li>
              <Li>
                <B>KYC</B> means the identity-verification process described in
                Section 5.
              </Li>
            </Ul>
          </Section>

          <Section id="eligibility" number={3} title="Eligibility">
            <P>To use the Service, you represent and warrant that:</P>
            <Ul>
              <Li>You are at least 18 years old and have full legal capacity to enter into these Terms;</Li>
              <Li>
                You are not located in, organized under the laws of, or
                ordinarily resident in any country or territory subject to
                comprehensive U.S., U.N., U.K., or E.U. sanctions, and you are
                not a person identified on any government-maintained sanctions
                or denied-persons list;
              </Li>
              <Li>
                Your use of the Service is not prohibited by, and complies
                with, all laws and regulations applicable to you, including
                tax, securities, anti-money-laundering, and consumer-protection
                laws of your jurisdiction;
              </Li>
              <Li>
                You will not use the Service on behalf of any third party
                unless you have obtained the authorizations and disclosures
                required by applicable law.
              </Li>
            </Ul>
            <P>
              We may refuse, suspend, or terminate access to the Service from
              any jurisdiction or individual at our sole discretion.
            </P>
          </Section>

          <Section id="account" number={4} title="Account registration and security">
            <P>
              To access certain features you must register an account using a
              valid email address. The Service is passwordless: we authenticate
              you with one-time codes sent to your email, or with Google
              sign-in. You are responsible for maintaining the security of the
              email account and any third-party identity provider used to sign
              in, and for all activity under your account. Notify us promptly at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand-300 hover:text-brand-200"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              of any unauthorized access.
            </P>
            <P>
              You are solely responsible for the security of any Wallet you
              connect to the Service, including the safekeeping of seed
              phrases, private keys, and any device on which they are stored.
              We cannot recover lost keys, reverse signed transactions, or
              restore access to a Wallet you no longer control.
            </P>
          </Section>

          <Section id="kyc" number={5} title="Identity verification (KYC)">
            <P>
              Before deploying a Pool — and in any event no later than two (2)
              hours after creating an account — you must complete identity
              verification. KYC requires you to provide accurate information
              including your full legal name, date of birth, residential
              address, phone number, and a valid government-issued
              identification document.
            </P>
            <P>
              You authorize us and our verification providers to collect, use,
              store, and verify the information you submit, and to share it
              with regulators, payment partners, or law-enforcement agencies as
              required by law. We may refuse to onboard you, or suspend or
              terminate your account, if we cannot verify your identity or if
              we reasonably believe the information you provided is inaccurate
              or incomplete.
            </P>
          </Section>

          <Section id="non-custodial" number={6} title="Non-custodial nature of the Service">
            <P>
              <B>The Service is non-custodial.</B> CommunityPool does not at
              any time take possession, control, or custody of your private
              keys or the assets in your Wallet or in any Pool. All deployments,
              deposits, withdrawals, and administrative actions are executed by
              smart contracts on a public blockchain pursuant to transactions
              you sign with your own Wallet.
            </P>
            <P>
              We do not act as a broker, dealer, exchange, money transmitter,
              money-services business, custodian, fiduciary, or financial
              institution with respect to your assets. We do not provide
              investment, tax, legal, or accounting advice. You are solely
              responsible for evaluating the risks of any transaction.
            </P>
          </Section>

          <Section id="services" number={7} title="The Service">
            <P>The Service currently includes:</P>
            <Ul>
              <Li>
                <B>Pool deployment.</B> Deploying multi-owner escrow contracts
                with configurable expiration dates and minimum-contribution
                thresholds enforced via on-chain price oracles.
              </Li>
              <Li>
                <B>Pool administration.</B> Inviting co-Owners, funding
                deployed Pools with Supported Assets, and withdrawing funds in
                accordance with the rules encoded in the underlying smart
                contract.
              </Li>
              <Li>
                <B>Portfolio tracking.</B> Read-only monitoring of balances
                across Bitcoin, Ethereum, and supported ERC-20 tokens for
                addresses you specify.
              </Li>
              <Li>
                <B>Activity dashboard.</B> A historical view of your Pool
                activity reconstructed from public on-chain data and
                Service-side records.
              </Li>
              <Li>
                <B>API access.</B> Programmatic access to certain features for
                Users on the applicable paid tier.
              </Li>
            </Ul>
            <P>
              We may add, modify, suspend, or discontinue any feature, network,
              or Supported Asset at any time, with or without notice. We do not
              guarantee that the Service will be uninterrupted, error-free, or
              available in any particular jurisdiction.
            </P>
          </Section>

          <Section id="pool-mechanics" number={8} title="Pool mechanics and finality">
            <P>
              Each Pool is governed by the smart-contract code at the address
              recorded on chain at the time of deployment. The behavior of a
              Pool — including who can withdraw, when withdrawals are
              permitted, how the expiration date is enforced, and how funds
              are released after expiration — is determined by that code, not
              by any representation made on the Service&rsquo;s interface.
            </P>
            <P>
              Once a Pool expires, withdrawal authority is restricted as
              defined by the smart contract; in the standard configuration,
              only the Deployer may release expired funds back to the
              Deployer&rsquo;s address. Co-Owners do not retain a unilateral
              right to withdraw their contributions before or after expiration
              except as expressly provided by the contract.
            </P>
            <P>
              <B>Transactions are final.</B> Once a transaction is broadcast
              and confirmed on chain, it cannot be reversed, cancelled, or
              refunded by us. You bear the risk of incorrect addresses,
              incorrect amounts, mistakenly invited Owners, premature pool
              expiration, and any other input you provide.
            </P>
          </Section>

          <Section id="blockchain-risks" number={9} title="Blockchain and protocol risks">
            <P>
              You acknowledge and accept the following risks, among others:
            </P>
            <Ul>
              <Li>
                <B>Smart-contract risk.</B> Smart contracts can contain bugs,
                vulnerabilities, or economic exploits. Audits, if performed,
                reduce but do not eliminate this risk.
              </Li>
              <Li>
                <B>Network risk.</B> Public blockchains may experience
                congestion, forks, reorganizations, MEV-related ordering, or
                outright outages. Gas fees fluctuate and are paid by you to
                network validators, not to us.
              </Li>
              <Li>
                <B>Oracle risk.</B> Pool minimums and certain price-dependent
                features rely on third-party price oracles, including
                Chainlink. We make no warranty as to the accuracy, timeliness,
                or availability of any oracle.
              </Li>
              <Li>
                <B>Asset risk.</B> Supported Assets, including PAXG and XAU₮,
                depend on the solvency, custody practices, and continued
                operation of their respective issuers. The redemption and
                backing of tokenized assets is governed by their issuers, not
                by us.
              </Li>
              <Li>
                <B>Regulatory risk.</B> The regulatory treatment of
                cryptocurrencies and tokenized assets is uncertain and
                evolving. New laws or interpretations may affect your ability
                to use the Service or hold the assets you deposit.
              </Li>
              <Li>
                <B>Testnet risk.</B> Sepolia and other testnet assets have no
                monetary value. We make no representation that testnet
                deployments behave identically to mainnet deployments.
              </Li>
            </Ul>
          </Section>

          <Section id="fees" number={10} title="Fees and payment">
            <P>
              The Service offers a Free tier and a Pro tier currently priced at
              $20 per month, billed in advance. Tier features and pricing are
              described on our pricing page and may change with notice.
              Subscription fees are non-refundable except where required by
              applicable law.
            </P>
            <P>
              On-chain transactions require gas, which is paid by you in the
              network&rsquo;s native asset and is not collected by, retained
              by, or refundable from us. We may, at our discretion, charge
              additional protocol fees that are disclosed in the interface
              before you sign the relevant transaction.
            </P>
          </Section>

          <Section id="api" number={11} title="API access and acceptable use">
            <P>
              If you are issued API keys, you must keep them confidential, use
              them only for your own account, and revoke them promptly upon
              suspected compromise. We may rate-limit, throttle, or revoke API
              access at any time.
            </P>
            <P>You agree not to:</P>
            <Ul>
              <Li>Use the Service to violate any law or regulation, or to facilitate any unlawful activity, including money laundering, terrorist financing, fraud, market manipulation, or sanctions evasion;</Li>
              <Li>Access or use the Service through automated means in a manner that imposes an unreasonable load on our infrastructure;</Li>
              <Li>Reverse engineer, decompile, scrape at scale, or otherwise attempt to extract source code or non-public data from the Service, except to the extent expressly permitted by law;</Li>
              <Li>Interfere with, disrupt, or attempt to gain unauthorized access to the Service, any User account, or any Wallet that is not yours;</Li>
              <Li>Misrepresent your identity, impersonate another person, or use the Service to harass, threaten, or defraud any person;</Li>
              <Li>Deploy, fund, or administer a Pool on behalf of any sanctioned person or sanctioned jurisdiction.</Li>
            </Ul>
          </Section>

          <Section id="ip" number={12} title="Intellectual property">
            <P>
              The Service, including its source code, smart contracts (except
              where released under an open-source license), interface designs,
              trademarks, logos, and content, is owned by us or our licensors
              and is protected by intellectual-property laws. Subject to your
              compliance with these Terms, we grant you a limited, revocable,
              non-exclusive, non-transferable license to access and use the
              Service for its intended purpose. No other rights are granted by
              implication, estoppel, or otherwise.
            </P>
          </Section>

          <Section id="disclaimers" number={13} title="Disclaimers">
            <P className="uppercase tracking-wide text-zinc-400 text-sm">
              The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
              available&rdquo; basis. To the maximum extent permitted by
              applicable law, {LEGAL_ENTITY} disclaims all warranties, express
              or implied, including warranties of merchantability, fitness for
              a particular purpose, non-infringement, and any warranty arising
              out of course of dealing or usage of trade.
            </P>
            <P>
              We make no warranty that (a) the Service will meet your
              requirements; (b) the Service will be uninterrupted, secure, or
              error-free; (c) any smart contract is free of bugs or economic
              exploits; (d) any third-party oracle, wallet, network, or
              infrastructure provider will function as expected; or (e) any
              information presented in the interface — including balances,
              prices, or activity history — is accurate, complete, or current.
            </P>
            <P>
              <B>Nothing in the Service constitutes investment, tax, legal,
              accounting, or financial advice.</B> You are solely responsible
              for evaluating whether any transaction is suitable for you in
              light of your circumstances and applicable law.
            </P>
          </Section>

          <Section id="liability" number={14} title="Limitation of liability">
            <P className="uppercase tracking-wide text-zinc-400 text-sm">
              To the maximum extent permitted by applicable law, in no event
              will {LEGAL_ENTITY}, its affiliates, or its or their officers,
              directors, employees, agents, or licensors be liable for any
              indirect, incidental, special, consequential, exemplary, or
              punitive damages, or for any loss of profits, revenue, data, use,
              goodwill, or other intangible losses, arising out of or relating
              to these Terms or the Service.
            </P>
            <P>
              Without limiting the foregoing, we will not be liable for losses
              arising from: (a) your use of, or inability to use, the Service;
              (b) any transaction signed by you or on your behalf; (c) any bug
              or vulnerability in any smart contract, oracle, wallet, or
              underlying blockchain; (d) any unauthorized access to your
              account or Wallet; (e) any conduct or content of any third
              party; or (f) any change, suspension, or discontinuation of the
              Service or any feature.
            </P>
            <P>
              Our aggregate liability for any claim arising out of or relating
              to these Terms or the Service will not exceed the greater of
              (i) the amount you paid us in subscription fees during the twelve
              (12) months immediately preceding the event giving rise to the
              claim and (ii) U.S. $100.
            </P>
          </Section>

          <Section id="indemnification" number={15} title="Indemnification">
            <P>
              You agree to indemnify, defend, and hold harmless {LEGAL_ENTITY}{" "}
              and our affiliates and their respective officers, directors,
              employees, and agents from and against any and all claims,
              liabilities, damages, losses, and expenses (including reasonable
              attorneys&rsquo; fees) arising out of or in any way connected
              with (a) your access to or use of the Service; (b) your
              violation of these Terms; (c) your violation of any third-party
              right, including any intellectual-property or privacy right; or
              (d) any transaction you initiate, sign, or authorize through the
              Service.
            </P>
          </Section>

          <Section id="dispute-resolution" number={16} title="Dispute resolution; arbitration; class-action waiver">
            <P>
              <B>Please read this section carefully — it affects your legal rights.</B>
            </P>
            <P>
              Any dispute, claim, or controversy arising out of or relating to
              these Terms or the Service (a &ldquo;<B>Dispute</B>&rdquo;) will
              be resolved by binding individual arbitration administered by the
              American Arbitration Association under its Consumer Arbitration
              Rules. The arbitration will be conducted in {ARBITRATION_VENUE},
              in the English language, before a single arbitrator. Judgment on
              the award may be entered in any court of competent jurisdiction.
            </P>
            <P>
              <B>Class-action waiver.</B> You and we each waive any right to
              bring or participate in any class, collective, consolidated, or
              representative action. The arbitrator may not consolidate
              claims, and may not preside over any form of representative
              proceeding.
            </P>
            <P>
              You may opt out of this arbitration agreement by sending written
              notice to{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand-300 hover:text-brand-200"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              within thirty (30) days of first accepting these Terms. Notice
              must include your name, account email, and a clear statement
              that you are opting out.
            </P>
            <P>
              Notwithstanding the foregoing, either party may bring an
              individual action in small-claims court for any dispute within
              its jurisdiction, and either party may seek injunctive or
              equitable relief in a court of competent jurisdiction to protect
              its intellectual property or confidential information.
            </P>
          </Section>

          <Section id="governing-law" number={17} title="Governing law">
            <P>
              These Terms and any Dispute will be governed by the laws of{" "}
              {GOVERNING_JURISDICTION}, without regard to its conflict-of-laws
              principles. Subject to Section 16, the state and federal courts
              located in {ARBITRATION_VENUE} will have exclusive jurisdiction
              over any matter not subject to arbitration.
            </P>
          </Section>

          <Section id="termination" number={18} title="Suspension and termination">
            <P>
              We may suspend or terminate your access to the Service at any
              time, with or without notice, including if we believe you have
              violated these Terms, if required by law, or if we discontinue
              the Service. You may stop using the Service at any time. Upon
              termination, the provisions of these Terms that by their nature
              should survive — including Sections 6 (Non-custodial), 12
              (Intellectual property) through 17 (Governing law), and this
              Section 18 — will survive.
            </P>
            <P>
              Termination of your account does not affect any Pool already
              deployed on chain. Smart contracts continue to operate
              independently of your account status.
            </P>
          </Section>

          <Section id="modifications" number={19} title="Changes to these Terms">
            <P>
              We may update these Terms from time to time. The &ldquo;Last
              updated&rdquo; date at the top of this page reflects the most
              recent revision. For material changes, we will provide reasonable
              advance notice (for example, by email or through an in-app
              notice). Your continued use of the Service after the changes
              take effect constitutes acceptance of the revised Terms.
            </P>
          </Section>

          <Section id="general" number={20} title="General">
            <P>
              <B>Entire agreement.</B> These Terms, together with the Privacy
              Policy and any policies or notices we publish on the Service,
              constitute the entire agreement between you and us regarding the
              Service and supersede any prior agreements.
            </P>
            <P>
              <B>Severability.</B> If any provision of these Terms is held to
              be invalid or unenforceable, the remaining provisions will
              remain in full force and effect, and the invalid provision will
              be reformed to the minimum extent necessary to make it
              enforceable.
            </P>
            <P>
              <B>No waiver.</B> Our failure to enforce any provision is not a
              waiver of our right to do so later.
            </P>
            <P>
              <B>Assignment.</B> You may not assign these Terms without our
              prior written consent. We may assign these Terms at any time.
            </P>
            <P>
              <B>Force majeure.</B> We are not liable for any failure or delay
              caused by events beyond our reasonable control, including
              network failures, blockchain outages, regulatory action, acts of
              God, war, civil unrest, or labor disputes.
            </P>
          </Section>

          <Section id="contact" number={21} title="Contact us">
            <P>
              Questions about these Terms can be sent to{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-brand-300 hover:text-brand-200"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </P>
          </Section>
        </article>

        <p className="mt-16 text-xs text-zinc-500">
          By using the Service, you acknowledge that you have read, understood,
          and agree to be bound by these Terms.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}

const SECTIONS: { id: string; title: string }[] = [
  { id: "acceptance", title: "Acceptance of these Terms" },
  { id: "definitions", title: "Definitions" },
  { id: "eligibility", title: "Eligibility" },
  { id: "account", title: "Account registration and security" },
  { id: "kyc", title: "Identity verification (KYC)" },
  { id: "non-custodial", title: "Non-custodial nature of the Service" },
  { id: "services", title: "The Service" },
  { id: "pool-mechanics", title: "Pool mechanics and finality" },
  { id: "blockchain-risks", title: "Blockchain and protocol risks" },
  { id: "fees", title: "Fees and payment" },
  { id: "api", title: "API access and acceptable use" },
  { id: "ip", title: "Intellectual property" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limitation of liability" },
  { id: "indemnification", title: "Indemnification" },
  { id: "dispute-resolution", title: "Dispute resolution; arbitration; class-action waiver" },
  { id: "governing-law", title: "Governing law" },
  { id: "termination", title: "Suspension and termination" },
  { id: "modifications", title: "Changes to these Terms" },
  { id: "general", title: "General" },
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
