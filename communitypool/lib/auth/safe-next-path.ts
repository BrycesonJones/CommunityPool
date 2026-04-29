/**
 * Validate a `next` redirect path passed via query string after auth.
 * Only same-origin absolute paths are allowed; anything that could be parsed
 * as a protocol-relative or off-origin URL collapses to the dashboard.
 *
 * Invalid examples that resolve to /dashboard:
 *   - "https://evil.com"
 *   - "//evil.com"
 *   - "/\\evil.com"
 *   - "%2F%2Fevil.com"        (decoded by URL parsers to "//evil.com")
 *   - "/dashboard%0d%0aSet-Cookie: x=1"  (CRLF response-splitting)
 *   - "/dashboard%00evil"     (NUL byte truncation)
 */
const FALLBACK = "/dashboard";

// ASCII control characters (C0 + DEL). CR/LF/NUL are the dangerous ones for
// header injection / log spoofing / parser confusion; reject the whole class
// so we don't have to enumerate.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

export function safeNextPath(raw: string | null | undefined): string {
  if (raw == null) return FALLBACK;
  if (raw === "") return FALLBACK;

  let candidate = raw;
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return FALLBACK;
  }

  // Reject CR / LF / NUL / other ASCII control bytes after decoding. Defends
  // against `?next=/foo%0d%0aSet-Cookie:%20pwn=1` even if a future runtime
  // stops sanitizing the Location header for us.
  if (CONTROL_CHARS.test(candidate)) return FALLBACK;

  if (!candidate.startsWith("/")) return FALLBACK;
  if (candidate.startsWith("//")) return FALLBACK;
  if (candidate.startsWith("/\\")) return FALLBACK;

  // Defensive: a backslash-led second segment can be reinterpreted as a
  // protocol-relative URL by some browsers' Location parser. Reject any
  // path containing a backslash entirely — internal routes never use them.
  if (candidate.includes("\\")) return FALLBACK;

  return candidate;
}
