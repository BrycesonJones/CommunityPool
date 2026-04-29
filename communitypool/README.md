This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## CommunityPool (Foundry)

Solidity sources live under `src/` and `script/`. Run tests and sync the frontend artifact after changing the contract:

```bash
cd communitypool
forge build
forge test
npm run contracts:sync-artifact
```

Deploy with Foundry (set `SEPOLIA_RPC_URL` to your Alchemy URL and use a funded deployer key):

```bash
forge script script/DeployCommunityPool.s.sol:DeployCommunityPool --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Optional env for `fund` / `withdraw` scripts that use [foundry-devops](https://github.com/Cyfrin/foundry-devops) (`broadcast/` must contain a prior `CommunityPool` deployment):

```bash
forge script script/Interactions.s.sol:FundCommunityPool --rpc-url "$SEPOLIA_RPC_URL" --broadcast
forge script script/Interactions.s.sol:WithdrawCommunityPool --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Frontend: for local Anvil, set `NEXT_PUBLIC_LOCAL_ETH_USD_FEED` to your mock ETH/USD aggregator. On Sepolia, optional WBTC-style pools use `NEXT_PUBLIC_SEPOLIA_WBTC_TOKEN`, `NEXT_PUBLIC_SEPOLIA_WBTC_USD_FEED`, and `NEXT_PUBLIC_SEPOLIA_WBTC_DECIMALS`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
