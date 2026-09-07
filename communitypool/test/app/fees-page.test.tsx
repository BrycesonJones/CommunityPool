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
    expect(screen.getByText(/no monthly subscription fee/i)).toBeInTheDocument();
    expect(screen.getByText(/Unlimited CommunityPool deployments/i)).toBeInTheDocument();
  });

  it("states the live protocol fee, its direction, and the on-chain ceiling", () => {
    render(<FeesPage />);
    const text = document.body.textContent ?? "";
    // The launch rate and the hard cap are both stated.
    expect(text).toMatch(/launch protocol fee/i);
    expect(text).toMatch(/1%/);
    expect(text).toMatch(/3%/);
    // The rate is not asserted as permanent: it is stated as the launch rate, shown live before
    // funding, and changeable on-chain under the immutable ceiling.
    expect(text).toMatch(/current rate is always shown before you confirm|current rate is shown before/i);
    expect(text).toMatch(/change the protocol fee within the hardcoded 0%–3% range/i);
    expect(text).toMatch(/immutable maximum protocol fee: 3%/i);
    // Deducted from the contribution, never added on top.
    expect(text).toMatch(/out of.{0,40}amount you fund|deducted from the contribution/i);
    expect(text).toMatch(/never added on top|not added on top/i);
    // The old "not yet enabled" framing must not survive activation.
    expect(text).not.toMatch(/transitioning to a protocol-fee model/i);
    expect(text).not.toMatch(/once enabled/i);
    expect(text).not.toMatch(/may be charged/i);
  });

  it("separates what the admin can and cannot do", () => {
    render(<FeesPage />);
    expect(
      screen.getByRole("heading", { level: 2, name: /admin authority/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /^admin can$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /^admin cannot$/i })).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    // Allowed.
    expect(text).toMatch(/change the protocol treasury address/i);
    // Prohibited — every item the contracts prevent.
    expect(text).toMatch(/withdraw assets from communitypools/i);
    expect(text).toMatch(/move or transfer user pool assets/i);
    expect(text).toMatch(/change communitypool ownership/i);
    expect(text).toMatch(/access users.{0,3} wallets/i);
    expect(text).toMatch(/override communitypool withdrawal rules/i);
    expect(text).toMatch(/arbitrarily take assets deposited into a pool/i);
    // Allowed and prohibited are visually distinguishable, not just textually.
    expect(screen.getAllByLabelText("Allowed").length).toBe(2);
    expect(screen.getAllByLabelText("Not permitted").length).toBe(6);
  });

  it("describes wallet roles and the protocol structure", () => {
    render(<FeesPage />);
    expect(screen.getByRole("heading", { level: 2, name: /wallet roles/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: /normal user wallet/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /admin wallet/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /protocol structure/i }),
    ).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/deploy communitypools/i);
    expect(text).toMatch(/withdraw assets according to the rules of the individual pool/i);
    expect(text).toMatch(/does\s*not\s*have privileged access to assets held by communitypools/i);
    // The diagram is rendered as text, not an image, and stays scrollable on narrow screens.
    const diagram = screen.getByLabelText(/diagram/i);
    expect(diagram.tagName).toBe("PRE");
    expect(diagram.textContent).toContain("ADMIN WALLET");
    expect(diagram.textContent).toContain("COMMUNITYPOOL PROTOCOL");
    expect(diagram.textContent).toContain("TREASURY WALLET");
    expect(diagram.textContent).toContain("User deposit → CommunityPool");
    expect(diagram.textContent).toContain("Protocol fee → Treasury");
    expect(diagram.parentElement?.className).toContain("overflow-x-auto");
    expect(document.querySelector("img")).toBeNull();
  });

  it("states the core security property and the V1 carve-out", () => {
    render(<FeesPage />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(
      /admin can modify protocol pricing, but has no privileged ability to access assets deposited into communitypools/i,
    );
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
    // "treasury" and "admin wallet" are user-facing role names the page explains on purpose;
    // internal contract naming and units still must not leak.
    expect(text).not.toMatch(/ProtocolConfig|feeRecipient|\bbps\b|getProtocolFeeConfig/i);
  });

  it("uses Fees (not Pricing) in the document title and nav", () => {
    render(<FeesPage />);
    expect(String(metadata.title)).toMatch(/^Fees/);
    expect(String(metadata.description)).toMatch(/launch protocol fee/i);
    expect(String(metadata.description)).toMatch(/may be changed on-chain/i);
    expect(String(metadata.description)).toMatch(/3% maximum/i);
    expect(screen.getByRole("link", { name: "Fees" })).toHaveAttribute("href", "/fees");
    expect(screen.queryByRole("link", { name: /pricing/i })).not.toBeInTheDocument();
  });

});

/**
 * Responsive contract.
 *
 * These assert the layout rules the page depends on at narrow widths rather than a rendered
 * appearance — jsdom does not lay out CSS, and no headless browser runs in this suite. The
 * diagram is the one fixed-width element: at text-xs its widest line is ~310px, just over the
 * ~303px of content a 375px viewport leaves, so its scroll container is load-bearing.
 */
describe("Fees page layout at narrow widths", () => {
  it("stacks the two-column sections on small screens", () => {
    render(<FeesPage />);
    const grids = Array.from(document.querySelectorAll("[class*='grid']"));
    expect(grids.length).toBeGreaterThanOrEqual(3);
    for (const grid of grids) {
      // Single column by default, two only from the `sm` breakpoint up.
      expect(grid.className).toMatch(/sm:grid-cols-2/);
      expect(grid.className).not.toMatch(/(^|\s)grid-cols-2(\s|$)/);
    }
  });

  it("keeps the fixed-width diagram scrollable instead of stretching the page", () => {
    render(<FeesPage />);
    const diagram = screen.getByLabelText(/diagram/i);
    expect(diagram.parentElement?.className).toContain("overflow-x-auto");
    expect(diagram.className).toMatch(/text-xs/);
    expect(diagram.className).toMatch(/sm:text-sm/);
    const widest = Math.max(...(diagram.textContent ?? "").split("\n").map((l) => l.length));
    expect(widest).toBeLessThanOrEqual(48);
  });

  it("constrains the page to a readable measure with side padding", () => {
    render(<FeesPage />);
    const main = document.querySelector("main");
    expect(main?.className).toContain("max-w-3xl");
    expect(main?.className).toContain("px-4");
  });

  it("keeps the dark theme, blue accents and site navigation", () => {
    render(<FeesPage />);
    expect(document.querySelector("div.min-h-screen")?.className).toContain("bg-black");
    expect(document.body.innerHTML).toMatch(/text-blue-400|from-blue-400/);
    expect(screen.getByRole("link", { name: "Fees" })).toHaveAttribute("href", "/fees");
    expect(screen.getByRole("link", { name: /login/i })).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: /get started/i }).length).toBeGreaterThanOrEqual(1);
  });
});
