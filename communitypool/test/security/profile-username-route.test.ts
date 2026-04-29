import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

const mockGetUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

const mockUpdateUserById = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { admin: { updateUserById: mockUpdateUserById } },
  }),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
  mockGetUser.mockReset();
  mockUpdateUserById.mockReset();
  mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
});

afterEach(async () => {
  vi.unstubAllEnvs();
});

async function postUsername(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/auth/profile/username/route");
  return POST(
    new Request("https://app.example/api/auth/profile/username", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function lastUpdateCall(): { userId: string; payload: unknown } | null {
  const calls = mockUpdateUserById.mock.calls as unknown as Array<
    [string, { user_metadata?: unknown }]
  >;
  const last = calls.at(-1);
  if (!last) return null;
  return { userId: last[0], payload: last[1] };
}

describe("POST /api/auth/profile/username", () => {
  it("returns 401 when there is no Supabase session", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await postUsername({ username: "alice_42" });
    expect(res.status).toBe(401);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("rejects an invalid (HTML/script) username with 400 and does not call admin update", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "u-real" } },
    });
    const res = await postUsername({
      username: "<img src=x onerror=alert(1)>",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/invalid request/i);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("rejects a username over 40 characters", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "u-real" } },
    });
    const res = await postUsername({ username: "a".repeat(41) });
    expect(res.status).toBe(400);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only username and interior whitespace", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-real" } } });
    const r1 = await postUsername({ username: "   " });
    expect(r1.status).toBe(400);
    const r2 = await postUsername({ username: "alice bob" });
    expect(r2.status).toBe(400);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("accepts a valid username and writes only to the authenticated user.id", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "u-authentic" } },
    });
    const res = await postUsername({
      // Sneaky body: try to pivot the update onto someone else.
      user_id: "u-attacker",
      username: "  alice_42  ",
    });
    expect(res.status).toBe(200);
    const call = lastUpdateCall();
    expect(call?.userId).toBe("u-authentic");
    expect(call?.payload).toMatchObject({
      user_metadata: { username: "alice_42" },
    });
  });

  it("ignores unrelated body keys but still rejects when username is missing", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "u-real" } },
    });
    const res = await postUsername({ user_id: "u-attacker" });
    expect(res.status).toBe(400);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON without crashing", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "u-real" } },
    });
    const { POST } = await import("@/app/api/auth/profile/username/route");
    const res = await POST(
      new Request("https://app.example/api/auth/profile/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });
});
