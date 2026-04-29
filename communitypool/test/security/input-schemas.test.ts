import { describe, expect, it } from "vitest";
import {
  parseChainId,
  parseEmail,
  parseEvmAddress,
  parseOtpCode,
  parsePoolDescription,
  parsePoolName,
  parseSafePathFragment,
  parseSavedAddressLabel,
  parseTokenSymbol,
  parseTxHash,
  parseUsdAmount,
  parseUuid,
} from "@/lib/security/input-schemas";

describe("parseEmail", () => {
  it("accepts a normal email and lowercases it", () => {
    expect(parseEmail("Alice@Example.com")).toEqual({
      ok: true,
      value: "alice@example.com",
    });
  });
  it("rejects empty / non-string / malformed", () => {
    expect(parseEmail("")).toMatchObject({ ok: false });
    expect(parseEmail("not-an-email")).toMatchObject({ ok: false });
    expect(parseEmail(42)).toMatchObject({ ok: false });
    expect(parseEmail("a@" + "x".repeat(260))).toMatchObject({ ok: false });
  });
});

describe("parseOtpCode", () => {
  it("accepts exactly 6 digits, ignoring whitespace", () => {
    expect(parseOtpCode("123456")).toEqual({ ok: true, value: "123456" });
    expect(parseOtpCode(" 123 456 ")).toEqual({ ok: true, value: "123456" });
  });
  it("rejects wrong length / non-digit", () => {
    expect(parseOtpCode("12345")).toMatchObject({ ok: false });
    expect(parseOtpCode("1234567")).toMatchObject({ ok: false });
    expect(parseOtpCode("abcdef")).toMatchObject({ ok: false });
  });
});

describe("parseUuid", () => {
  it("accepts a v4 UUID", () => {
    expect(parseUuid("3ba7c2fb-08cd-4b8e-9aef-9c0f0a06fa11")).toMatchObject({
      ok: true,
    });
  });
  it("rejects malformed", () => {
    expect(parseUuid("not-a-uuid")).toMatchObject({ ok: false });
  });
});

describe("parseEvmAddress", () => {
  it("accepts 0x-prefixed 40-hex", () => {
    expect(
      parseEvmAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"),
    ).toMatchObject({ ok: true });
  });
  it("rejects bad length / no 0x / non-hex", () => {
    expect(parseEvmAddress("2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599")).toMatchObject({
      ok: false,
    });
    expect(parseEvmAddress("0x123")).toMatchObject({ ok: false });
    expect(parseEvmAddress("0xZZZZ")).toMatchObject({ ok: false });
  });
});

describe("parseTxHash", () => {
  it("accepts 0x-prefixed 64-hex and lowercases", () => {
    const hash =
      "0xABCDEFabcdef0123456789ABCDEFabcdef0123456789ABCDEFabcdef01234567";
    expect(parseTxHash(hash)).toEqual({ ok: true, value: hash.toLowerCase() });
  });
  it("rejects malformed", () => {
    expect(parseTxHash("0xZZ")).toMatchObject({ ok: false });
  });
});

describe("parseChainId", () => {
  it("accepts the supported chain ids", () => {
    expect(parseChainId(1)).toEqual({ ok: true, value: 1 });
    expect(parseChainId(11155111)).toEqual({ ok: true, value: 11155111 });
    expect(parseChainId(31337)).toEqual({ ok: true, value: 31337 });
  });
  it("rejects unsupported / non-integer / non-number", () => {
    expect(parseChainId(137)).toMatchObject({ ok: false });
    expect(parseChainId("1" as unknown)).toMatchObject({ ok: false });
    expect(parseChainId(1.5)).toMatchObject({ ok: false });
    expect(parseChainId(0)).toMatchObject({ ok: false });
  });
});

describe("parseTokenSymbol", () => {
  it("accepts ETH/WBTC/PAXG/XAU₮", () => {
    for (const s of ["ETH", "WBTC", "PAXG", "XAU₮"]) {
      expect(parseTokenSymbol(s)).toMatchObject({ ok: true, value: s });
    }
  });
  it("rejects too long / wrong charset", () => {
    expect(parseTokenSymbol("LONGTOKEN1234")).toMatchObject({ ok: false });
    expect(parseTokenSymbol("<script>")).toMatchObject({ ok: false });
  });
});

describe("parseUsdAmount", () => {
  it("accepts decimal strings", () => {
    expect(parseUsdAmount("1")).toMatchObject({ ok: true, value: "1" });
    expect(parseUsdAmount("100.5")).toMatchObject({ ok: true, value: "100.5" });
    expect(parseUsdAmount("0.00000001")).toMatchObject({ ok: true });
  });
  it("rejects scientific notation, signs, commas, NaN-strings", () => {
    expect(parseUsdAmount("1e5")).toMatchObject({ ok: false });
    expect(parseUsdAmount("-1")).toMatchObject({ ok: false });
    expect(parseUsdAmount("1,000")).toMatchObject({ ok: false });
    expect(parseUsdAmount("NaN")).toMatchObject({ ok: false });
  });
});

describe("parsePoolName", () => {
  it("accepts trimmed normal punctuation", () => {
    expect(parsePoolName("  Alice's Pool — Round 2!  ")).toEqual({
      ok: true,
      value: "Alice's Pool — Round 2!",
    });
  });
  it("rejects empty after trim, oversize, interior control chars", () => {
    expect(parsePoolName("   ")).toMatchObject({ ok: false });
    expect(parsePoolName("a".repeat(81))).toMatchObject({ ok: false });
    // Trailing CR/LF is trimmed away first, so the interior placement is what
    // exercises the control-character check.
    expect(parsePoolName("alice\r\nbob")).toMatchObject({ ok: false });
    expect(parsePoolName("alice\x00bob")).toMatchObject({ ok: false });
  });
});

describe("parsePoolDescription", () => {
  it("accepts up to 500 characters and may be empty", () => {
    expect(parsePoolDescription("")).toEqual({ ok: true, value: "" });
    expect(parsePoolDescription("a".repeat(500))).toMatchObject({ ok: true });
  });
  it("rejects oversize / control chars", () => {
    expect(parsePoolDescription("a".repeat(501))).toMatchObject({ ok: false });
    expect(parsePoolDescription("oops")).toMatchObject({ ok: false });
  });
});

describe("parseSavedAddressLabel", () => {
  it("accepts up to 80 characters and trims", () => {
    expect(parseSavedAddressLabel("  My cold wallet  ")).toEqual({
      ok: true,
      value: "My cold wallet",
    });
  });
  it("rejects oversize", () => {
    expect(parseSavedAddressLabel("a".repeat(81))).toMatchObject({ ok: false });
  });
});

describe("parseSafePathFragment", () => {
  it("accepts a same-origin path", () => {
    expect(parseSafePathFragment("/dashboard?foo=bar")).toMatchObject({
      ok: true,
      value: "/dashboard?foo=bar",
    });
  });
  it("rejects off-origin / protocol-relative / backslash / control / malformed", () => {
    expect(parseSafePathFragment("https://evil.com")).toMatchObject({
      ok: false,
    });
    expect(parseSafePathFragment("//evil.com")).toMatchObject({ ok: false });
    expect(parseSafePathFragment("/foo\\bar")).toMatchObject({ ok: false });
    expect(parseSafePathFragment("/dashboard%0d%0aSet-Cookie:%20x=1")).toMatchObject({
      ok: false,
    });
    expect(parseSafePathFragment("%E0")).toMatchObject({ ok: false });
  });
});
