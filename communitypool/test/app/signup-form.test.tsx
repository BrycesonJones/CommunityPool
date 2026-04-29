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
  sendEmailOtp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/auth/email-verification", () => ({
  sendEmailOtp: mocks.sendEmailOtp,
}));

vi.mock("@/components/google-auth-button", () => ({
  default: () => <button type="button">Sign up with Google</button>,
}));

import SignupForm from "@/app/(auth)/signup/signup-form";

function submitSignupForm() {
  const submit = screen.getByRole("button", { name: /send verification code/i });
  const form = submit.closest("form");
  if (!form) throw new Error("signup form element not found");
  fireEvent.submit(form);
}

describe("SignupForm (email OTP)", () => {
  beforeEach(() => {
    mocks.push.mockClear();
    mocks.refresh.mockClear();
    mocks.sendEmailOtp.mockReset();
  });
  afterEach(() => cleanup());

  it("requires both username and a valid email", async () => {
    render(<SignupForm />);
    submitSignupForm();
    await waitFor(() =>
      expect(screen.getByText(/username is required/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    expect(mocks.sendEmailOtp).not.toHaveBeenCalled();
  });

  it("sends OTP with username metadata and routes to /auth/verify", async () => {
    mocks.sendEmailOtp.mockResolvedValue({ error: null });
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "satoshi" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "sat@example.com" },
    });
    submitSignupForm();

    await waitFor(() => expect(mocks.sendEmailOtp).toHaveBeenCalledTimes(1));
    const [emailArg, metadataArg] = mocks.sendEmailOtp.mock.calls[0];
    expect(emailArg).toBe("sat@example.com");
    expect(metadataArg).toEqual({ username: "satoshi" });

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        expect.stringContaining("/auth/verify?email=sat%40example.com"),
      ),
    );
  });
});
