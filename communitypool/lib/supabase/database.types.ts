export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      user_address_balances: {
        Row: {
          address_balance: number | null
          address_id: string
          assets: Json | null
          canonical_key: string | null
          chain_family: string | null
          created_at: string
          error_message: string | null
          id: string
          input_kind: string | null
          input_type: string | null
          last_fetched_at: string
          native_balances: Json | null
          network: string | null
          onchain_snapshot: Json | null
          provider: string | null
          snapshot_expires_at: string | null
          status: string
          transaction_hash_id: string | null
          transactions: Json | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          address_balance?: number | null
          address_id: string
          assets?: Json | null
          canonical_key?: string | null
          chain_family?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_kind?: string | null
          input_type?: string | null
          last_fetched_at?: string
          native_balances?: Json | null
          network?: string | null
          onchain_snapshot?: Json | null
          provider?: string | null
          snapshot_expires_at?: string | null
          status?: string
          transaction_hash_id?: string | null
          transactions?: Json | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          address_balance?: number | null
          address_id?: string
          assets?: Json | null
          canonical_key?: string | null
          chain_family?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_kind?: string | null
          input_type?: string | null
          last_fetched_at?: string
          native_balances?: Json | null
          network?: string | null
          onchain_snapshot?: Json | null
          provider?: string | null
          snapshot_expires_at?: string | null
          status?: string
          transaction_hash_id?: string | null
          transactions?: Json | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      user_pool_activity: {
        Row: {
          asset_type: string | null
          chain_id: number
          created_at: string
          deploy_tx_hash: string | null
          description: string
          expires_at_unix: number
          fund_tx_hash: string | null
          funded_amount_human: string | null
          id: string
          last_activity: string
          last_tx_hashes: string[]
          metadata: Json
          minimum_usd_wei: string | null
          name: string
          pool_address: string
          total_usd_estimate: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_type?: string | null
          chain_id: number
          created_at?: string
          deploy_tx_hash?: string | null
          description?: string
          expires_at_unix: number
          fund_tx_hash?: string | null
          funded_amount_human?: string | null
          id?: string
          last_activity: string
          last_tx_hashes?: string[]
          metadata?: Json
          minimum_usd_wei?: string | null
          name?: string
          pool_address: string
          total_usd_estimate?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_type?: string | null
          chain_id?: number
          created_at?: string
          deploy_tx_hash?: string | null
          description?: string
          expires_at_unix?: number
          fund_tx_hash?: string | null
          funded_amount_human?: string | null
          id?: string
          last_activity?: string
          last_tx_hashes?: string[]
          metadata?: Json
          minimum_usd_wei?: string | null
          name?: string
          pool_address?: string
          total_usd_estimate?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pool_owner_memberships: {
        Row: {
          chain_id: number
          created_at: string
          created_by_user_id: string
          id: string
          is_deployer: boolean
          owner_address: string
          pool_address: string
          updated_at: string
        }
        Insert: {
          chain_id: number
          created_at?: string
          created_by_user_id: string
          id?: string
          is_deployer?: boolean
          owner_address: string
          pool_address: string
          updated_at?: string
        }
        Update: {
          chain_id?: number
          created_at?: string
          created_by_user_id?: string
          id?: string
          is_deployer?: boolean
          owner_address?: string
          pool_address?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_billing_state: {
        Row: {
          created_at: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_cancel_at_period_end: boolean
          subscription_current_period_end: string | null
          subscription_interval: string | null
          subscription_plan: string
          subscription_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_cancel_at_period_end?: boolean
          subscription_current_period_end?: string | null
          subscription_interval?: string | null
          subscription_plan?: string
          subscription_status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_cancel_at_period_end?: boolean
          subscription_current_period_end?: string | null
          subscription_interval?: string | null
          subscription_plan?: string
          subscription_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          kyc_profile_completed: boolean | null
          phone_number: string | null
          postal_code: string | null
          state: string | null
          updated_at: string
          username: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          kyc_profile_completed?: boolean | null
          phone_number?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          kyc_profile_completed?: boolean | null
          phone_number?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      stripe_processed_events: {
        Row: {
          created_at: string
          decision: string
          event_created: number
          event_id: string
          event_type: string
          processed_at: string | null
          reason: string | null
          received_at: string
          stripe_customer_id_hash: string | null
          stripe_subscription_id_hash: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision: string
          event_created: number
          event_id: string
          event_type: string
          processed_at?: string | null
          reason?: string | null
          received_at?: string
          stripe_customer_id_hash?: string | null
          stripe_subscription_id_hash?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision?: string
          event_created?: number
          event_id?: string
          event_type?: string
          processed_at?: string | null
          reason?: string | null
          received_at?: string
          stripe_customer_id_hash?: string | null
          stripe_subscription_id_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_pool_deployments: {
        Row: {
          chain_id: number
          created_at: string
          deploy_tx_hash: string
          deployment_status: string
          funding_status: string | null
          id: string
          pool_address: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chain_id: number
          created_at?: string
          deploy_tx_hash: string
          deployment_status?: string
          funding_status?: string | null
          id?: string
          pool_address: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chain_id?: number
          created_at?: string
          deploy_tx_hash?: string
          deployment_status?: string
          funding_status?: string | null
          id?: string
          pool_address?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_saved_lookups: {
        Row: {
          address_balance: number | null
          address_id: string
          created_at: string
          id: string
          onchain_snapshot: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address_balance?: number | null
          address_id: string
          created_at?: string
          id?: string
          onchain_snapshot?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address_balance?: number | null
          address_id?: string
          created_at?: string
          id?: string
          onchain_snapshot?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
