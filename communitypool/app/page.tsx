import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { LandingBalanceOrb } from "@/components/landing-balance-orb";
import { LandingTokenOrb } from "@/components/landing-token-orb";
import { chainlinkUsdPerUnit } from "@/lib/onchain/chainlink-spot";

export const revalidate = 60;

const BTC_AMOUNT = 0.1;
const PAXG_AMOUNT = 0.05;
const ETH_AMOUNT = 0.03;

const MAINNET_ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const MAINNET_BTC_USD_FEED = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const MAINNET_PAXG_USD_FEED = "0x9944D86CEB9160aF5C5feB251FD671923323f8C3";

const FALLBACK_TOTAL_USD = 9740;

function getMobilizePhrase(): string {
  const hourET = parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hourCycle: "h23",
    }),
    10,
  );
  if (hourET >= 6 && hourET < 12) return "Mobilize this morning";
  if (hourET >= 12 && hourET < 18) return "Mobilize this afternoon";
  return "Mobilize tonight";
}

async function getLandingTotalUsd(): Promise<number> {
  const rpcUrl = process.env.NEXT_PUBLIC_READ_RPC_URL_1?.trim();
  if (!rpcUrl) return FALLBACK_TOTAL_USD;
  const [btc, paxg, eth] = await Promise.all([
    chainlinkUsdPerUnit(rpcUrl, MAINNET_BTC_USD_FEED),
    chainlinkUsdPerUnit(rpcUrl, MAINNET_PAXG_USD_FEED),
    chainlinkUsdPerUnit(rpcUrl, MAINNET_ETH_USD_FEED),
  ]);
  if (btc == null || paxg == null || eth == null) return FALLBACK_TOTAL_USD;
  return btc * BTC_AMOUNT + paxg * PAXG_AMOUNT + eth * ETH_AMOUNT;
}

export default async function Home() {
  const totalUsd = await getLandingTotalUsd();
  const mobilizePhrase = getMobilizePhrase();
  return (
    <div className="min-h-screen bg-black font-sans">
      {/* Subtle radial gradient for depth */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)] pointer-events-none" aria-hidden />
      <SiteHeader>
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
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black"
          >
            Get Started
          </Link>
        </nav>
      </SiteHeader>
      <div className="relative max-w-6xl mx-auto px-4 pt-16 pb-6 sm:pt-24 sm:pb-10">
        <main>
          {/* Hero section */}
          <section className="mb-24 sm:mb-32 max-w-3xl mx-auto text-center">
            <h1
              style={{
                fontFamily: "var(--font-instrument-serif)",
                backgroundImage:
                  "linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.5))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
              className="text-[4rem] md:text-[6rem] tracking-[-0.01em] leading-[1] pb-3 mb-6"
            >
              Digital treasuries for every community
            </h1>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto mb-8 leading-relaxed">
              Deploy and fund smart contract pools with Tokenized Gold and ETH
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-6 py-3 text-base font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black"
              >
                Deploy a Pool
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center px-6 py-3 text-base font-medium text-zinc-300 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black rounded-full"
              >
                Documentation
              </Link>
            </div>
            <div className="mt-16 flex justify-center">
              <LandingBalanceOrb totalUsd={totalUsd} />
            </div>
          </section>

          {/* How it works */}
          <section className="mb-24 sm:mb-32" aria-labelledby="how-it-works-heading">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16 items-center">
              <div className="relative rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
                <div
                  className="rounded-[calc(1.5rem-2px)] bg-zinc-950 p-6 sm:p-8"
                  aria-hidden
                >
                  <h3 className="text-base font-semibold text-white mb-6">
                    How much do you want to fund?
                  </h3>
                  <p className="text-xs text-zinc-500 mb-1">Assets this pool will accept</p>
                  <p className="text-sm text-zinc-300 mb-6">ETH, PAXG, XAU₮</p>
                  <p className="text-xs text-zinc-500 mb-3">Fund with</p>
                  <div className="flex flex-wrap gap-2 mb-6">
                    <span className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white ring-1 ring-blue-500">
                      ETH
                    </span>
                    <span className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300">
                      PAXG
                    </span>
                    <span className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300">
                      XAU₮
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">Amount (human dollars, USD)</p>
                  <div className="rounded-md border border-blue-500 bg-zinc-950 px-3 py-2.5 text-sm text-white">
                    50
                  </div>
                </div>
              </div>
              <div>
                <h2
                  id="how-it-works-heading"
                  style={{
                    fontFamily:
                      "var(--font-geist-sans), Inter, 'Helvetica Neue', Arial, sans-serif",
                    fontWeight: 500,
                    letterSpacing: "-0.04em",
                    lineHeight: 0.95,
                    backgroundImage:
                      "linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.5))",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                  className="text-4xl sm:text-5xl pb-3 mb-8"
                >
                  {mobilizePhrase}
                </h2>
                <ol className="divide-y divide-zinc-800">
                  <li className="flex gap-5 py-6 first:pt-0">
                    <span className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 text-sm font-semibold">
                      1
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-2">Create your account</h3>
                      <p className="text-zinc-400 text-sm leading-relaxed">
                        Sign up and verify your email to get started.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-5 py-6">
                    <span className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 text-sm font-semibold">
                      2
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-2">Add addresses & connect wallet</h3>
                      <p className="text-zinc-400 text-sm leading-relaxed">
                        Track BTC, ETH, and PAXG. Connect MetaMask, Coinbase Wallet, or Binance Wallet when you’re ready to deploy or fund pools.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-5 py-6 last:pb-0">
                    <span className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 text-sm font-semibold">
                      3
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-2">Deploy a community pool</h3>
                      <p className="text-zinc-400 text-sm leading-relaxed">
                        Invite owners, fund projects, and manage withdrawals on-chain.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </section>

          {/* Near instantaneous global pooling */}
          <section className="mb-24 sm:mb-32" aria-labelledby="global-pooling-heading">
            <div className="max-w-2xl mb-10">
              <h2
                id="global-pooling-heading"
                style={{
                  fontFamily:
                    "var(--font-geist-sans), Inter, 'Helvetica Neue', Arial, sans-serif",
                  fontWeight: 500,
                  letterSpacing: "-0.04em",
                  lineHeight: 0.95,
                  backgroundImage:
                    "linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.5))",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
                className="text-4xl sm:text-5xl pb-3 mb-6"
              >
                Near-instantaneous
                <br />
                global pooling
              </h2>
              <p className="text-zinc-400 text-base leading-relaxed">
                Every deposit and withdrawal settles on Ethereum in seconds.
                Contributors from anywhere in the world can pool together — no
                bank wires, no ACH delays, no currency conversion.
              </p>
            </div>
            <div className="relative rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)] scale-[1.15]">
              <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/pool-transactions.png"
                  alt="Etherscan showing a Fund transaction 19 seconds ago on a CommunityPool contract"
                  className="w-full h-auto rounded-[calc(1.5rem-2px)]"
                />
              </div>
            </div>
          </section>

          {/* Feature summary section */}
          <section className="mb-24 sm:mb-32" aria-labelledby="features-heading">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3 lg:gap-16">
              <div className="lg:col-span-1">
                <h2
                  id="features-heading"
                  style={{
                    fontFamily: "var(--font-geist-sans), Inter, 'Helvetica Neue', Arial, sans-serif",
                    fontWeight: 500,
                    letterSpacing: "-0.04em",
                    lineHeight: 0.95,
                    backgroundImage:
                      "linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.5))",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                  className="text-4xl sm:text-5xl pb-3"
                >
                  Help humans, not
                  <br />
                  central banks
                </h2>
              </div>
              <div className="lg:col-span-2">
                <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Portfolio Tracking</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Watch-only BTC, ETH, and PAXG across up to 50 addresses.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Community Pools</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Deploy Ethereum pools and fund with ETH, PAXG, or XAU₮.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Non-Custodial</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Your wallet signs every deploy, fund, and withdraw — we never hold keys.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Live Prices</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Live USD values sourced directly from Chainlink oracles.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Multi-Owner Pools</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Invite co-owners to jointly deploy and manage pool withdrawals.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">On-Chain History</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Every deposit and withdrawal recorded on Ethereum — fully auditable.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">KYC Verified</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Verified identity before your first deploy keeps pools compliant.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Gold Exposure</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Fund with tokenized physical gold via PAXG or Tether Gold.
                    </p>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Mainnet & Testnet</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                      Ship to Ethereum mainnet or practice on Sepolia — same UI.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Supported tokens */}
          <section className="mb-24 sm:mb-32" aria-labelledby="tokens-heading">
            <h2
              id="tokens-heading"
              style={{
                fontFamily:
                  "var(--font-geist-sans), Inter, 'Helvetica Neue', Arial, sans-serif",
                fontWeight: 500,
                letterSpacing: "-0.04em",
                lineHeight: 0.95,
                backgroundImage:
                  "linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.5))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
              className="text-4xl sm:text-5xl pb-3 text-center mb-12"
            >
              Sound money, on-chain
            </h2>
            <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 place-items-center">
              <LandingTokenOrb
                logoSrc="https://assets.coingecko.com/coins/images/279/standard/ethereum.png"
                logoAlt="Ethereum logo"
                name="Ethereum"
                ticker="ETH"
              />
              <LandingTokenOrb
                logoSrc="/paxos.png"
                logoAlt="Pax Gold logo"
                name="Pax Gold"
                ticker="PAXG"
                cardDelay={0.1}
              />
              <LandingTokenOrb
                logoSrc="https://assets.coingecko.com/coins/images/10481/standard/logo.png"
                logoAlt="Tether Gold logo"
                name="Tether Gold"
                ticker="XAU₮"
                cardDelay={0.2}
              />
            </div>
          </section>

          {/* Pool funds held in smart contracts on-chain */}
          <section className="mb-24 sm:mb-32" aria-labelledby="smart-contracts-heading">
            <div className="max-w-2xl mb-10">
              <h2
                id="smart-contracts-heading"
                style={{
                  fontFamily:
                    "var(--font-geist-sans), Inter, 'Helvetica Neue', Arial, sans-serif",
                  fontWeight: 500,
                  letterSpacing: "-0.04em",
                  lineHeight: 0.95,
                  backgroundImage:
                    "linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.5))",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
                className="text-4xl sm:text-5xl pb-3 mb-6"
              >
                Pool funds held in
                <br />
                smart contracts on-chain
              </h2>
              <p className="text-zinc-400 text-base leading-relaxed">
                Every pool is its own smart contract on Ethereum. Balances are
                held in code and visible on-chain — not locked in a company&apos;s
                ledger.
              </p>
            </div>
            <div className="max-w-xl mx-auto space-y-4">
              <div className="relative rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
                <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/pool-contract.png"
                    alt="CommunityPool smart contract address on Etherscan"
                    className="w-full h-auto rounded-[calc(1.5rem-2px)]"
                  />
                </div>
              </div>
              <div className="relative rounded-3xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
                <div className="rounded-[calc(1.5rem-2px)] bg-zinc-950 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/pool-balance.png"
                    alt="Etherscan Overview showing a CommunityPool smart contract ETH balance held on-chain"
                    className="w-full h-auto rounded-[calc(1.5rem-2px)]"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Call to action */}
          <section className="mb-24 sm:mb-32" aria-labelledby="cta-heading">
            <div className="flex flex-col items-center text-center">
              <div className="mb-10 rounded-2xl p-[2px] bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 shadow-[0_0_40px_rgba(59,130,246,0.25)]">
                <div className="h-24 w-24 overflow-hidden rounded-[calc(1rem-2px)] bg-zinc-950 sm:h-28 sm:w-28">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/logo.png"
                    alt="CommunityPool logo"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              <h2
                id="cta-heading"
                style={{
                  fontFamily:
                    "var(--font-geist-sans), Inter, 'Helvetica Neue', Arial, sans-serif",
                  fontWeight: 500,
                  letterSpacing: "-0.04em",
                  lineHeight: 0.95,
                  backgroundImage:
                    "linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.5))",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
                className="text-5xl sm:text-6xl pb-3 mb-6"
              >
                Build Community,
                <br />
                Globally
              </h2>
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 px-8 py-3.5 text-base font-medium text-white shadow-lg shadow-blue-500/30 hover:from-blue-300 hover:via-blue-400 hover:to-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-black"
              >
                Try CommunityPool
              </Link>
            </div>
          </section>

          {/* FAQ */}
          <section className="mb-24 sm:mb-32" aria-labelledby="faq-heading">
            <h2
              id="faq-heading"
              style={{
                fontFamily:
                  "var(--font-geist-sans), Inter, 'Helvetica Neue', Arial, sans-serif",
                fontWeight: 500,
                letterSpacing: "-0.04em",
                lineHeight: 0.95,
                backgroundImage:
                  "linear-gradient(to bottom right, #fff 30%, rgba(255,255,255,0.5))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
              className="text-4xl sm:text-5xl pb-3 text-center mb-12"
            >
              Before you deploy
            </h2>
            <div className="max-w-3xl mx-auto space-y-4">
              <details className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 open:border-zinc-700 transition-colors">
                <summary className="flex items-center justify-between cursor-pointer p-6 list-none [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base font-medium text-white">What is CommunityPool?</h3>
                  <span aria-hidden className="shrink-0 text-2xl text-zinc-400 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-6 text-sm text-zinc-400 leading-relaxed">
                  CommunityPool is a non-custodial platform for deploying and funding Ethereum-based community pools with ETH, PAXG (Pax Gold), and XAU₮ (Tether Gold).
                </div>
              </details>
              <details className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 open:border-zinc-700 transition-colors">
                <summary className="flex items-center justify-between cursor-pointer p-6 list-none [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base font-medium text-white">How do I deploy a pool?</h3>
                  <span aria-hidden className="shrink-0 text-2xl text-zinc-400 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-6 text-sm text-zinc-400 leading-relaxed">
                  Sign up, verify your email, complete KYC, and connect a browser wallet (MetaMask, Coinbase Wallet, or Binance Wallet). You can then deploy a pool directly from the Pools dashboard.
                </div>
              </details>
              <details className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 open:border-zinc-700 transition-colors">
                <summary className="flex items-center justify-between cursor-pointer p-6 list-none [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base font-medium text-white">What tokens can I fund a pool with?</h3>
                  <span aria-hidden className="shrink-0 text-2xl text-zinc-400 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-6 text-sm text-zinc-400 leading-relaxed">
                  ETH, PAXG (Pax Gold), and XAU₮ (Tether Gold) on Ethereum mainnet. Sepolia testnet is also supported for practice deployments.
                </div>
              </details>
              <details className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 open:border-zinc-700 transition-colors">
                <summary className="flex items-center justify-between cursor-pointer p-6 list-none [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base font-medium text-white">Is CommunityPool custodial?</h3>
                  <span aria-hidden className="shrink-0 text-2xl text-zinc-400 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-6 text-sm text-zinc-400 leading-relaxed">
                  No. Every deploy, fund, and withdraw is signed by your browser wallet. We never hold your private keys or your funds.
                </div>
              </details>
              <details className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 open:border-zinc-700 transition-colors">
                <summary className="flex items-center justify-between cursor-pointer p-6 list-none [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base font-medium text-white">Why do I need KYC?</h3>
                  <span aria-hidden className="shrink-0 text-2xl text-zinc-400 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-6 text-sm text-zinc-400 leading-relaxed">
                  KYC is required for your first pool deployment or within 2 hours of signup. You’ll provide full name, date of birth, address, phone, and a government-issued ID when prompted.
                </div>
              </details>
              <details className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 open:border-zinc-700 transition-colors">
                <summary className="flex items-center justify-between cursor-pointer p-6 list-none [&::-webkit-details-marker]:hidden">
                  <h3 className="text-base font-medium text-white">How are withdrawals managed?</h3>
                  <span aria-hidden className="shrink-0 text-2xl text-zinc-400 transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <div className="px-6 pb-6 text-sm text-zinc-400 leading-relaxed">
                  Pools support multi-owner withdrawals. Invite co-owners to jointly manage funds, with every approval and transfer recorded on-chain for full transparency.
                </div>
              </details>
            </div>
          </section>

          {/* KYC teaser */}
          <section className="mb-16" aria-labelledby="kyc-teaser-heading">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 px-6 py-4">
              <h2 id="kyc-teaser-heading" className="sr-only">Compliance</h2>
              <p className="text-sm text-zinc-500">
                KYC is required for your first pool deployment or within 2 hours of signup. You’ll need to provide full name, DOB, address, phone, and ID when prompted.
              </p>
            </div>
          </section>

          {/* Footer */}
          <footer className="border-t border-zinc-800 pt-12 pb-8">
            <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-white">CommunityPool</p>
              </div>
              <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:gap-10">
              <div>
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Resources</h3>
                <ul className="space-y-3">
                  <li><Link href="#faq-heading" className="text-sm text-zinc-400 hover:text-white transition-colors">FAQ</Link></li>
                  <li><Link href="/docs" className="text-sm text-zinc-400 hover:text-white transition-colors">Docs</Link></li>
                  <li><Link href="/status" className="text-sm text-zinc-400 hover:text-white transition-colors">Status</Link></li>
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Legal</h3>
                <ul className="space-y-3">
                  <li><Link href="/terms" className="text-sm text-zinc-400 hover:text-white transition-colors">Terms of Service</Link></li>
                  <li><Link href="/privacy" className="text-sm text-zinc-400 hover:text-white transition-colors">Privacy Policy</Link></li>
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Social</h3>
                <ul className="space-y-3">
                  <li>
                    <a
                      href="https://x.com/brycesonjx"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-zinc-400 hover:text-white transition-colors"
                    >
                      X
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.instagram.com/bryceson.simulacra/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-zinc-400 hover:text-white transition-colors"
                    >
                      Instagram
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.linkedin.com/in/brycesonjones/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-zinc-400 hover:text-white transition-colors"
                    >
                      LinkedIn
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.youtube.com/@SystemsofSimulacra"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-zinc-400 hover:text-white transition-colors"
                    >
                      YouTube
                    </a>
                  </li>
                </ul>
              </div>
            </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
