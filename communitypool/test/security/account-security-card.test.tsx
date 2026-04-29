/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountSecurityCard } from "@/app/(app)/account/account-security-card";

afterEach(() => cleanup());

describe("AccountSecurityCard (passwordless v1)", () => {
  it("does not render a role=switch / 2FA toggle", () => {
    render(<AccountSecurityCard />);
    // The previous version rendered a role="switch" labelled "Enable 2FA"
    // that only flipped local React state. A07 fix: remove it entirely.
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/^enable 2fa$/i)).toBeNull();
  });

  it("communicates honestly that MFA is not yet enrolled", () => {
    render(<AccountSecurityCard />);
    expect(
      screen.getByText(/two-factor authentication is coming soon/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /email one-time codes or google sign-in. we never use passwords/i,
      ),
    ).toBeInTheDocument();
  });
});
