import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("pool debug guard", () => {
  it("cannot enable pool debug logs in production", () => {
    const file = readFileSync(
      resolve(process.cwd(), "components/pool-activity-provider.tsx"),
      "utf8",
    );
    expect(file).toContain("process.env.NODE_ENV !== \"production\"");
    expect(file).toContain("process.env.NEXT_PUBLIC_POOL_DEBUG === \"1\"");
  });
});
