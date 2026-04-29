"use client";

type ClientSecurityEvent = {
  event_type: string;
  severity?: "debug" | "info" | "medium" | "high" | "critical";
  chain_id?: number;
  pool_address?: string;
  tx_hash?: string;
  wallet_address?: string;
  error_code?: string;
  safe_message?: string;
  metadata?: Record<string, unknown>;
  db_persist_ok?: boolean;
  needs_recovery?: boolean;
  action?: string;
  status?: string;
  explorer_url?: string;
};

export async function postClientSecurityEvent(event: ClientSecurityEvent): Promise<void> {
  try {
    await fetch("/api/security/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Never throw from client telemetry paths.
  }
}
