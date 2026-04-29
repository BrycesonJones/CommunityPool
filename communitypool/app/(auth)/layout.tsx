import { GlobalWalletBar } from "@/components/global-wallet-bar";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <GlobalWalletBar />
      {children}
    </>
  );
}
