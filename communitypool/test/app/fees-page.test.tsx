/**
 * Fees page (replacement for the subscription-era Pricing page).
 *
 * Asserts the page renders as a plain informational page and that none of
 * the retired monetization surfaces — $20/month, Free/Pro cards, upgrade or
 * subscription-management CTAs — come back. Since Phase 2.8 the protocol fee is LIVE, so the
 * copy must state the real rate, that it is deducted from the contribution rather than added on
 * top, the on-chain 3% ceiling, and the limits of the administrator's authority.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FeesPage, { metadata } from "@/app/fees/page";

afterEach(() => cleanup());

describe("Fees page", () => {
  it("renders the Fees heading and the free-to-use statement", () => {
    render(<FeesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Fees" })).toBeInTheDocument();
    expect(
      screen.getByText(/CommunityPool is free to sign up for and use\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no monthly subscription fees/i)).toBeInTheDocument();
    expect(screen.getByText(/Unlimited CommunityPool deployments/i)).toBeInTheDocument();
  });

  it("states the live protocol fee, its direction, and the on-chain ceiling", () => {
    render(<FeesPage />);
    const text = document.body.textContent ?? "";
    // The launch rate and the hard cap are both stated.
    expect(text).toMatch(/1%/);
    expect(text).toMatch(/3%/);
    // Deducted from the contribution, never added on top.
    expect(text).toMatch(/out of.{0,40}amount you fund|deducted from the contribution/i);
    expect(text).toMatch(/never added on top|not added on top/i);
    // The old "not yet enabled" framing must not survive activation.
    expect(text).not.toMatch(/transitioning to a protocol-fee model/i);
    expect(text).not.toMatch(/once enabled/i);
    expect(text).not.toMatch(/may be charged/i);
  });

  it("states the limits of protocol-admin authority and the V1 carve-out", () => {
    render(<FeesPage />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/cannot withdraw or move assets/i);
    expect(text).toMatch(/cannot change who owns a pool/i);
    expect(text).toMatch(/cannot bypass/i);
    // Pools created before activation keep their original no-fee behaviour.
    expect(text).toMatch(/before the protocol fee went live/i);
  });

  it("contains no subscription-era pricing content", () => {
    render(<FeesPage />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\$20/);
    expect(text).not.toMatch(/\$160/);
    expect(text).not.toMatch(/\/\s?month/i);
    expect(text).not.toMatch(/per month/i);
    expect(text).not.toMatch(/free plan/i);
    expect(text).not.toMatch(/pro plan/i);
    expect(text).not.toMatch(/\bpro\b/i);
    expect(text).not.toMatch(/upgrade/i);
    expect(text).not.toMatch(/manage subscription/i);
    expect(text).not.toMatch(/2 pools|two pools/i);
    expect(screen.queryByRole("button", { name: /subscribe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /subscribe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /upgrade/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/pricing"], a[href^="/billing"]')).toBeNull();
  });

  it("does not expose internal implementation details", () => {
    render(<FeesPage />);
    const text = document.body.textContent ?? "";
    // No wallet / contract addresses on the public fee explainer.
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
    // "protocol treasury" is user-facing language for where the fee goes; internal contract and
    // wallet naming still must not leak.
    expect(text).not.toMatch(/admin wallet|ProtocolConfig|feeRecipient|bps/i);
  });

  it("uses Fees (not Pricing) in the document title and nav", () => {
    render(<FeesPage />);
    expect(String(metadata.title)).toMatch(/^Fees/);
    expect(screen.getByRole("link", { name: "Fees" })).toHaveAttribute("href", "/fees");
    expect(screen.queryByRole("link", { name: /pricing/i })).not.toBeInTheDocument();
  });
});
