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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      buyer_profiles: {
        Row: {
          budget_max: number | null
          budget_min: number | null
          email: string | null
          id: string
          interest_tags: string[] | null
          name: string
        }
        Insert: {
          budget_max?: number | null
          budget_min?: number | null
          email?: string | null
          id?: string
          interest_tags?: string[] | null
          name: string
        }
        Update: {
          budget_max?: number | null
          budget_min?: number | null
          email?: string | null
          id?: string
          interest_tags?: string[] | null
          name?: string
        }
        Relationships: []
      }
      deals: {
        Row: {
          agreed_price: number | null
          buyer_budget: number | null
          buyer_conditions: string | null
          buyer_id: string | null
          created_at: string | null
          id: string
          listing_id: string | null
          negotiation_mode:
            | Database["public"]["Enums"]["negotiation_mode"]
            | null
          platform_fee: number | null
          seller_id: string | null
          status: Database["public"]["Enums"]["deal_status"] | null
          terms_json: Json | null
          tracking_number: string | null
        }
        Insert: {
          agreed_price?: number | null
          buyer_budget?: number | null
          buyer_conditions?: string | null
          buyer_id?: string | null
          created_at?: string | null
          id?: string
          listing_id?: string | null
          negotiation_mode?:
            | Database["public"]["Enums"]["negotiation_mode"]
            | null
          platform_fee?: number | null
          seller_id?: string | null
          status?: Database["public"]["Enums"]["deal_status"] | null
          terms_json?: Json | null
          tracking_number?: string | null
        }
        Update: {
          agreed_price?: number | null
          buyer_budget?: number | null
          buyer_conditions?: string | null
          buyer_id?: string | null
          created_at?: string | null
          id?: string
          listing_id?: string | null
          negotiation_mode?:
            | Database["public"]["Enums"]["negotiation_mode"]
            | null
          platform_fee?: number | null
          seller_id?: string | null
          status?: Database["public"]["Enums"]["deal_status"] | null
          terms_json?: Json | null
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string | null
          deal_id: string | null
          id: string
          invoice_data: Json | null
          paypal_invoice_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          deal_id?: string | null
          id?: string
          invoice_data?: Json | null
          paypal_invoice_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          deal_id?: string | null
          id?: string
          invoice_data?: Json | null
          paypal_invoice_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          created_at: string | null
          description: string | null
          floor_price: number | null
          id: string
          price: number
          seller_id: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          floor_price?: number | null
          id?: string
          price: number
          seller_id?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          floor_price?: number | null
          id?: string
          price?: number
          seller_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          created_at: string | null
          deal_id: string | null
          id: string
          is_ai_generated: boolean | null
          sender: Database["public"]["Enums"]["message_sender"]
          text: string
        }
        Insert: {
          created_at?: string | null
          deal_id?: string | null
          id?: string
          is_ai_generated?: boolean | null
          sender: Database["public"]["Enums"]["message_sender"]
          text: string
        }
        Update: {
          created_at?: string | null
          deal_id?: string | null
          id?: string
          is_ai_generated?: boolean | null
          sender?: Database["public"]["Enums"]["message_sender"]
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          deal_id: string | null
          id: string
          paypal_payout_batch_id: string | null
          platform_fee: number
          released_at: string | null
          status: string | null
        }
        Insert: {
          amount: number
          deal_id?: string | null
          id?: string
          paypal_payout_batch_id?: string | null
          platform_fee: number
          released_at?: string | null
          status?: string | null
        }
        Update: {
          amount?: number
          deal_id?: string | null
          id?: string
          paypal_payout_batch_id?: string | null
          platform_fee?: number
          released_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payouts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
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
      deal_status:
        | "negotiating"
        | "agreed"
        | "invoiced"
        | "paid"
        | "shipped"
        | "return_window"
        | "released"
        | "disputed"
      message_sender: "buyer" | "seller" | "buyer_agent" | "seller_agent"
      negotiation_mode: "self_chat" | "ai_negotiate"
      user_role: "buyer" | "seller"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      deal_status: [
        "negotiating",
        "agreed",
        "invoiced",
        "paid",
        "shipped",
        "return_window",
        "released",
        "disputed",
      ],
      message_sender: ["buyer", "seller", "buyer_agent", "seller_agent"],
      negotiation_mode: ["self_chat", "ai_negotiate"],
      user_role: ["buyer", "seller"],
    },
  },
} as const

