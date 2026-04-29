"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  sendEmailOtp,
  verifyEmailOtp,
} from "@/lib/auth/email-verification";
import { safeNextPath } from "@/lib/auth/safe-next-path";

const RESEND_COOLDOWN_SECONDS = 30;

function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

export default function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const nextPath = safeNextPath(searchParams.get("next"));

  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  if (!email) {
    return (
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/90 px-8 py-10 shadow-xl text-center">
        <h1 className="text-2xl font-bold text-white mb-3">
          Missing email
        </h1>
        <p className="text-sm text-zinc-400 mb-6">
          We couldn&apos;t find the email you&apos;re verifying. Start again
          from the login page.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-500 transition-colors"
        >
          Go to login
        </Link>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void (async () => {
      setInfo(null);
      const token = sanitizeCode(code);
      if (token.length !== 6) {
        setErrors({ code: "Enter the 6-digit code from your email." });
        return;
      }
      setSubmitting(true);
      setErrors({});

      const { error } = await verifyEmailOtp(email, token);

      if (error) {
        setSubmitting(false);
        setErrors({
          form: "Invalid or expired code. Please request a new code.",
        });
        return;
      }

      setSubmitting(false);
      router.push(nextPath);
      router.refresh();
    })();
  }

  function handleResend() {
    void (async () => {
      if (cooldown > 0 || resending) return;
      setErrors({});
      setInfo(null);
      setResending(true);
      setCode("");

      const { error } = await sendEmailOtp(email);
      setResending(false);

      if (error) {
        setErrors({ form: error.message });
        return;
      }
      setInfo("We sent a new code to your email.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    })();
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCode(sanitizeCode(e.target.value));
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/90 px-8 py-10 shadow-xl">
      <h1 className="text-2xl font-bold text-white text-center mb-1">
        Check your email
      </h1>
      <p className="text-zinc-400 text-center text-sm mb-8">
        We sent a verification code to{" "}
        <span className="text-zinc-200">{email}</span>. Enter it below to
        finish signing in.
      </p>
      <form onSubmit={handleSubmit} className="space-y-6">
        {errors.form && (
          <p
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
            role="alert"
          >
            {errors.form}
          </p>
        )}
        {info && !errors.form && (
          <p
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
            role="status"
          >
            {info}
          </p>
        )}
        <div>
          <label
            htmlFor="code"
            className="block text-sm font-medium text-white mb-2"
          >
            6-digit code
          </label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            autoComplete="one-time-code"
            value={code}
            onChange={handleCodeChange}
            maxLength={6}
            placeholder="123456"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white text-center text-lg tracking-[0.5em] placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? "code-error" : undefined}
          />
          {errors.code && (
            <p
              id="code-error"
              className="mt-1.5 text-sm text-amber-400"
              role="alert"
            >
              {errors.code}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-600 py-3 text-base font-medium text-white hover:bg-brand-500 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50"
        >
          {submitting ? "Verifying…" : "Verify and continue"}
        </button>
        <div className="text-center text-sm text-zinc-400">
          Didn&apos;t receive a code?{" "}
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || resending}
            className="font-medium text-brand-300 underline hover:text-brand-200 disabled:opacity-50 disabled:no-underline"
          >
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : resending
                ? "Sending…"
                : "Resend code"}
          </button>
        </div>
      </form>
    </div>
  );
}
