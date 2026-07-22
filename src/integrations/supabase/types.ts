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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      address_book: {
        Row: {
          agent_token_hash: string | null
          alias: string | null
          approved_at: string | null
          approved_by: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          device_group: string | null
          enrolled_via_secret_id: string | null
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          id: string
          is_active: boolean
          last_online: string | null
          os: string | null
          rustdesk_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent_token_hash?: string | null
          alias?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          device_group?: string | null
          enrolled_via_secret_id?: string | null
          enrollment_status?: Database["public"]["Enums"]["enrollment_status"]
          id?: string
          is_active?: boolean
          last_online?: string | null
          os?: string | null
          rustdesk_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent_token_hash?: string | null
          alias?: string | null
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          device_group?: string | null
          enrolled_via_secret_id?: string | null
          enrollment_status?: Database["public"]["Enums"]["enrollment_status"]
          id?: string
          is_active?: boolean
          last_online?: string | null
          os?: string | null
          rustdesk_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "address_book_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_book_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_book_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "address_book_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asaas_events: {
        Row: {
          event_id: string
          event_type: string
          external_reference: string | null
          id: string
          payload: Json
          payment_id: string | null
          processed: boolean
          processed_at: string | null
          processing_result: string | null
          received_at: string
          subscription_id: string | null
        }
        Insert: {
          event_id: string
          event_type: string
          external_reference?: string | null
          id?: string
          payload: Json
          payment_id?: string | null
          processed?: boolean
          processed_at?: string | null
          processing_result?: string | null
          received_at?: string
          subscription_id?: string | null
        }
        Update: {
          event_id?: string
          event_type?: string
          external_reference?: string | null
          id?: string
          payload?: Json
          payment_id?: string | null
          processed?: boolean
          processed_at?: string | null
          processing_result?: string | null
          received_at?: string
          subscription_id?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          created_at: string
          created_by: string | null
          document: string | null
          document_type: Database["public"]["Enums"]["document_type"] | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document?: string | null
          document_type?: Database["public"]["Enums"]["document_type"] | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document?: string | null
          document_type?: Database["public"]["Enums"]["document_type"] | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      connection_logs: {
        Row: {
          address_book_id: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          last_heartbeat_at: string | null
          notes: string | null
          rustdesk_id: string
          session_end: string | null
          session_start: string
          status: Database["public"]["Enums"]["session_status"]
          technician_email: string | null
          technician_id: string | null
          technician_ip: unknown
          tenant_id: string
        }
        Insert: {
          address_book_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          last_heartbeat_at?: string | null
          notes?: string | null
          rustdesk_id: string
          session_end?: string | null
          session_start?: string
          status?: Database["public"]["Enums"]["session_status"]
          technician_email?: string | null
          technician_id?: string | null
          technician_ip?: unknown
          tenant_id: string
        }
        Update: {
          address_book_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          last_heartbeat_at?: string | null
          notes?: string | null
          rustdesk_id?: string
          session_end?: string | null
          session_start?: string
          status?: Database["public"]["Enums"]["session_status"]
          technician_email?: string | null
          technician_id?: string | null
          technician_ip?: unknown
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connection_logs_address_book_id_fkey"
            columns: ["address_book_id"]
            isOneToOne: false
            referencedRelation: "address_book"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_logs_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      device_favorites: {
        Row: {
          created_at: string
          device_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_favorites_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "address_book"
            referencedColumns: ["id"]
          },
        ]
      }
      device_marker_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          device_id: string
          marker_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_id: string
          marker_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_id?: string
          marker_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_marker_assignments_tenant_id_device_id_fkey"
            columns: ["tenant_id", "device_id"]
            isOneToOne: false
            referencedRelation: "address_book"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "device_marker_assignments_tenant_id_marker_id_fkey"
            columns: ["tenant_id", "marker_id"]
            isOneToOne: false
            referencedRelation: "device_markers"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      device_markers: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_markers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      device_secret_shares: {
        Row: {
          device_id: string | null
          id: string
          rustdesk_id: string
          shared_at: string
          shared_by: string | null
          shared_by_email: string | null
          source_device_id: string | null
          source_tenant_id: string | null
          source_tenant_name: string | null
          target_tenant_id: string | null
          target_tenant_name: string | null
        }
        Insert: {
          device_id?: string | null
          id?: string
          rustdesk_id: string
          shared_at?: string
          shared_by?: string | null
          shared_by_email?: string | null
          source_device_id?: string | null
          source_tenant_id?: string | null
          source_tenant_name?: string | null
          target_tenant_id?: string | null
          target_tenant_name?: string | null
        }
        Update: {
          device_id?: string | null
          id?: string
          rustdesk_id?: string
          shared_at?: string
          shared_by?: string | null
          shared_by_email?: string | null
          source_device_id?: string | null
          source_tenant_id?: string | null
          source_tenant_name?: string | null
          target_tenant_id?: string | null
          target_tenant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_secret_shares_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "address_book"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_secret_shares_shared_by_fkey"
            columns: ["shared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_secret_shares_source_device_id_fkey"
            columns: ["source_device_id"]
            isOneToOne: false
            referencedRelation: "address_book"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_secret_shares_source_tenant_id_fkey"
            columns: ["source_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_secret_shares_target_tenant_id_fkey"
            columns: ["target_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          created_at: string
          description: string | null
          is_default: boolean
          is_internal: boolean
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          is_default?: boolean
          is_internal?: boolean
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          is_default?: boolean
          is_internal?: boolean
          key?: string
          name?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          company: string | null
          consent: boolean
          created_at: string
          email: string
          id: string
          message: string | null
          name: string
          phone: string | null
          segment: string | null
          source: string
          status: Database["public"]["Enums"]["lead_status"]
          team_size: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          consent?: boolean
          created_at?: string
          email: string
          id?: string
          message?: string | null
          name: string
          phone?: string | null
          segment?: string | null
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          team_size?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          consent?: boolean
          created_at?: string
          email?: string
          id?: string
          message?: string | null
          name?: string
          phone?: string | null
          segment?: string | null
          source?: string
          status?: Database["public"]["Enums"]["lead_status"]
          team_size?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          is_custom: boolean
          max_concurrent_per_tech: number | null
          max_users: number | null
          name: string
          price_month_cents: number | null
          price_year_cents: number | null
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          is_custom?: boolean
          max_concurrent_per_tech?: number | null
          max_users?: number | null
          name: string
          price_month_cents?: number | null
          price_year_cents?: number | null
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          is_custom?: boolean
          max_concurrent_per_tech?: number | null
          max_users?: number | null
          name?: string
          price_month_cents?: number | null
          price_year_cents?: number | null
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_intents: {
        Row: {
          admin_email: string
          amount_cents: number
          asaas_checkout_id: string | null
          asaas_customer_id: string | null
          asaas_payment_id: string | null
          asaas_subscription_id: string | null
          billing_cycle: string
          cnpj: string
          company_name: string
          consent: boolean
          created_at: string
          failure_reason: string | null
          id: string
          phone: string | null
          plan_code: string
          provisioned_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          admin_email: string
          amount_cents: number
          asaas_checkout_id?: string | null
          asaas_customer_id?: string | null
          asaas_payment_id?: string | null
          asaas_subscription_id?: string | null
          billing_cycle: string
          cnpj: string
          company_name: string
          consent?: boolean
          created_at?: string
          failure_reason?: string | null
          id?: string
          phone?: string | null
          plan_code: string
          provisioned_at?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_email?: string
          amount_cents?: number
          asaas_checkout_id?: string | null
          asaas_customer_id?: string | null
          asaas_payment_id?: string | null
          asaas_subscription_id?: string | null
          billing_cycle?: string
          cnpj?: string
          company_name?: string
          consent?: boolean
          created_at?: string
          failure_reason?: string | null
          id?: string
          phone?: string | null
          plan_code?: string
          provisioned_at?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signup_intents_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "signup_intents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_features: {
        Row: {
          enabled: boolean
          enabled_by: string | null
          feature_key: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          enabled_by?: string | null
          feature_key: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          enabled_by?: string | null
          feature_key?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_features_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_features_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          alert_email: string | null
          created_at: string
          display_name: string | null
          log_retention_days: number
          notify_relay_quota: boolean
          prefs: Json
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          alert_email?: string | null
          created_at?: string
          display_name?: string | null
          log_retention_days?: number
          notify_relay_quota?: boolean
          prefs?: Json
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          alert_email?: string | null
          created_at?: string
          display_name?: string | null
          log_retention_days?: number
          notify_relay_quota?: boolean
          prefs?: Json
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          asaas_customer_id: string | null
          asaas_subscription_id: string | null
          billing_email: string | null
          cnpj: string | null
          created_at: string
          id: string
          is_active: boolean
          max_concurrent_per_tech: number | null
          name: string
          plan_code: string | null
          relay_quota_gb: number
          seat_limit: number
          slug: string | null
          updated_at: string
        }
        Insert: {
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          billing_email?: string | null
          cnpj?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          max_concurrent_per_tech?: number | null
          name: string
          plan_code?: string | null
          relay_quota_gb?: number
          seat_limit?: number
          slug?: string | null
          updated_at?: string
        }
        Update: {
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          billing_email?: string | null
          cnpj?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          max_concurrent_per_tech?: number | null
          name?: string
          plan_code?: string | null
          relay_quota_gb?: number
          seat_limit?: number
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      vps_metrics: {
        Row: {
          active_sessions: number | null
          captured_at: string
          cpu_iowait_pct: number | null
          cpu_pct: number | null
          cpu_steal_pct: number | null
          disk_pct: number | null
          disk_total_gb: number | null
          disk_used_gb: number | null
          hbbr_up: boolean | null
          hbbs_up: boolean | null
          host: string
          id: string
          load1: number | null
          load15: number | null
          load5: number | null
          mem_available_mb: number | null
          mem_pct: number | null
          mem_total_mb: number | null
          ncpu: number | null
          net_rx_bytes: number | null
          net_tx_bytes: number | null
          relay_mbps: number | null
          swap_used_mb: number | null
          uptime_seconds: number | null
        }
        Insert: {
          active_sessions?: number | null
          captured_at?: string
          cpu_iowait_pct?: number | null
          cpu_pct?: number | null
          cpu_steal_pct?: number | null
          disk_pct?: number | null
          disk_total_gb?: number | null
          disk_used_gb?: number | null
          hbbr_up?: boolean | null
          hbbs_up?: boolean | null
          host?: string
          id?: string
          load1?: number | null
          load15?: number | null
          load5?: number | null
          mem_available_mb?: number | null
          mem_pct?: number | null
          mem_total_mb?: number | null
          ncpu?: number | null
          net_rx_bytes?: number | null
          net_tx_bytes?: number | null
          relay_mbps?: number | null
          swap_used_mb?: number | null
          uptime_seconds?: number | null
        }
        Update: {
          active_sessions?: number | null
          captured_at?: string
          cpu_iowait_pct?: number | null
          cpu_pct?: number | null
          cpu_steal_pct?: number | null
          disk_pct?: number | null
          disk_total_gb?: number | null
          disk_used_gb?: number | null
          hbbr_up?: boolean | null
          hbbs_up?: boolean | null
          host?: string
          id?: string
          load1?: number | null
          load15?: number | null
          load5?: number | null
          mem_available_mb?: number | null
          mem_pct?: number | null
          mem_total_mb?: number | null
          ncpu?: number | null
          net_rx_bytes?: number | null
          net_tx_bytes?: number | null
          relay_mbps?: number | null
          swap_used_mb?: number | null
          uptime_seconds?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      v_agent_health: {
        Row: {
          abertas_agora: number | null
          address_book_id: string | null
          agente_vivo_24h: boolean | null
          falhas: number | null
          rustdesk_id: string | null
          sessoes_reais: number | null
          tenant_id: string | null
          tentativas_totais: number | null
          ultima_atividade: string | null
          ultimo_heartbeat: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connection_logs_address_book_id_fkey"
            columns: ["address_book_id"]
            isOneToOne: false
            referencedRelation: "address_book"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_external_access: {
        Row: {
          address_book_id: string | null
          created_at: string | null
          duration_seconds: number | null
          last_heartbeat_at: string | null
          rustdesk_id: string | null
          session_end: string | null
          session_start: string | null
          technician_ip: unknown
          tenant_id: string | null
        }
        Insert: {
          address_book_id?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          last_heartbeat_at?: string | null
          rustdesk_id?: string | null
          session_end?: string | null
          session_start?: string | null
          technician_ip?: unknown
          tenant_id?: string | null
        }
        Update: {
          address_book_id?: string | null
          created_at?: string | null
          duration_seconds?: number | null
          last_heartbeat_at?: string | null
          rustdesk_id?: string | null
          session_end?: string | null
          session_start?: string | null
          technician_ip?: unknown
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connection_logs_address_book_id_fkey"
            columns: ["address_book_id"]
            isOneToOne: false
            referencedRelation: "address_book"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sessions_summary: {
        Row: {
          acessos_externos: number | null
          dia: string | null
          dur_media_s: number | null
          dur_p50_s: number | null
          dur_p95_s: number | null
          fim_limpo: number | null
          quedas: number | null
          sessoes: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connection_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_device: { Args: { p_device_id: string }; Returns: undefined }
      assign_member: {
        Args: {
          p_role: Database["public"]["Enums"]["user_role"]
          p_tenant_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      assign_plan: {
        Args: {
          p_code: string
          p_conc_override?: number
          p_seat_override?: number
          p_tenant: string
        }
        Returns: {
          current_users: number
          max_concurrent_per_tech: number
          over_limit: boolean
          plan_code: string
          seat_limit: number
        }[]
      }
      claim_poll: {
        Args: { p_nonce_hash: string; p_rustdesk_id: string }
        Returns: string
      }
      claim_register: {
        Args: {
          p_agent_token_hash: string
          p_hostname?: string
          p_nonce_hash: string
          p_os?: string
          p_rustdesk_id: string
        }
        Returns: string
      }
      close_stale_sessions: { Args: never; Returns: number }
      create_enrollment_secret: {
        Args: { p_label?: string; p_tenant_id: string }
        Returns: {
          plaintext: string
          secret_id: string
        }[]
      }
      get_device_secret: {
        Args: { p_device_id: string }
        Returns: {
          ciphertext: string
          iv: string
          key_version: number
        }[]
      }
      log_connection_attempt: {
        Args: { p_address_book_id: string }
        Returns: string
      }
      provision_tenant: {
        Args: { p_admin_user_id: string; p_name: string; p_seat_limit?: number }
        Returns: string
      }
      redeem_claim: {
        Args: {
          p_actor: string
          p_alias?: string
          p_rustdesk_id: string
          p_tenant_id: string
        }
        Returns: {
          r_device_id: string
          r_hostname: string
          r_os: string
          r_was_inserted: boolean
        }[]
      }
      redeem_enrollment: {
        Args: {
          p_agent_token_hash: string
          p_alias?: string
          p_os?: string
          p_rustdesk_id: string
          p_secret_hash: string
        }
        Returns: {
          r_device_id: string
          r_status: Database["public"]["Enums"]["enrollment_status"]
          r_tenant_id: string
        }[]
      }
      reject_device: { Args: { p_device_id: string }; Returns: undefined }
      revoke_enrollment_secret: {
        Args: { p_secret_id: string }
        Returns: undefined
      }
      rl_hit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      set_device_active: {
        Args: { p_active: boolean; p_device_id: string }
        Returns: undefined
      }
      set_device_secret: {
        Args: {
          p_actor: string
          p_ciphertext: string
          p_device_id: string
          p_iv: string
          p_key_version: number
        }
        Returns: undefined
      }
      set_user_active: {
        Args: { p_active: boolean; p_user_id: string }
        Returns: undefined
      }
      tenant_has_feature: {
        Args: { p_feature_key: string; p_tenant_id: string }
        Returns: boolean
      }
      tenant_seat_usage: {
        Args: { p_tenant: string }
        Returns: {
          can_add: boolean
          limit_users: number
          used: number
        }[]
      }
      vps_metrics_series: {
        Args: { p_bucket?: string; p_since?: string }
        Returns: {
          amostras: number
          bucket: string
          cpu_avg: number
          cpu_max: number
          disk_pct_max: number
          load1_avg: number
          load1_max: number
          mem_avail_min_mb: number
          mem_pct_max: number
          net_avg_mbps: number
          steal_avg: number
          steal_max: number
        }[]
      }
    }
    Enums: {
      document_type: "cnpj" | "cpf"
      enrollment_status: "pending" | "approved" | "rejected"
      lead_status: "novo" | "em_contato" | "qualificado" | "ganho" | "perdido"
      session_status: "active" | "ended" | "failed"
      user_role: "super_admin" | "admin" | "head" | "tech"
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
  public: {
    Enums: {
      document_type: ["cnpj", "cpf"],
      enrollment_status: ["pending", "approved", "rejected"],
      lead_status: ["novo", "em_contato", "qualificado", "ganho", "perdido"],
      session_status: ["active", "ended", "failed"],
      user_role: ["super_admin", "admin", "head", "tech"],
    },
  },
} as const
