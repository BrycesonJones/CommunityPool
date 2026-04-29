/**
 * Sanitize and normalize a USD amount string entered by the user.
 *
 * Accepted formats (see plan):
 *   A) `1234`           (plain integer)
 *   B) `1234,56` / `1234.56`       (decimal only)
 *   C) `1,234` / `1.234` / `1 234` (thousands only, groups of exactly 3 digits)
 *   D) `1,234.56` / `1.234,56` / `1 234,56` (thousands + decimal)
 *
 * The thousands separator (if present) is one of `,`, `.`, ` `. The decimal
 * separator is one of `,`, `.` and must differ from the thousands separator.
 */

const ALLOWED_CHAR_RE = /^[\d ,.]*$/;
const DISALLOWED_CHAR_RE = /[^\d ,.]/;
const DISALLOWED_CHAR_GLOBAL_RE = /[^\d ,.]/g;
const ADJACENT_SEPARATOR_RE = /[ ,.]{2}/;

export type NormalizeResult =
  | { ok: true; canonical: string }
  | { ok: false; reason: "empty" | "chars" | "format" };

/** Strip characters that are not digits/`,`/`.`/space. */
export function filterAllowedChars(s: string): string {
  return s.replace(DISALLOWED_CHAR_GLOBAL_RE, "");
}

/**
 * Live keystroke guard. Given the proposed next value and the previously
 * accepted value, return either the sanitized next value or `prev` if the
 * change introduces something structurally invalid we can detect quickly
 * (disallowed chars, adjacent separators, leading separator).
 *
 * Note: full grammar validation is deferred to `normalizeUsdAmountInput`
 * so the user can still type ambiguous prefixes like `1,`.
 */
export function sanitizeUsdAmountInputTyping(next: string, prev: string): string {
  if (next === "") return "";
  if (DISALLOWED_CHAR_RE.test(next)) {
    return prev;
  }
  if (ADJACENT_SEPARATOR_RE.test(next)) {
    return prev;
  }
  if (/^[ ,.]/.test(next)) {
    return prev;
  }
  return next;
}

/** Sanitize a pasted value: strip disallowed chars and trim edge spaces. */
export function sanitizeUsdAmountInputPaste(s: string): string {
  return filterAllowedChars(s).replace(/^\s+|\s+$/g, "");
}

/**
 * Strictly parse the input against the accepted grammar and return a
 * canonical `1234.56`-style string suitable for downstream parsing.
 */
export function normalizeUsdAmountInput(raw: string): NormalizeResult {
  if (raw.length === 0) return { ok: false, reason: "empty" };
  if (!ALLOWED_CHAR_RE.test(raw)) return { ok: false, reason: "chars" };
  if (ADJACENT_SEPARATOR_RE.test(raw)) return { ok: false, reason: "format" };
  if (/^[ ,.]/.test(raw) || /[ ,.]$/.test(raw)) {
    return { ok: false, reason: "format" };
  }

  const commas = (raw.match(/,/g) ?? []).length;
  const dots = (raw.match(/\./g) ?? []).length;
  const spaces = (raw.match(/ /g) ?? []).length;

  if (commas === 0 && dots === 0 && spaces === 0) {
    if (!/^\d+$/.test(raw)) return { ok: false, reason: "format" };
    return { ok: true, canonical: raw };
  }

  let thouSep: string | null = null;
  let decSep: string | null = null;

  if (spaces > 0) {
    if (commas > 0 && dots > 0) return { ok: false, reason: "format" };
    thouSep = " ";
    if (commas > 1 || dots > 1) return { ok: false, reason: "format" };
    if (commas === 1) decSep = ",";
    else if (dots === 1) decSep = ".";
  } else if (commas > 0 && dots > 0) {
    if (commas > 1 && dots === 1) {
      thouSep = ",";
      decSep = ".";
    } else if (dots > 1 && commas === 1) {
      thouSep = ".";
      decSep = ",";
    } else if (commas === 1 && dots === 1) {
      if (raw.lastIndexOf(".") > raw.lastIndexOf(",")) {
        thouSep = ",";
        decSep = ".";
      } else {
        thouSep = ".";
        decSep = ",";
      }
    } else {
      return { ok: false, reason: "format" };
    }
  } else if (commas > 0) {
    if (commas === 1) {
      const parts = raw.split(",");
      if (/^\d{1,3}$/.test(parts[0]) && /^\d{3}$/.test(parts[1])) {
        thouSep = ",";
      } else {
        decSep = ",";
      }
    } else {
      thouSep = ",";
    }
  } else if (dots > 0) {
    if (dots === 1) {
      const parts = raw.split(".");
      if (/^\d{1,3}$/.test(parts[0]) && /^\d{3}$/.test(parts[1])) {
        thouSep = ".";
      } else {
        decSep = ".";
      }
    } else {
      thouSep = ".";
    }
  }

  let intPart: string;
  let fracPart: string | null = null;

  if (decSep !== null) {
    const idx = raw.lastIndexOf(decSep);
    intPart = raw.slice(0, idx);
    fracPart = raw.slice(idx + 1);
    if (!/^\d+$/.test(fracPart)) return { ok: false, reason: "format" };
  } else {
    intPart = raw;
  }

  if (thouSep !== null) {
    const groups = intPart.split(thouSep);
    if (groups.length < 2) return { ok: false, reason: "format" };
    if (!/^\d{1,3}$/.test(groups[0])) return { ok: false, reason: "format" };
    for (let i = 1; i < groups.length; i += 1) {
      if (!/^\d{3}$/.test(groups[i])) return { ok: false, reason: "format" };
    }
    intPart = groups.join("");
  } else if (!/^\d+$/.test(intPart)) {
    return { ok: false, reason: "format" };
  }

  const canonical = fracPart !== null ? `${intPart}.${fracPart}` : intPart;
  return { ok: true, canonical };
}

/**
 * Return a user-facing error message, or `null` if `raw` is a valid USD
 * amount per the accepted grammar.
 */
export function validateUsdAmountInputMessage(raw: string): string | null {
  const r = normalizeUsdAmountInput(raw);
  if (r.ok) return null;
  switch (r.reason) {
    case "empty":
      return "Enter a USD amount.";
    case "chars":
      return "Amount may only contain digits, commas, periods, and spaces.";
    case "format":
    default:
      return "Enter a valid USD amount (e.g. 1,234.56).";
  }
}
