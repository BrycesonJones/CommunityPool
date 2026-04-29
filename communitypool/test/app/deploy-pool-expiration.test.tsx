import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@/components/wallet-provider", () => ({
  useWallet: () => ({
    walletAddress: null,
    isConnected: false,
    provider: null,
    signer: null,
    chainId: null,
    isWrongNetwork: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchToExpectedNetwork: vi.fn(),
  }),
}));

import DeployPoolModal from "@/app/(app)/pools/deploy-pool-modal";

function advanceToStep3() {
  const nameInput = screen.getByPlaceholderText("CommunityPool");
  fireEvent.change(nameInput, { target: { value: "Test Pool" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

  const fundInput = screen.getByLabelText(/Amount/i);
  fireEvent.change(fundInput, { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
}

describe("DeployPoolModal expiration date validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 19, 12, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sets the datepicker min attribute to tomorrow's local ymd", () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToStep3();

    const dateField = document.querySelector<HTMLInputElement>(
      'input[type="date"]',
    );
    expect(dateField).not.toBeNull();
    expect(dateField!.getAttribute("min")).toBe("2026-04-20");
  });

  it("blocks continuing to Review when today's date is entered", () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToStep3();

    const dateInput = document.querySelector<HTMLInputElement>(
      'input[type="date"]',
    )!;
    fireEvent.change(dateInput, { target: { value: "2026-04-19" } });
    fireEvent.click(screen.getByRole("button", { name: /Review/i }));

    expect(
      screen.getByText(/Pool expiration must be tomorrow or later/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Add additional owners/i }),
    ).toBeInTheDocument();
  });

  it("blocks continuing when a past date is entered manually", () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToStep3();

    const dateInput = document.querySelector<HTMLInputElement>(
      'input[type="date"]',
    )!;
    fireEvent.change(dateInput, { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Review/i }));

    expect(
      screen.getByText(/Pool expiration must be tomorrow or later/i),
    ).toBeInTheDocument();
  });

  it("advances to Review when tomorrow's date is entered", () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToStep3();

    const dateInput = document.querySelector<HTMLInputElement>(
      'input[type="date"]',
    )!;
    fireEvent.change(dateInput, { target: { value: "2026-04-20" } });
    fireEvent.click(screen.getByRole("button", { name: /Review/i }));

    expect(
      screen.getByRole("heading", { name: /Review your pool/i }),
    ).toBeInTheDocument();
  });

  it("clears the error when the user fixes the date after an invalid submit", () => {
    render(<DeployPoolModal open onClose={vi.fn()} />);
    advanceToStep3();

    const dateInput = document.querySelector<HTMLInputElement>(
      'input[type="date"]',
    )!;
    fireEvent.change(dateInput, { target: { value: "2026-04-19" } });
    fireEvent.click(screen.getByRole("button", { name: /Review/i }));
    expect(
      screen.getByText(/Pool expiration must be tomorrow or later/i),
    ).toBeInTheDocument();

    fireEvent.change(dateInput, { target: { value: "2026-04-21" } });
    expect(
      screen.queryByText(/Pool expiration must be tomorrow or later/i),
    ).not.toBeInTheDocument();
  });
});
