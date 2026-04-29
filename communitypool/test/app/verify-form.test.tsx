/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  searchParams: new URLSearchParams("email=sat%40example.com&next=/dashboard"),
  sendEmailOtp: vi.fn(),
  verifyEmailOtp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/auth/email-verification", () => ({
  sendEmailOtp: mocks.sendEmailOtp,
  verifyEmailOtp: mocks.verifyEmailOtp,
}));

import VerifyForm from "@/app/auth/verify/verify-form";

function submitVerifyForm() {
  const submit = screen.getByRole("button", { name: /verify and continue/i });
  const form = submit.closest("form");
  if (!form) throw new Error("verify form element not found");
  fireEvent.submit(form);
}

describe("VerifyForm", () => {
  beforeEach(() => {
    mocks.push.mockClear();
    mocks.refresh.mockClear();
    mocks.sendEmailOtp.mockReset();
    mocks.verifyEmailOtp.mockReset();
    mocks.searchParams = new URLSearchParams(
      "email=sat%40example.com&next=/dashboard",
    );
  });
  afterEach(() => cleanup());

  it("strips non-digits and caps input at 6 digits", () => {
    render(<VerifyForm />);
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12a3 45-6789" } });
    expect(input.value).toBe("123456");
  });

  it("blocks submit when code is shorter than 6 digits", async () => {
    render(<VerifyForm />);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), {
      target: { value: "123" },
    });
    submitVerifyForm();
    await waitFor(() =>
      expect(
        screen.getByText(/6-digit code from your email/i),
      ).toBeInTheDocument(),
    );
    expect(mocks.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it("verifies OTP and pushes to the next path on success", async () => {
    mocks.verifyEmailOtp.mockResolvedValue({ error: null });
    render(<VerifyForm />);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), {
      target: { value: "123456" },
    });
    submitVerifyForm();
    await waitFor(() => expect(mocks.verifyEmailOtp).toHaveBeenCalledTimes(1));
    const [emailArg, tokenArg] = mocks.verifyEmailOtp.mock.calls[0];
    expect(emailArg).toBe("sat@example.com");
    expect(tokenArg).toBe("123456");
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/dashboard"),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows a friendly error on invalid/expired code", async () => {
    mocks.verifyEmailOtp.mockResolvedValue({
      error: { message: "Token has expired" },
    });
    render(<VerifyForm />);
    fireEvent.change(screen.getByLabelText(/6-digit code/i), {
      target: { value: "000000" },
    });
    submitVerifyForm();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /invalid or expired code/i,
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("resend fires sendEmailOtp and enters cooldown", async () => {
    mocks.sendEmailOtp.mockResolvedValue({ error: null });
    render(<VerifyForm />);
    const resendBtn = screen.getByRole("button", { name: /resend code/i });
    fireEvent.click(resendBtn);
    await waitFor(() => expect(mocks.sendEmailOtp).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /resend in/i })).toBeDisabled(),
    );
  });

  it("redirects to login link when email is missing", () => {
    mocks.searchParams = new URLSearchParams("");
    render(<VerifyForm />);
    expect(screen.getByText(/missing email/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to login/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
