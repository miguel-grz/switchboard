export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      action_runs: {
        Row: {
          action_id: string | null
          agent_id: string
          attempt: number
          client_id: string
          detail: Json | null
          error: string | null
          executed_at: string
          id: number
          run_id: string | null
          status: string
          type: string
        }
        Insert: {
          action_id?: string | null
          agent_id: string
          attempt?: number
          client_id: string
          detail?: Json | null
          error?: string | null
          executed_at?: string
          id?: number
          run_id?: string | null
          status: string
          type: string
        }
        Update: {
          action_id?: string | null
          agent_id?: string
          attempt?: number
          client_id?: string
          detail?: Json | null
          error?: string | null
          executed_at?: string
          id?: number
          run_id?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_runs_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_actions: {
        Row: {
          agent_id: string
          condition: Json | null
          config: Json
          created_at: string
          enabled: boolean
          id: string
          sort_order: number
          type: string
        }
        Insert: {
          agent_id: string
          condition?: Json | null
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          sort_order?: number
          type: string
        }
        Update: {
          agent_id?: string
          condition?: Json | null
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          sort_order?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_intents: {
        Row: {
          agent_id: string
          created_at: string
          description: string | null
          id: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          description?: string | null
          id?: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_intents_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_revisions: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string | null
          fields: Json
          id: string
          provider: string
          provider_agent_id: string | null
          system_prompt: string
          version: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by?: string | null
          fields?: Json
          id?: string
          provider: string
          provider_agent_id?: string | null
          system_prompt: string
          version: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string | null
          fields?: Json
          id?: string
          provider?: string
          provider_agent_id?: string | null
          system_prompt?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_revisions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          channel: string | null
          client_id: string
          created_at: string
          description: string | null
          extraction_version: number
          id: string
          module_type: string
          name: string
          provider: string
          provider_agent_id: string | null
          status: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          channel?: string | null
          client_id: string
          created_at?: string
          description?: string | null
          extraction_version?: number
          id?: string
          module_type: string
          name: string
          provider: string
          provider_agent_id?: string | null
          status?: string
          system_prompt?: string
          updated_at?: string
        }
        Update: {
          channel?: string | null
          client_id?: string
          created_at?: string
          description?: string | null
          extraction_version?: number
          id?: string
          module_type?: string
          name?: string
          provider?: string
          provider_agent_id?: string | null
          status?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_members: {
        Row: {
          client_id: string
          created_at: string
          profile_id: string
          role: string
        }
        Insert: {
          client_id: string
          created_at?: string
          profile_id: string
          role?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          created_at: string
          id: string
          industry: string
          name: string
          notes: string | null
          status: string
          timezone: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          industry: string
          name: string
          notes?: string | null
          status?: string
          timezone?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          industry?: string
          name?: string
          notes?: string | null
          status?: string
          timezone?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          agent_id: string | null
          client_id: string | null
          id: number
          latency_ms: number | null
          level: string
          message: string | null
          occurred_at: string
          payload: Json | null
          run_id: string | null
          type: string
        }
        Insert: {
          agent_id?: string | null
          client_id?: string | null
          id?: number
          latency_ms?: number | null
          level?: string
          message?: string | null
          occurred_at?: string
          payload?: Json | null
          run_id?: string | null
          type: string
        }
        Update: {
          agent_id?: string | null
          client_id?: string | null
          id?: number
          latency_ms?: number | null
          level?: string
          message?: string | null
          occurred_at?: string
          payload?: Json | null
          run_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_values: {
        Row: {
          confidence: number | null
          created_at: string
          extraction_version: number
          field_key: string
          id: number
          intent_key: string | null
          run_id: string
          value_text: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          extraction_version: number
          field_key: string
          id?: number
          intent_key?: string | null
          run_id: string
          value_text?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          extraction_version?: number
          field_key?: string
          id?: number
          intent_key?: string | null
          run_id?: string
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extracted_values_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      field_defs: {
        Row: {
          agent_id: string
          created_at: string
          description: string | null
          id: string
          intent_id: string | null
          key: string
          label: string
          options: Json | null
          required: boolean
          sort_order: number
          type: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          description?: string | null
          id?: string
          intent_id?: string | null
          key: string
          label: string
          options?: Json | null
          required?: boolean
          sort_order?: number
          type: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          description?: string | null
          id?: string
          intent_id?: string | null
          key?: string
          label?: string
          options?: Json | null
          required?: boolean
          sort_order?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_defs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_defs_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "agent_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          role: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      provider_rates: {
        Row: {
          component: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          notes: string | null
          provider: string
          unit: string
          unit_cost_usd: number
        }
        Insert: {
          component: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          provider: string
          unit: string
          unit_cost_usd: number
        }
        Update: {
          component?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          provider?: string
          unit?: string
          unit_cost_usd?: number
        }
        Relationships: []
      }
      run_raw_events: {
        Row: {
          event_type: string
          id: number
          payload: Json
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_call_id: string | null
          received_at: string
          signature_verified: boolean
        }
        Insert: {
          event_type: string
          id?: number
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          provider: string
          provider_call_id?: string | null
          received_at?: string
          signature_verified?: boolean
        }
        Update: {
          event_type?: string
          id?: number
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_call_id?: string | null
          received_at?: string
          signature_verified?: boolean
        }
        Relationships: []
      }
      runs: {
        Row: {
          agent_id: string
          agent_revision_id: string | null
          caller_number: string | null
          client_id: string
          created_at: string
          direction: string
          duration_sec: number | null
          ended_at: string | null
          ended_reason: string | null
          extraction_status: string
          extraction_version: number | null
          id: string
          latency_ms: number | null
          provider: string
          provider_call_id: string
          reason_category: string | null
          recording_url: string | null
          started_at: string
          status: string
          summary: string | null
          urgency: string | null
        }
        Insert: {
          agent_id: string
          agent_revision_id?: string | null
          caller_number?: string | null
          client_id: string
          created_at?: string
          direction?: string
          duration_sec?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          extraction_status?: string
          extraction_version?: number | null
          id?: string
          latency_ms?: number | null
          provider: string
          provider_call_id: string
          reason_category?: string | null
          recording_url?: string | null
          started_at: string
          status: string
          summary?: string | null
          urgency?: string | null
        }
        Update: {
          agent_id?: string
          agent_revision_id?: string | null
          caller_number?: string | null
          client_id?: string
          created_at?: string
          direction?: string
          duration_sec?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          extraction_status?: string
          extraction_version?: number | null
          id?: string
          latency_ms?: number | null
          provider?: string
          provider_call_id?: string
          reason_category?: string | null
          recording_url?: string | null
          started_at?: string
          status?: string
          summary?: string | null
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_agent_revision_id_fkey"
            columns: ["agent_revision_id"]
            isOneToOne: false
            referencedRelation: "agent_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_turns: {
        Row: {
          id: number
          offset_ms: number | null
          run_id: string
          seq: number
          speaker: string
          text: string
        }
        Insert: {
          id?: number
          offset_ms?: number | null
          run_id: string
          seq: number
          speaker: string
          text: string
        }
        Update: {
          id?: number
          offset_ms?: number | null
          run_id?: string
          seq?: number
          speaker?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_turns_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          agent_id: string | null
          billed_usd: number | null
          client_id: string
          component: string
          cost_usd: number | null
          created_at: string
          currency: string
          id: number
          module_type: string
          occurred_at: string
          provider: string
          quantity: number
          reconciled: boolean
          run_id: string | null
          source_event_id: string | null
          unit: string
          unit_cost_usd: number | null
        }
        Insert: {
          agent_id?: string | null
          billed_usd?: number | null
          client_id: string
          component: string
          cost_usd?: number | null
          created_at?: string
          currency?: string
          id?: number
          module_type: string
          occurred_at: string
          provider: string
          quantity: number
          reconciled?: boolean
          run_id?: string | null
          source_event_id?: string | null
          unit: string
          unit_cost_usd?: number | null
        }
        Update: {
          agent_id?: string | null
          billed_usd?: number | null
          client_id?: string
          component?: string
          cost_usd?: number | null
          created_at?: string
          currency?: string
          id?: number
          module_type?: string
          occurred_at?: string
          provider?: string
          quantity?: number
          reconciled?: boolean
          run_id?: string | null
          source_event_id?: string | null
          unit?: string
          unit_cost_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_client_access: { Args: { cid: string }; Returns: boolean }
      is_operator: { Args: never; Returns: boolean }
      rate_for: {
        Args: {
          p_at: string
          p_component: string
          p_provider: string
          p_unit: string
        }
        Returns: number
      }
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

