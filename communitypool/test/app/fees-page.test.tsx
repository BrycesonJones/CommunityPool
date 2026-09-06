/**
 * Fees page (replacement for the subscription-era Pricing page).
 *
 * Asserts the page renders as a plain informational page and that none of
 * the retired monetization surfaces — $20/month, Free/Pro cards, upgrade or
 * subscription-management CTAs — come back. Also pins the copy that keeps
 * the page honest while Phase 2 is unshipped: the protocol fee is described
 * as transitional, not as live.
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

  it("describes the protocol fee as transitional, not live", () => {
    render(<FeesPage />);
    expect(
      screen.getByText(/transitioning to a protocol-fee model/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/will be displayed before transactions once enabled/i),
    ).toBeInTheDocument();
    // No concrete percentage is promised while Phase 2 is unshipped.
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)?\s?%/);
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
    expect(text).not.toMatch(/treasury|admin wallet|ProtocolConfig/i);
  });

  it("uses Fees (not Pricing) in the document title and nav", () => {
    render(<FeesPage />);
    expect(String(metadata.title)).toMatch(/^Fees/);
    expect(screen.getByRole("link", { name: "Fees" })).toHaveAttribute("href", "/fees");
    expect(screen.queryByRole("link", { name: /pricing/i })).not.toBeInTheDocument();
  });
});
