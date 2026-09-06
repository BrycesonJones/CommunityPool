/**
 * CommunityPool V2 CANDIDATE artifact support.
 *
 * NOT USED BY PRODUCTION. Production deploys from the frozen V1 artifact via
 * `deployCommunityPool` in ./community-pool.ts. This module exists so a later,
 * explicit activation phase can wire V2 in with the right types once a real
 * ProtocolConfig deployment exists on the target chain. It deliberately
 * exports no deploy helper and no config address: there is no placeholder
 * ProtocolConfig, and `address(0)` is rejected by the contract itself.
 *
 * Guarded by test/security/contract-artifact-boundary.test.ts and
 * scripts/check-frozen-v1-artifact.mjs.
 */

import communityPoolV2Candidate from "./community-pool-v2-candidate-artifact.json";
import protocolConfigCandidate from "./protocol-config-candidate-artifact.json";

export const COMMUNITY_POOL_V2_CANDIDATE_ARTIFACT = communityPoolV2Candidate;
export const PROTOCOL_CONFIG_CANDIDATE_ARTIFACT = protocolConfigCandidate;

/** Constructor arguments of the V2 candidate, in ABI order. */
export type CommunityPoolV2ConstructorArgs = {
  name: string;
  description: string;
  /** 18-decimal fixed-point USD minimum. */
  minimumUsd: bigint;
  coOwners: string[];
  /** Unix seconds. */
  expiresAt: bigint;
  ethUsdFeed: string;
  tokenConfigs: Array<{ token: string; usdFeed: string; decimals: number }>;
  /** Address of the chain's official ProtocolConfig deployment. Must have code. */
  protocolConfig: string;
};

/** Live protocol fee parameters as returned by V2 `getProtocolFeeConfig()`. */
export type ProtocolFeeConfig = {
  /** Basis points; 10_000 == 100%. Bounded on-chain to <= 300. */
  feeBps: bigint;
  recipient: string;
};

export const PROTOCOL_BPS_DENOMINATOR = 10_000n;
export const PROTOCOL_MAX_FEE_BPS = 300n;

/**
 * V2 funding-event semantics (Phase 2.3–2.4). `grossAmount === feeAmount + netAmount`;
 * `feeRecipient` is the zero address when `feeAmount === 0n`.
 *   Funded(address indexed funder, address indexed feeRecipient, uint256 grossAmount, uint256 feeAmount, uint256 netAmount)
 *   FundedERC20(address indexed token, address indexed funder, address indexed feeRecipient, uint256 grossAmount, uint256 feeAmount, uint256 netAmount)
 */
export type FundedV2Event = {
  funder: string;
  feeRecipient: string;
  grossAmount: bigint;
  feeAmount: bigint;
  netAmount: bigint;
};
export type FundedERC20V2Event = FundedV2Event & { token: string };

/** Mirrors the contract: floor(gross * bps / 10_000); never rounds up. */
export function protocolFeeFor(grossAmount: bigint, feeBps: bigint): { feeAmount: bigint; netAmount: bigint } {
  if (feeBps > PROTOCOL_MAX_FEE_BPS) throw new Error("protocol fee exceeds the 300 bps cap");
  const feeAmount = (grossAmount * feeBps) / PROTOCOL_BPS_DENOMINATOR;
  return { feeAmount, netAmount: grossAmount - feeAmount };
}
