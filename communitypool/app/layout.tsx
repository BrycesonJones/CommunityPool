import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { PoolActivityProvider } from "@/components/pool-activity-provider";
import { PostHogProvider } from "@/components/posthog-provider";
import { WalletProvider } from "@/components/wallet-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "CommunityPool",
  description:
    "Non-custodial portfolio tracking and community funding pools on Ethereum.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        <PostHogProvider>
          <WalletProvider>
            <PoolActivityProvider>{children}</PoolActivityProvider>
          </WalletProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
