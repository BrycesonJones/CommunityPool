import { describe, it, expect } from "vitest";
import {
  getLocalTodayYmd,
  getMinExpirationYmd,
  validateExpirationDateYmd,
} from "@/lib/onchain/community-pool";

describe("getLocalTodayYmd", () => {
  it("formats the local calendar date as YYYY-MM-DD", () => {
    const now = new Date(2026, 3, 19, 12, 0, 0);
    expect(getLocalTodayYmd(now)).toBe("2026-04-19");
  });

  it("pads single-digit months and days", () => {
    const now = new Date(2026, 0, 3, 0, 0, 0);
    expect(getLocalTodayYmd(now)).toBe("2026-01-03");
  });
});

describe("getMinExpirationYmd", () => {
  it("returns tomorrow's local ymd", () => {
    const now = new Date(2026, 3, 19, 12, 0, 0);
    expect(getMinExpirationYmd(now)).toBe("2026-04-20");
  });

  it("rolls over month boundary", () => {
    const now = new Date(2026, 3, 30, 23, 30, 0);
    expect(getMinExpirationYmd(now)).toBe("2026-05-01");
  });

  it("rolls over year boundary", () => {
    const now = new Date(2026, 11, 31, 23, 30, 0);
    expect(getMinExpirationYmd(now)).toBe("2027-01-01");
  });
});

describe("validateExpirationDateYmd", () => {
  const now = new Date(2026, 3, 19, 12, 0, 0);

  it("requires a non-empty value", () => {
    expect(validateExpirationDateYmd("", now)).toBe("Pool expiration date is required");
    expect(validateExpirationDateYmd("   ", now)).toBe("Pool expiration date is required");
  });

  it("rejects dates before today", () => {
    expect(validateExpirationDateYmd("2026-04-18", now)).toBe(
      "Pool expiration must be tomorrow or later",
    );
    expect(validateExpirationDateYmd("2000-01-01", now)).toBe(
      "Pool expiration must be tomorrow or later",
    );
  });

  it("rejects today (same-day expiration not allowed)", () => {
    expect(validateExpirationDateYmd("2026-04-19", now)).toBe(
      "Pool expiration must be tomorrow or later",
    );
  });

  it("accepts tomorrow", () => {
    expect(validateExpirationDateYmd("2026-04-20", now)).toBeNull();
  });

  it("accepts future dates", () => {
    expect(validateExpirationDateYmd("2027-01-01", now)).toBeNull();
    expect(validateExpirationDateYmd("2099-12-31", now)).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(validateExpirationDateYmd("2026-02-30", now)).toBe(
      "Enter a valid date (YYYY-MM-DD)",
    );
    expect(validateExpirationDateYmd("2026-13-01", now)).toBe(
      "Enter a valid date (YYYY-MM-DD)",
    );
    expect(validateExpirationDateYmd("2026-00-10", now)).toBe(
      "Enter a valid date (YYYY-MM-DD)",
    );
  });

  it("rejects malformed strings", () => {
    expect(validateExpirationDateYmd("not-a-date", now)).toBe(
      "Enter a valid date (YYYY-MM-DD)",
    );
    expect(validateExpirationDateYmd("2026/04/20", now)).toBe(
      "Enter a valid date (YYYY-MM-DD)",
    );
    expect(validateExpirationDateYmd("04-20-2026", now)).toBe(
      "Enter a valid date (YYYY-MM-DD)",
    );
  });
});
