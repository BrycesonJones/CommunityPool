import { describe, expect, it } from "vitest";
import {
  normalizeUsdAmountInput,
  sanitizeUsdAmountInputPaste,
  sanitizeUsdAmountInputTyping,
  validateUsdAmountInputMessage,
} from "@/lib/onchain/usd-amount-input";

describe("normalizeUsdAmountInput - accepted formats", () => {
  const cases: Array<[string, string]> = [
    ["1234", "1234"],
    ["0.01", "0.01"],
    ["1234.56", "1234.56"],
    ["1234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1 234,56", "1234.56"],
    ["1,234,567.89", "1234567.89"],
    ["1.234.567,89", "1234567.89"],
    ["1 234 567,89", "1234567.89"],
    ["1 234 567", "1234567"],
    ["1,234", "1234"],
    ["1.234", "1234"],
    ["1,56", "1.56"],
    ["1.56", "1.56"],
  ];
  for (const [input, canonical] of cases) {
    it(`accepts ${JSON.stringify(input)} -> ${canonical}`, () => {
      const r = normalizeUsdAmountInput(input);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.canonical).toBe(canonical);
    });
  }
});

describe("normalizeUsdAmountInput - rejected inputs", () => {
  const rejected: string[] = [
    "",
    "abc",
    "1a",
    "$1",
    "1,,234",
    "1..234",
    "1, 234",
    "12 34,56",
    "1,23,4.56",
    "1,234.5.6",
    ".5",
    ",5",
    "-1",
    "1e3",
    "1,234.",
    "1 234 56",
    "1.2.3",
    " 1",
    "1 ",
    ",",
    ".",
    " ",
    "1  234,56",
  ];
  for (const input of rejected) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      const r = normalizeUsdAmountInput(input);
      expect(r.ok).toBe(false);
    });
  }
});

describe("sanitizeUsdAmountInputTyping", () => {
  it("drops a letter keystroke, keeping previous value", () => {
    expect(sanitizeUsdAmountInputTyping("1a", "1")).toBe("1");
    expect(sanitizeUsdAmountInputTyping("a", "")).toBe("");
  });

  it("rejects adjacent separator keystrokes", () => {
    expect(sanitizeUsdAmountInputTyping("1,,", "1,")).toBe("1,");
    expect(sanitizeUsdAmountInputTyping("1..", "1.")).toBe("1.");
    expect(sanitizeUsdAmountInputTyping("1, ", "1,")).toBe("1,");
    expect(sanitizeUsdAmountInputTyping("1  ", "1 ")).toBe("1 ");
    expect(sanitizeUsdAmountInputTyping("1,.", "1,")).toBe("1,");
  });

  it("rejects leading-separator keystrokes", () => {
    expect(sanitizeUsdAmountInputTyping(",1", "")).toBe("");
    expect(sanitizeUsdAmountInputTyping(".5", "")).toBe("");
    expect(sanitizeUsdAmountInputTyping(" 5", "")).toBe("");
  });

  it("passes through valid intermediate prefixes", () => {
    expect(sanitizeUsdAmountInputTyping("1", "")).toBe("1");
    expect(sanitizeUsdAmountInputTyping("1,", "1")).toBe("1,");
    expect(sanitizeUsdAmountInputTyping("1,2", "1,")).toBe("1,2");
    expect(sanitizeUsdAmountInputTyping("1,234", "1,23")).toBe("1,234");
    expect(sanitizeUsdAmountInputTyping("1 234,56", "1 234,5")).toBe("1 234,56");
  });

  it("accepts an empty clear", () => {
    expect(sanitizeUsdAmountInputTyping("", "1,234")).toBe("");
  });
});

describe("sanitizeUsdAmountInputPaste", () => {
  it("strips surrounding non-numeric chrome", () => {
    expect(sanitizeUsdAmountInputPaste("$1,234.56 USD")).toBe("1,234.56");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeUsdAmountInputPaste("  1234,56  ")).toBe("1234,56");
  });

  it("empties a wholly invalid paste", () => {
    expect(sanitizeUsdAmountInputPaste("abc")).toBe("");
    expect(normalizeUsdAmountInput(sanitizeUsdAmountInputPaste("abc")).ok).toBe(false);
  });

  it("preserves accepted Euro decimal via paste", () => {
    const v = sanitizeUsdAmountInputPaste("  1.234,56  ");
    expect(v).toBe("1.234,56");
    const r = normalizeUsdAmountInput(v);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.canonical).toBe("1234.56");
  });
});

describe("validateUsdAmountInputMessage", () => {
  it("returns null for valid inputs", () => {
    expect(validateUsdAmountInputMessage("1,234.56")).toBeNull();
    expect(validateUsdAmountInputMessage("1 234,56")).toBeNull();
  });

  it("returns a message for invalid inputs", () => {
    expect(validateUsdAmountInputMessage("")).toMatch(/USD amount/i);
    expect(validateUsdAmountInputMessage("abc")).toMatch(/digits/i);
    expect(validateUsdAmountInputMessage("1,,234")).toMatch(/valid USD amount/i);
  });
});
