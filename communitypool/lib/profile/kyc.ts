import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type KycProfile = {
  fullName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const EMPTY_KYC_PROFILE: KycProfile = {
  fullName: "",
  phoneNumber: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
};

export type KycStatus = {
  complete: boolean;
  profile: KycProfile;
};

const REQUIRED_FIELDS: (keyof KycProfile)[] = [
  "fullName",
  "phoneNumber",
  "addressLine1",
  "city",
  "state",
  "postalCode",
  "country",
];

export function isKycProfileComplete(profile: KycProfile): boolean {
  return REQUIRED_FIELDS.every((k) => profile[k].trim().length > 0);
}

export function missingKycFields(profile: KycProfile): (keyof KycProfile)[] {
  return REQUIRED_FIELDS.filter((k) => profile[k].trim().length === 0);
}

function rowToProfile(
  row: Database["public"]["Tables"]["user_profiles"]["Row"] | null,
): KycProfile {
  if (!row) return { ...EMPTY_KYC_PROFILE };
  return {
    fullName: row.full_name ?? "",
    phoneNumber: row.phone_number ?? "",
    addressLine1: row.address_line1 ?? "",
    addressLine2: row.address_line2 ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    postalCode: row.postal_code ?? "",
    country: row.country ?? "",
  };
}

/**
 * Loads the user_profiles row for the current user. If the row does not yet
 * exist (e.g. user signed up before user_profiles was seeded), returns an
 * empty profile so the caller treats KYC as incomplete and prompts the user.
 */
export async function fetchKycStatus(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<KycStatus> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select(
      "id, full_name, phone_number, address_line1, address_line2, city, state, postal_code, country, kyc_profile_completed",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  if (data?.kyc_profile_completed === true) {
    return { complete: true, profile: rowToProfile(
      data as Database["public"]["Tables"]["user_profiles"]["Row"],
    ) };
  }

  const profile = rowToProfile(
    (data ?? null) as
      | Database["public"]["Tables"]["user_profiles"]["Row"]
      | null,
  );
  return { complete: isKycProfileComplete(profile), profile };
}

/**
 * Upserts KYC fields for the current user. The row is keyed on auth.users.id;
 * `email` and `username` are required NOT NULL columns on user_profiles, so we
 * pass through the auth email and a derived username when inserting.
 */
export async function upsertKycProfile(
  supabase: SupabaseClient<Database>,
  user: User,
  next: KycProfile,
): Promise<void> {
  const email = user.email ?? "";
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const username =
    typeof meta.username === "string" && meta.username.trim()
      ? meta.username.trim()
      : email || user.id;

  const payload: Database["public"]["Tables"]["user_profiles"]["Insert"] = {
    id: user.id,
    email,
    username,
    full_name: next.fullName.trim() || null,
    phone_number: next.phoneNumber.trim() || null,
    address_line1: next.addressLine1.trim() || null,
    address_line2: next.addressLine2.trim() || null,
    city: next.city.trim() || null,
    state: next.state.trim() || null,
    postal_code: next.postalCode.trim() || null,
    country: next.country.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("user_profiles")
    .upsert(payload, { onConflict: "id" });
  if (error) throw new Error(error.message);
}
