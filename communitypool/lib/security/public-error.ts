import "server-only";
import { NextResponse } from "next/server";
import { redactForLog } from "./redact";

export type ApiError = {
  error: string;
  code?: string;
  request_id?: string;
};

/**
 * Server-only error sanitization helper. Logs the raw error to the server
 * console (so operators can debug) and returns a stable, opaque, public-facing
 * message to the client. Never leak SDK internals, stack traces, SQL, RPC URLs,
 * JWTs, cookies, OTP codes, KYC data, or secret values to API responses.
 *
 * Server-side log output is run through `redactForLog` so secret-shaped
 * substrings (Stripe `whsec_`/`sk_*`/`cus_`/`sub_`, JWTs, Postgres URLs,
 * `Authorization: Bearer …`) are masked before they reach a hosted log
 * collector. The redaction is defence-in-depth — the primary contract is
 * still "don't pass secrets into errors."
 */
export function publicError(
  internal: unknown,
  fallback: string,
): { error: string } {
  console.error(redactForLog(internal));
  return { error: fallback };
}

export function buildApiError(
  error: string,
  code?: string,
  request?: Request,
): ApiError {
  const requestId =
    request?.headers.get("x-request-id") ??
    request?.headers.get("x-correlation-id") ??
    undefined;
  return {
    error,
    ...(code ? { code } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  };
}

export function apiErrorResponse(args: {
  internal?: unknown;
  error: string;
  code?: string;
  status: number;
  request?: Request;
}): NextResponse {
  if (args.internal !== undefined) {
    console.error(redactForLog(args.internal));
  }
  return NextResponse.json(
    buildApiError(args.error, args.code, args.request),
    { status: args.status },
  );
}

/**
 * Convenience wrapper that returns a NextResponse with a sanitized error body.
 */
export function publicErrorResponse(
  internal: unknown,
  fallback: string,
  status: number,
): NextResponse {
  return apiErrorResponse({
    internal,
    error: fallback,
    status,
  });
}
