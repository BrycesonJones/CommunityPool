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
  default: () => <button type="button">Sign in with Google</button>,
}));

import LoginForm from "@/app/(auth)/login/login-form";

function submitLoginForm() {
  const submit = screen.getByRole("button", { name: /continue with email/i });
  const form = submit.closest("form");
  if (!form) throw new Error("login form element not found");
  fireEvent.submit(form);
}

describe("LoginForm (email OTP)", () => {
  beforeEach(() => {
    mocks.push.mockClear();
    mocks.refresh.mockClear();
    mocks.sendEmailOtp.mockReset();
  });
  afterEach(() => cleanup());

  it("renders the Google OAuth button alongside the email flow", () => {
    render(<LoginForm />);
    expect(
      screen.getByRole("button", { name: /continue with email/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in with google/i }),
    ).toBeInTheDocument();
  });

  it("rejects invalid email without calling Supabase", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "not-an-email" },
    });
    submitLoginForm();
    await waitFor(() =>
      expect(screen.getByText(/valid email address/i)).toBeInTheDocument(),
    );
    expect(mocks.sendEmailOtp).not.toHaveBeenCalled();
  });

  it("sends OTP and routes to /auth/verify on success", async () => {
    mocks.sendEmailOtp.mockResolvedValue({ error: null });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "sat@example.com" },
    });
    submitLoginForm();
    await waitFor(() => expect(mocks.sendEmailOtp).toHaveBeenCalledTimes(1));

    const [emailArg] = mocks.sendEmailOtp.mock.calls[0];
    expect(emailArg).toBe("sat@example.com");

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\/auth\/verify\?email=sat%40example\.com&next=%2Fdashboard$/,
        ),
      ),
    );
  });

  it("shows Supabase error when send fails", async () => {
    mocks.sendEmailOtp.mockResolvedValue({
      error: { message: "rate limit exceeded" },
    });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "sat@example.com" },
    });
    submitLoginForm();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /rate limit exceeded/i,
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
