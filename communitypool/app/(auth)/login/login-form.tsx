"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { sendEmailOtp } from "@/lib/auth/email-verification";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import GoogleAuthButton from "@/components/google-auth-button";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void (async () => {
      const trimmedEmail = email.trim();
      const next: Record<string, string> = {};

      if (!trimmedEmail) next.email = "Email is required";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
        next.email = "Enter a valid email address";

      setErrors(next);
      if (Object.keys(next).length > 0) return;

      if (trimmedEmail !== email) setEmail(trimmedEmail);

      setSubmitting(true);
      setErrors({});

      const { error } = await sendEmailOtp(trimmedEmail);

      setSubmitting(false);

      if (error) {
        setErrors({ form: error.message });
        return;
      }

      const params = new URLSearchParams({
        email: trimmedEmail,
        next: nextPath,
      });
      router.push(`/auth/verify?${params.toString()}`);
    })();
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/90 px-8 py-10 shadow-xl">
      <h1 className="text-2xl font-bold text-white text-center mb-1">
        Welcome Back
      </h1>
      <p className="text-zinc-400 text-center text-sm mb-8">
        Sign in to your CommunityPool account
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
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-white mb-2"
          >
            Email Address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          {errors.email && (
            <p
              id="email-error"
              className="mt-1.5 text-sm text-amber-400"
              role="alert"
            >
              {errors.email}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-brand-600 py-3 text-base font-medium text-white hover:bg-brand-500 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50"
        >
          {submitting ? "Sending code…" : "Continue with email"}
        </button>
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-zinc-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-zinc-950 px-2 text-zinc-500">
              Or continue with
            </span>
          </div>
        </div>
        <GoogleAuthButton
          label="Sign in with Google"
          nextPath={nextPath}
          onError={(message) => setErrors({ form: message })}
        />
        <p className="text-center text-sm text-zinc-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-brand-300 underline hover:text-brand-200"
          >
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}
