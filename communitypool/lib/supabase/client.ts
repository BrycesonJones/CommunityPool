import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type GlobalAuthQueueState = {
  __cpGetUserTail?: Promise<void>;
  __cpGetUserQueueDepth?: number;
  __cpGetUserInFlight?: number;
};

function authQueueStore(): GlobalAuthQueueState {
  return globalThis as unknown as GlobalAuthQueueState;
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createBrowserClient<Database>(url, key);
}

export async function getUserSerialized(
  supabase: SupabaseClient<Database>,
): Promise<User | null> {
  const store = authQueueStore();
  const prevTail = store.__cpGetUserTail ?? Promise.resolve();
  store.__cpGetUserQueueDepth = (store.__cpGetUserQueueDepth ?? 0) + 1;

  let releaseTurn: () => void = () => {};
  store.__cpGetUserTail = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });

  await prevTail;

  store.__cpGetUserInFlight = (store.__cpGetUserInFlight ?? 0) + 1;

  try {
    const result = await supabase.auth.getUser();
    return result.data.user;
  } finally {
    store.__cpGetUserInFlight = Math.max(0, (store.__cpGetUserInFlight ?? 1) - 1);
    store.__cpGetUserQueueDepth = Math.max(0, (store.__cpGetUserQueueDepth ?? 1) - 1);
    releaseTurn();
  }
}
