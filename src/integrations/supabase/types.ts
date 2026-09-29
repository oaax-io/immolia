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
      activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          agency_id: string | null
          created_at: string
          id: string
          metadata: Json
          related_id: string | null
          related_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          agency_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          related_id?: string | null
          related_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          agency_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          related_id?: string | null
          related_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      addon_entitlements: {
        Row: {
          addon_id: string
          created_at: string
          entitlement_key: string
        }
        Insert: {
          addon_id: string
          created_at?: string
          entitlement_key: string
        }
        Update: {
          addon_id?: string
          created_at?: string
          entitlement_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "addon_entitlements_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "addons"
            referencedColumns: ["id"]
          },
        ]
      }
      addon_limit_increments: {
        Row: {
          addon_id: string
          created_at: string
          increment_per_unit: number | null
          is_unlimited: boolean
          limit_key: string
        }
        Insert: {
          addon_id: string
          created_at?: string
          increment_per_unit?: number | null
          is_unlimited?: boolean
          limit_key: string
        }
        Update: {
          addon_id?: string
          created_at?: string
          increment_per_unit?: number | null
          is_unlimited?: boolean
          limit_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "addon_limit_increments_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "addons"
            referencedColumns: ["id"]
          },
        ]
      }
      addons: {
        Row: {
          billing_type: string
          created_at: string
          description: string | null
          id: string
          key: string
          name: string
          sort_order: number
          status: string
          stripe_price_id: string | null
          updated_at: string
        }
        Insert: {
          billing_type?: string
          created_at?: string
          description?: string | null
          id?: string
          key: string
          name: string
          sort_order?: number
          status?: string
          stripe_price_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_type?: string
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          name?: string
          sort_order?: number
          status?: string
          stripe_price_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agencies: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string | null
          status: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string | null
          status?: string | null
        }
        Relationships: []
      }
      agency_addons: {
        Row: {
          addon_id: string
          agency_id: string
          created_at: string
          ends_at: string | null
          id: string
          quantity: number
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          addon_id: string
          agency_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          quantity?: number
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          addon_id?: string
          agency_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          quantity?: number
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_addons_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "addons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_addons_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_memberships: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_memberships_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_modules: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          is_enabled: boolean
          is_entitled: boolean
          module: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_entitled?: boolean
          module: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_entitled?: boolean
          module?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_modules_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_trials: {
        Row: {
          agency_id: string
          created_at: string
          credit_operation_id: string | null
          credits_granted: number
          extensions: Json
          original_trial_end: string
          subscription_id: string | null
          trial_end: string
          trial_start: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          credit_operation_id?: string | null
          credits_granted?: number
          extensions?: Json
          original_trial_end: string
          subscription_id?: string | null
          trial_end: string
          trial_start: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          credit_operation_id?: string | null
          credits_granted?: number
          extensions?: Json
          original_trial_end?: string
          subscription_id?: string | null
          trial_end?: string
          trial_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_trials_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: true
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_trials_credit_operation_id_fkey"
            columns: ["credit_operation_id"]
            isOneToOne: false
            referencedRelation: "credit_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_trials_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          agency_id: string | null
          appointment_type: Database["public"]["Enums"]["appointment_type"]
          assigned_to: string | null
          client_id: string | null
          created_at: string
          ends_at: string
          id: string
          is_online: boolean
          lead_id: string | null
          location: string | null
          meeting_url: string | null
          notes: string | null
          owner_id: string | null
          property_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          title: string
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          ends_at: string
          id?: string
          is_online?: boolean
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          notes?: string | null
          owner_id?: string | null
          property_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          title: string
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          is_online?: boolean
          lead_id?: string | null
          location?: string | null
          meeting_url?: string | null
          notes?: string | null
          owner_id?: string | null
          property_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_holder: string | null
          agency_id: string | null
          bank_name: string | null
          bic: string | null
          created_at: string
          iban: string | null
          id: string
          is_active: boolean
          is_default: boolean
          label: string
          notes: string | null
          purpose: string | null
          updated_at: string
        }
        Insert: {
          account_holder?: string | null
          agency_id?: string | null
          bank_name?: string | null
          bic?: string | null
          created_at?: string
          iban?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
          notes?: string | null
          purpose?: string | null
          updated_at?: string
        }
        Update: {
          account_holder?: string | null
          agency_id?: string | null
          bank_name?: string | null
          bic?: string | null
          created_at?: string
          iban?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
          notes?: string | null
          purpose?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_package_shares: {
        Row: {
          attachment_count: number | null
          client_name: string | null
          created_at: string
          created_by: string | null
          dossier_id: string
          expires_at: string
          package_title: string | null
          size_bytes: number | null
          storage_path: string
          token: string
        }
        Insert: {
          attachment_count?: number | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          dossier_id: string
          expires_at: string
          package_title?: string | null
          size_bytes?: number | null
          storage_path: string
          token: string
        }
        Update: {
          attachment_count?: number | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          dossier_id?: string
          expires_at?: string
          package_title?: string | null
          size_bytes?: number | null
          storage_path?: string
          token?: string
        }
        Relationships: []
      }
      brand_settings: {
        Row: {
          accent_color: string | null
          agency_id: string | null
          app_accent_color: string | null
          app_primary_color: string | null
          app_secondary_color: string | null
          company_address: string | null
          company_email: string | null
          company_name: string | null
          company_website: string | null
          created_at: string
          favicon_url: string | null
          font_family: string | null
          footer_html: string | null
          header_html: string | null
          id: string
          login_subtitle: string | null
          login_title: string | null
          logo_alt_url: string | null
          logo_url: string | null
          primary_color: string | null
          secondary_color: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          agency_id?: string | null
          app_accent_color?: string | null
          app_primary_color?: string | null
          app_secondary_color?: string | null
          company_address?: string | null
          company_email?: string | null
          company_name?: string | null
          company_website?: string | null
          created_at?: string
          favicon_url?: string | null
          font_family?: string | null
          footer_html?: string | null
          header_html?: string | null
          id?: string
          login_subtitle?: string | null
          login_title?: string | null
          logo_alt_url?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          agency_id?: string | null
          app_accent_color?: string | null
          app_primary_color?: string | null
          app_secondary_color?: string | null
          company_address?: string | null
          company_email?: string | null
          company_name?: string | null
          company_website?: string | null
          created_at?: string
          favicon_url?: string | null
          font_family?: string | null
          footer_html?: string | null
          header_html?: string | null
          id?: string
          login_subtitle?: string | null
          login_title?: string | null
          logo_alt_url?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_settings_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_pins: {
        Row: {
          created_at: string
          id: string
          member_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          user_id?: string
        }
        Relationships: []
      }
      checklist_items: {
        Row: {
          assigned_to: string | null
          checklist_id: string
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          is_done: boolean
          sort_order: number
          title: string
        }
        Insert: {
          assigned_to?: string | null
          checklist_id: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_done?: boolean
          sort_order?: number
          title: string
        }
        Update: {
          assigned_to?: string | null
          checklist_id?: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_done?: boolean
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          agency_id: string | null
          created_at: string
          default_related_type: string | null
          description: string | null
          id: string
          items: Json
          key: string
          title: string
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          default_related_type?: string | null
          description?: string | null
          id?: string
          items?: Json
          key: string
          title: string
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          default_related_type?: string | null
          description?: string | null
          id?: string
          items?: Json
          key?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          agency_id: string | null
          created_at: string
          id: string
          related_id: string | null
          related_type: string | null
          template_key: string | null
          title: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          id?: string
          related_id?: string | null
          related_type?: string | null
          template_key?: string | null
          title: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          id?: string
          related_id?: string | null
          related_type?: string | null
          template_key?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assignees: {
        Row: {
          client_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_assignees_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_children: {
        Row: {
          birth_date: string | null
          client_id: string
          created_at: string
          full_name: string | null
          gender: string | null
          id: string
          is_shared_child: boolean
          sort_order: number
        }
        Insert: {
          birth_date?: string | null
          client_id: string
          created_at?: string
          full_name?: string | null
          gender?: string | null
          id?: string
          is_shared_child?: boolean
          sort_order?: number
        }
        Update: {
          birth_date?: string | null
          client_id?: string
          created_at?: string
          full_name?: string | null
          gender?: string | null
          id?: string
          is_shared_child?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_children_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_financial_items: {
        Row: {
          amount: number
          area: string
          available_as_equity: number | null
          category: string
          client_id: string
          created_at: string
          created_by: string | null
          details: Json
          id: string
          label: string | null
          notes: string | null
          periodicity: string
          person_client_id: string | null
          person_scope: string
          source: string
          updated_at: string
        }
        Insert: {
          amount?: number
          area: string
          available_as_equity?: number | null
          category?: string
          client_id: string
          created_at?: string
          created_by?: string | null
          details?: Json
          id?: string
          label?: string | null
          notes?: string | null
          periodicity?: string
          person_client_id?: string | null
          person_scope?: string
          source?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          area?: string
          available_as_equity?: number | null
          category?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          details?: Json
          id?: string
          label?: string | null
          notes?: string | null
          periodicity?: string
          person_client_id?: string | null
          person_scope?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_financial_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_financial_items_person_client_id_fkey"
            columns: ["person_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_pins: {
        Row: {
          client_id: string
          color: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          color?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          color?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_pins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_relationships: {
        Row: {
          client_id: string
          created_at: string
          id: string
          notes: string | null
          related_client_id: string
          relationship_type: Database["public"]["Enums"]["client_relationship_type"]
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          related_client_id: string
          relationship_type?: Database["public"]["Enums"]["client_relationship_type"]
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          related_client_id?: string
          relationship_type?: Database["public"]["Enums"]["client_relationship_type"]
        }
        Relationships: [
          {
            foreignKeyName: "client_relationships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_relationships_related_client_id_fkey"
            columns: ["related_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_roles: {
        Row: {
          client_id: string
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          related_id: string | null
          related_type: string | null
          role_type: Database["public"]["Enums"]["client_role_type"]
          start_date: string | null
          status: Database["public"]["Enums"]["client_role_status"]
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          related_id?: string | null
          related_type?: string | null
          role_type: Database["public"]["Enums"]["client_role_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["client_role_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          related_id?: string | null
          related_type?: string | null
          role_type?: Database["public"]["Enums"]["client_role_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["client_role_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_roles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_search_profiles: {
        Row: {
          area_max: number | null
          area_min: number | null
          budget_max: number | null
          budget_min: number | null
          client_id: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          listing_type: Database["public"]["Enums"]["listing_type"] | null
          notes: string | null
          preferred_cities: string[] | null
          preferred_property_types:
            | Database["public"]["Enums"]["property_type"][]
            | null
          role_type: Database["public"]["Enums"]["client_role_type"]
          rooms_min: number | null
          updated_at: string
          usage_types: string[] | null
          yield_target: number | null
        }
        Insert: {
          area_max?: number | null
          area_min?: number | null
          budget_max?: number | null
          budget_min?: number | null
          client_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          listing_type?: Database["public"]["Enums"]["listing_type"] | null
          notes?: string | null
          preferred_cities?: string[] | null
          preferred_property_types?:
            | Database["public"]["Enums"]["property_type"][]
            | null
          role_type?: Database["public"]["Enums"]["client_role_type"]
          rooms_min?: number | null
          updated_at?: string
          usage_types?: string[] | null
          yield_target?: number | null
        }
        Update: {
          area_max?: number | null
          area_min?: number | null
          budget_max?: number | null
          budget_min?: number | null
          client_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          listing_type?: Database["public"]["Enums"]["listing_type"] | null
          notes?: string | null
          preferred_cities?: string[] | null
          preferred_property_types?:
            | Database["public"]["Enums"]["property_type"][]
            | null
          role_type?: Database["public"]["Enums"]["client_role_type"]
          rooms_min?: number | null
          updated_at?: string
          usage_types?: string[] | null
          yield_target?: number | null
        }
        Relationships: []
      }
      client_self_disclosures: {
        Row: {
          additional_income: number | null
          advisor_id: string | null
          alimony_expense: number | null
          annual_net_salary: number | null
          benchmark_status: string | null
          birth_country: string | null
          birth_date: string | null
          birth_name: string | null
          birth_place: string | null
          city: string | null
          client_id: string
          country: string | null
          created_at: string
          credit_expense: number | null
          disclosure_date: string | null
          disclosure_place: string | null
          email: string | null
          employed_as: string | null
          employed_since: string | null
          employer_address: string | null
          employer_name: string | null
          employer_phone: string | null
          employment_status: string | null
          first_name: string | null
          health_insurance_expense: number | null
          id: string
          income_job_two: number | null
          income_rental: number | null
          internal_notes: string | null
          last_name: string | null
          leasing_expense: number | null
          life_insurance_expense: number | null
          living_costs_expense: number | null
          marital_status: string | null
          miscellaneous_expense: number | null
          mobile: string | null
          mortgage_expense: number | null
          nationality: string | null
          phone: string | null
          postal_code: string | null
          property_insurance_expense: number | null
          rent_expense: number | null
          reserve_ratio: number | null
          reserve_total: number | null
          resident_since: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          salary_net_monthly: number | null
          salary_type: string | null
          salutation: string | null
          sent_at: string | null
          status: string
          street: string | null
          street_number: string | null
          submitted_at: string | null
          tax_id_ch: string | null
          taxes_expense: number | null
          telecom_expense: number | null
          title: string | null
          total_expenses_monthly: number | null
          total_income_monthly: number | null
          updated_at: string
          utilities_expense: number | null
        }
        Insert: {
          additional_income?: number | null
          advisor_id?: string | null
          alimony_expense?: number | null
          annual_net_salary?: number | null
          benchmark_status?: string | null
          birth_country?: string | null
          birth_date?: string | null
          birth_name?: string | null
          birth_place?: string | null
          city?: string | null
          client_id: string
          country?: string | null
          created_at?: string
          credit_expense?: number | null
          disclosure_date?: string | null
          disclosure_place?: string | null
          email?: string | null
          employed_as?: string | null
          employed_since?: string | null
          employer_address?: string | null
          employer_name?: string | null
          employer_phone?: string | null
          employment_status?: string | null
          first_name?: string | null
          health_insurance_expense?: number | null
          id?: string
          income_job_two?: number | null
          income_rental?: number | null
          internal_notes?: string | null
          last_name?: string | null
          leasing_expense?: number | null
          life_insurance_expense?: number | null
          living_costs_expense?: number | null
          marital_status?: string | null
          miscellaneous_expense?: number | null
          mobile?: string | null
          mortgage_expense?: number | null
          nationality?: string | null
          phone?: string | null
          postal_code?: string | null
          property_insurance_expense?: number | null
          rent_expense?: number | null
          reserve_ratio?: number | null
          reserve_total?: number | null
          resident_since?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          salary_net_monthly?: number | null
          salary_type?: string | null
          salutation?: string | null
          sent_at?: string | null
          status?: string
          street?: string | null
          street_number?: string | null
          submitted_at?: string | null
          tax_id_ch?: string | null
          taxes_expense?: number | null
          telecom_expense?: number | null
          title?: string | null
          total_expenses_monthly?: number | null
          total_income_monthly?: number | null
          updated_at?: string
          utilities_expense?: number | null
        }
        Update: {
          additional_income?: number | null
          advisor_id?: string | null
          alimony_expense?: number | null
          annual_net_salary?: number | null
          benchmark_status?: string | null
          birth_country?: string | null
          birth_date?: string | null
          birth_name?: string | null
          birth_place?: string | null
          city?: string | null
          client_id?: string
          country?: string | null
          created_at?: string
          credit_expense?: number | null
          disclosure_date?: string | null
          disclosure_place?: string | null
          email?: string | null
          employed_as?: string | null
          employed_since?: string | null
          employer_address?: string | null
          employer_name?: string | null
          employer_phone?: string | null
          employment_status?: string | null
          first_name?: string | null
          health_insurance_expense?: number | null
          id?: string
          income_job_two?: number | null
          income_rental?: number | null
          internal_notes?: string | null
          last_name?: string | null
          leasing_expense?: number | null
          life_insurance_expense?: number | null
          living_costs_expense?: number | null
          marital_status?: string | null
          miscellaneous_expense?: number | null
          mobile?: string | null
          mortgage_expense?: number | null
          nationality?: string | null
          phone?: string | null
          postal_code?: string | null
          property_insurance_expense?: number | null
          rent_expense?: number | null
          reserve_ratio?: number | null
          reserve_total?: number | null
          resident_since?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          salary_net_monthly?: number | null
          salary_type?: string | null
          salutation?: string | null
          sent_at?: string | null
          status?: string
          street?: string | null
          street_number?: string | null
          submitted_at?: string | null
          tax_id_ch?: string | null
          taxes_expense?: number | null
          telecom_expense?: number | null
          title?: string | null
          total_expenses_monthly?: number | null
          total_income_monthly?: number | null
          updated_at?: string
          utilities_expense?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_self_disclosures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          agency_id: string | null
          archived_at: string | null
          area_max: number | null
          area_min: number | null
          assigned_to: string | null
          budget_max: number | null
          budget_min: number | null
          city: string | null
          client_type: Database["public"]["Enums"]["client_type"]
          company_name: string | null
          contact_first_name: string | null
          contact_last_name: string | null
          country: string | null
          created_at: string
          email: string | null
          entity_type: string
          equity: number | null
          financing_status: string | null
          full_name: string
          id: string
          is_archived: boolean
          is_family_head: boolean
          notes: string | null
          owner_id: string | null
          phone: string | null
          postal_code: string | null
          preferred_cities: string[] | null
          preferred_listing: Database["public"]["Enums"]["listing_type"] | null
          preferred_locations: string[] | null
          preferred_property_types:
            | Database["public"]["Enums"]["property_type"][]
            | null
          preferred_types: Database["public"]["Enums"]["property_type"][] | null
          rooms_min: number | null
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          agency_id?: string | null
          archived_at?: string | null
          area_max?: number | null
          area_min?: number | null
          assigned_to?: string | null
          budget_max?: number | null
          budget_min?: number | null
          city?: string | null
          client_type?: Database["public"]["Enums"]["client_type"]
          company_name?: string | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          entity_type?: string
          equity?: number | null
          financing_status?: string | null
          full_name: string
          id?: string
          is_archived?: boolean
          is_family_head?: boolean
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          postal_code?: string | null
          preferred_cities?: string[] | null
          preferred_listing?: Database["public"]["Enums"]["listing_type"] | null
          preferred_locations?: string[] | null
          preferred_property_types?:
            | Database["public"]["Enums"]["property_type"][]
            | null
          preferred_types?:
            | Database["public"]["Enums"]["property_type"][]
            | null
          rooms_min?: number | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          agency_id?: string | null
          archived_at?: string | null
          area_max?: number | null
          area_min?: number | null
          assigned_to?: string | null
          budget_max?: number | null
          budget_min?: number | null
          city?: string | null
          client_type?: Database["public"]["Enums"]["client_type"]
          company_name?: string | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          entity_type?: string
          equity?: number | null
          financing_status?: string | null
          full_name?: string
          id?: string
          is_archived?: boolean
          is_family_head?: boolean
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          postal_code?: string | null
          preferred_cities?: string[] | null
          preferred_listing?: Database["public"]["Enums"]["listing_type"] | null
          preferred_locations?: string[] | null
          preferred_property_types?:
            | Database["public"]["Enums"]["property_type"][]
            | null
          preferred_types?:
            | Database["public"]["Enums"]["property_type"][]
            | null
          rooms_min?: number | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_record_splits: {
        Row: {
          agency_id: string | null
          commission_record_id: string
          created_at: string
          gross_share: number
          id: string
          payout_amount: number
          payout_rate: number
          role: string
          split_percent: number
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          commission_record_id: string
          created_at?: string
          gross_share: number
          id?: string
          payout_amount: number
          payout_rate: number
          role: string
          split_percent: number
          user_id: string
        }
        Update: {
          agency_id?: string | null
          commission_record_id?: string
          created_at?: string
          gross_share?: number
          id?: string
          payout_amount?: number
          payout_rate?: number
          role?: string
          split_percent?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_record_splits_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_record_splits_commission_record_id_fkey"
            columns: ["commission_record_id"]
            isOneToOne: false
            referencedRelation: "commission_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_record_splits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_records: {
        Row: {
          agency_id: string | null
          booked_at: string
          client_id: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          credited_reservation_record_id: string | null
          currency: string
          description: string | null
          financing_amount: number | null
          financing_dossier_id: string | null
          gross_amount: number
          id: string
          mandate_id: string | null
          property_id: string
          record_type: string
          reservation_id: string | null
          sale_price: number | null
          status: string
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          booked_at?: string
          client_id?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          credited_reservation_record_id?: string | null
          currency?: string
          description?: string | null
          financing_amount?: number | null
          financing_dossier_id?: string | null
          gross_amount: number
          id?: string
          mandate_id?: string | null
          property_id: string
          record_type: string
          reservation_id?: string | null
          sale_price?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          booked_at?: string
          client_id?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          credited_reservation_record_id?: string | null
          currency?: string
          description?: string | null
          financing_amount?: number | null
          financing_dossier_id?: string | null
          gross_amount?: number
          id?: string
          mandate_id?: string | null
          property_id?: string
          record_type?: string
          reservation_id?: string | null
          sale_price?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_records_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_records_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_records_credited_reservation_record_id_fkey"
            columns: ["credited_reservation_record_id"]
            isOneToOne: false
            referencedRelation: "commission_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_records_financing_dossier_id_fkey"
            columns: ["financing_dossier_id"]
            isOneToOne: false
            referencedRelation: "financing_dossiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_records_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_records_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_records_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_targets: {
        Row: {
          agency_id: string | null
          created_at: string
          id: string
          notes: string | null
          period_end: string
          period_start: string
          period_type: string
          target_amount: number | null
          target_deals: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          period_type: string
          target_amount?: number | null
          target_deals?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          period_type?: string
          target_amount?: number | null
          target_deals?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_targets_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_targets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company: {
        Row: {
          address: string | null
          agency_id: string
          city: string | null
          commercial_register: string | null
          country: string | null
          created_at: string
          default_place: string | null
          default_signatory_name: string | null
          default_signatory_role: string | null
          email: string | null
          id: boolean
          legal_name: string | null
          logo_url: string | null
          name: string
          phone: string | null
          postal_code: string | null
          row_id: string
          uid_number: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          agency_id: string
          city?: string | null
          commercial_register?: string | null
          country?: string | null
          created_at?: string
          default_place?: string | null
          default_signatory_name?: string | null
          default_signatory_role?: string | null
          email?: string | null
          id?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          row_id?: string
          uid_number?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          agency_id?: string
          city?: string | null
          commercial_register?: string | null
          country?: string | null
          created_at?: string
          default_place?: string | null
          default_signatory_name?: string | null
          default_signatory_role?: string | null
          email?: string | null
          id?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          row_id?: string
          uid_number?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      credit_action_costs: {
        Row: {
          action_key: string
          active: boolean
          category: string
          created_at: string
          credit_cost: number | null
          description: string | null
          id: string
          name: string
          settlement_policy: string | null
          updated_at: string
        }
        Insert: {
          action_key: string
          active?: boolean
          category: string
          created_at?: string
          credit_cost?: number | null
          description?: string | null
          id?: string
          name: string
          settlement_policy?: string | null
          updated_at?: string
        }
        Update: {
          action_key?: string
          active?: boolean
          category?: string
          created_at?: string
          credit_cost?: number | null
          description?: string | null
          id?: string
          name?: string
          settlement_policy?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          action_key: string | null
          agency_id: string
          bucket: string
          created_at: string
          created_by: string | null
          delta: number
          expires_at: string | null
          id: string
          lot_id: string | null
          metadata: Json
          operation_id: string | null
          reference_id: string | null
          reference_type: string | null
          source: string
          wallet_id: string
        }
        Insert: {
          action_key?: string | null
          agency_id: string
          bucket: string
          created_at?: string
          created_by?: string | null
          delta: number
          expires_at?: string | null
          id?: string
          lot_id?: string | null
          metadata?: Json
          operation_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          source: string
          wallet_id: string
        }
        Update: {
          action_key?: string | null
          agency_id?: string
          bucket?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          expires_at?: string | null
          id?: string
          lot_id?: string | null
          metadata?: Json
          operation_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          source?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "credit_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_operations: {
        Row: {
          action_key: string | null
          agency_id: string
          amount: number
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          kind: string
          reason: string | null
          refund_of: string | null
        }
        Insert: {
          action_key?: string | null
          agency_id: string
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          kind: string
          reason?: string | null
          refund_of?: string | null
        }
        Update: {
          action_key?: string | null
          agency_id?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: string
          reason?: string | null
          refund_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_operations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_operations_refund_of_fkey"
            columns: ["refund_of"]
            isOneToOne: false
            referencedRelation: "credit_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_packages: {
        Row: {
          created_at: string
          credits: number | null
          currency: string
          id: string
          key: string
          name: string
          price_amount: number | null
          sort_order: number
          status: string
          stripe_price_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits?: number | null
          currency?: string
          id?: string
          key: string
          name: string
          price_amount?: number | null
          sort_order?: number
          status?: string
          stripe_price_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits?: number | null
          currency?: string
          id?: string
          key?: string
          name?: string
          price_amount?: number | null
          sort_order?: number
          status?: string
          stripe_price_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      credit_reservations: {
        Row: {
          action_key: string
          agency_id: string
          amount: number
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          idempotency_key: string
          operation_id: string
          reference_id: string | null
          reference_type: string | null
          release_operation_id: string | null
          release_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          action_key: string
          agency_id: string
          amount: number
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          idempotency_key: string
          operation_id: string
          reference_id?: string | null
          reference_type?: string | null
          release_operation_id?: string | null
          release_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          action_key?: string
          agency_id?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          operation_id?: string
          reference_id?: string | null
          reference_type?: string | null
          release_operation_id?: string | null
          release_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_reservations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_reservations_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "credit_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_reservations_release_operation_id_fkey"
            columns: ["release_operation_id"]
            isOneToOne: false
            referencedRelation: "credit_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_wallets: {
        Row: {
          agency_id: string
          consumption_order: string[] | null
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          consumption_order?: string[] | null
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          consumption_order?: string[] | null
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_wallets_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: true
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          agency_id: string | null
          attachments: Json
          body: string
          created_at: string
          id: string
          mentions: Json
          read_at: string | null
          recipient_id: string
          sender_id: string
        }
        Insert: {
          agency_id?: string | null
          attachments?: Json
          body: string
          created_at?: string
          id?: string
          mentions?: Json
          read_at?: string | null
          recipient_id: string
          sender_id: string
        }
        Update: {
          agency_id?: string | null
          attachments?: Json
          body?: string
          created_at?: string
          id?: string
          mentions?: Json
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          agency_id: string | null
          allow_custom_css: boolean
          category: string | null
          content: string
          created_at: string
          custom_css: string | null
          default_variables: Json
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          is_system: boolean
          layout_type: string
          name: string
          source_template_id: string | null
          type: Database["public"]["Enums"]["document_type"]
          updated_at: string
          variables: Json
        }
        Insert: {
          agency_id?: string | null
          allow_custom_css?: boolean
          category?: string | null
          content: string
          created_at?: string
          custom_css?: string | null
          default_variables?: Json
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_system?: boolean
          layout_type?: string
          name: string
          source_template_id?: string | null
          type?: Database["public"]["Enums"]["document_type"]
          updated_at?: string
          variables?: Json
        }
        Update: {
          agency_id?: string | null
          allow_custom_css?: boolean
          category?: string | null
          content?: string
          created_at?: string
          custom_css?: string | null
          default_variables?: Json
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_system?: boolean
          layout_type?: string
          name?: string
          source_template_id?: string | null
          type?: Database["public"]["Enums"]["document_type"]
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          agency_id: string | null
          created_at: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string | null
          file_url: string
          id: string
          mime_type: string | null
          notes: string | null
          related_id: string
          related_type: string
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string | null
          file_url: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          related_id: string
          related_type: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string | null
          file_url?: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          related_id?: string
          related_type?: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          agency_id: string | null
          assigned_to: string | null
          attachments: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          page_url: string | null
          priority: Database["public"]["Enums"]["feedback_priority"]
          resolved_at: string | null
          status: Database["public"]["Enums"]["feedback_status"]
          title: string
          type: Database["public"]["Enums"]["feedback_type"]
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          assigned_to?: string | null
          attachments?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          page_url?: string | null
          priority?: Database["public"]["Enums"]["feedback_priority"]
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          title: string
          type?: Database["public"]["Enums"]["feedback_type"]
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          assigned_to?: string | null
          attachments?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          page_url?: string | null
          priority?: Database["public"]["Enums"]["feedback_priority"]
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          title?: string
          type?: Database["public"]["Enums"]["feedback_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_comments: {
        Row: {
          attachments: Json
          author_id: string | null
          body: string
          created_at: string
          feedback_id: string
          id: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          body: string
          created_at?: string
          feedback_id: string
          id?: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          body?: string
          created_at?: string
          feedback_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_comments_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_votes: {
        Row: {
          created_at: string
          feedback_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feedback_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          feedback_id?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      financing_checklist_items: {
        Row: {
          created_at: string
          document_id: string | null
          dossier_id: string
          id: string
          is_present: boolean
          item_key: string
          label: string
          note: string | null
          section: Database["public"]["Enums"]["financing_checklist_section"]
          sort_order: number
          status: Database["public"]["Enums"]["financing_checklist_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          dossier_id: string
          id?: string
          is_present?: boolean
          item_key: string
          label: string
          note?: string | null
          section: Database["public"]["Enums"]["financing_checklist_section"]
          sort_order?: number
          status?: Database["public"]["Enums"]["financing_checklist_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          dossier_id?: string
          id?: string
          is_present?: boolean
          item_key?: string
          label?: string
          note?: string | null
          section?: Database["public"]["Enums"]["financing_checklist_section"]
          sort_order?: number
          status?: Database["public"]["Enums"]["financing_checklist_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financing_checklist_items_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "financing_dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_dossiers: {
        Row: {
          additional_co_applicants: Json
          affordability_ratio: number | null
          agency_id: string | null
          amortisation_yearly: number | null
          ancillary_costs_yearly: number | null
          bank_contact: string | null
          bank_decision_at: string | null
          bank_email: string | null
          bank_name: string | null
          bank_notes: string | null
          bank_phone: string | null
          bank_type: string | null
          calculated_interest_rate: number | null
          client_id: string
          co_applicant_client_id: string | null
          co_applicant_eigenkapital: number | null
          co_applicant_einkommen: number | null
          co_applicant_pk_anteil: number | null
          co_applicant_role: string | null
          completion_percent: number
          construction_additional_costs: number | null
          construction_costs: number | null
          created_at: string
          current_bank: string | null
          data_source: string | null
          dossier_status:
            | Database["public"]["Enums"]["financing_dossier_status"]
            | null
          eigenkapital_kombiniert: number | null
          einkommen_kombiniert: number | null
          existing_mortgage: number | null
          existing_mortgage_2: number | null
          financing_modules: string[]
          financing_type: Database["public"]["Enums"]["financing_type"] | null
          gross_income_yearly: number | null
          id: string
          interest_rate_current: number | null
          interest_rate_current_2: number | null
          interest_rate_expiry: string | null
          interest_rate_expiry_2: string | null
          internal_notes: string | null
          land_price: number | null
          loan_to_value_ratio: number | null
          monthly_obligations: number | null
          new_total_mortgage: number | null
          own_funds_gift: number | null
          own_funds_inheritance: number | null
          own_funds_liquid: number | null
          own_funds_pension_fund: number | null
          own_funds_pillar_3a: number | null
          own_funds_private_loan: number | null
          own_funds_total: number | null
          own_funds_vested_benefits: number | null
          pk_anteil_kombiniert: number | null
          property_id: string | null
          property_snapshot: Json | null
          property_value: number | null
          purchase_additional_costs: number | null
          purchase_price: number | null
          quick_check_reasons: Json | null
          quick_check_status:
            | Database["public"]["Enums"]["financing_quick_check_status"]
            | null
          refi_purpose: string | null
          renovation_costs: number | null
          renovation_description: string | null
          renovation_own_work: number | null
          renovation_value_increase: number | null
          requested_increase: number | null
          requested_mortgage: number | null
          section_additional: Json
          section_affordability: Json
          section_customer: Json
          section_financing: Json
          section_income: Json
          section_property_docs: Json
          section_quality_check: Json
          section_rejection_reasons: Json
          section_self_employed: Json
          section_tax: Json
          status: Database["public"]["Enums"]["financing_status"]
          submitted_at: string | null
          submitted_to_bank_at: string | null
          title: string | null
          total_investment: number | null
          updated_at: string
          usage_type: string | null
          valuation_external_id: string | null
          valuation_price_per_sqm: number | null
          valuation_provider: string | null
          valuation_result: Json | null
          valuation_status: string | null
        }
        Insert: {
          additional_co_applicants?: Json
          affordability_ratio?: number | null
          agency_id?: string | null
          amortisation_yearly?: number | null
          ancillary_costs_yearly?: number | null
          bank_contact?: string | null
          bank_decision_at?: string | null
          bank_email?: string | null
          bank_name?: string | null
          bank_notes?: string | null
          bank_phone?: string | null
          bank_type?: string | null
          calculated_interest_rate?: number | null
          client_id: string
          co_applicant_client_id?: string | null
          co_applicant_eigenkapital?: number | null
          co_applicant_einkommen?: number | null
          co_applicant_pk_anteil?: number | null
          co_applicant_role?: string | null
          completion_percent?: number
          construction_additional_costs?: number | null
          construction_costs?: number | null
          created_at?: string
          current_bank?: string | null
          data_source?: string | null
          dossier_status?:
            | Database["public"]["Enums"]["financing_dossier_status"]
            | null
          eigenkapital_kombiniert?: number | null
          einkommen_kombiniert?: number | null
          existing_mortgage?: number | null
          existing_mortgage_2?: number | null
          financing_modules?: string[]
          financing_type?: Database["public"]["Enums"]["financing_type"] | null
          gross_income_yearly?: number | null
          id?: string
          interest_rate_current?: number | null
          interest_rate_current_2?: number | null
          interest_rate_expiry?: string | null
          interest_rate_expiry_2?: string | null
          internal_notes?: string | null
          land_price?: number | null
          loan_to_value_ratio?: number | null
          monthly_obligations?: number | null
          new_total_mortgage?: number | null
          own_funds_gift?: number | null
          own_funds_inheritance?: number | null
          own_funds_liquid?: number | null
          own_funds_pension_fund?: number | null
          own_funds_pillar_3a?: number | null
          own_funds_private_loan?: number | null
          own_funds_total?: number | null
          own_funds_vested_benefits?: number | null
          pk_anteil_kombiniert?: number | null
          property_id?: string | null
          property_snapshot?: Json | null
          property_value?: number | null
          purchase_additional_costs?: number | null
          purchase_price?: number | null
          quick_check_reasons?: Json | null
          quick_check_status?:
            | Database["public"]["Enums"]["financing_quick_check_status"]
            | null
          refi_purpose?: string | null
          renovation_costs?: number | null
          renovation_description?: string | null
          renovation_own_work?: number | null
          renovation_value_increase?: number | null
          requested_increase?: number | null
          requested_mortgage?: number | null
          section_additional?: Json
          section_affordability?: Json
          section_customer?: Json
          section_financing?: Json
          section_income?: Json
          section_property_docs?: Json
          section_quality_check?: Json
          section_rejection_reasons?: Json
          section_self_employed?: Json
          section_tax?: Json
          status?: Database["public"]["Enums"]["financing_status"]
          submitted_at?: string | null
          submitted_to_bank_at?: string | null
          title?: string | null
          total_investment?: number | null
          updated_at?: string
          usage_type?: string | null
          valuation_external_id?: string | null
          valuation_price_per_sqm?: number | null
          valuation_provider?: string | null
          valuation_result?: Json | null
          valuation_status?: string | null
        }
        Update: {
          additional_co_applicants?: Json
          affordability_ratio?: number | null
          agency_id?: string | null
          amortisation_yearly?: number | null
          ancillary_costs_yearly?: number | null
          bank_contact?: string | null
          bank_decision_at?: string | null
          bank_email?: string | null
          bank_name?: string | null
          bank_notes?: string | null
          bank_phone?: string | null
          bank_type?: string | null
          calculated_interest_rate?: number | null
          client_id?: string
          co_applicant_client_id?: string | null
          co_applicant_eigenkapital?: number | null
          co_applicant_einkommen?: number | null
          co_applicant_pk_anteil?: number | null
          co_applicant_role?: string | null
          completion_percent?: number
          construction_additional_costs?: number | null
          construction_costs?: number | null
          created_at?: string
          current_bank?: string | null
          data_source?: string | null
          dossier_status?:
            | Database["public"]["Enums"]["financing_dossier_status"]
            | null
          eigenkapital_kombiniert?: number | null
          einkommen_kombiniert?: number | null
          existing_mortgage?: number | null
          existing_mortgage_2?: number | null
          financing_modules?: string[]
          financing_type?: Database["public"]["Enums"]["financing_type"] | null
          gross_income_yearly?: number | null
          id?: string
          interest_rate_current?: number | null
          interest_rate_current_2?: number | null
          interest_rate_expiry?: string | null
          interest_rate_expiry_2?: string | null
          internal_notes?: string | null
          land_price?: number | null
          loan_to_value_ratio?: number | null
          monthly_obligations?: number | null
          new_total_mortgage?: number | null
          own_funds_gift?: number | null
          own_funds_inheritance?: number | null
          own_funds_liquid?: number | null
          own_funds_pension_fund?: number | null
          own_funds_pillar_3a?: number | null
          own_funds_private_loan?: number | null
          own_funds_total?: number | null
          own_funds_vested_benefits?: number | null
          pk_anteil_kombiniert?: number | null
          property_id?: string | null
          property_snapshot?: Json | null
          property_value?: number | null
          purchase_additional_costs?: number | null
          purchase_price?: number | null
          quick_check_reasons?: Json | null
          quick_check_status?:
            | Database["public"]["Enums"]["financing_quick_check_status"]
            | null
          refi_purpose?: string | null
          renovation_costs?: number | null
          renovation_description?: string | null
          renovation_own_work?: number | null
          renovation_value_increase?: number | null
          requested_increase?: number | null
          requested_mortgage?: number | null
          section_additional?: Json
          section_affordability?: Json
          section_customer?: Json
          section_financing?: Json
          section_income?: Json
          section_property_docs?: Json
          section_quality_check?: Json
          section_rejection_reasons?: Json
          section_self_employed?: Json
          section_tax?: Json
          status?: Database["public"]["Enums"]["financing_status"]
          submitted_at?: string | null
          submitted_to_bank_at?: string | null
          title?: string | null
          total_investment?: number | null
          updated_at?: string
          usage_type?: string | null
          valuation_external_id?: string | null
          valuation_price_per_sqm?: number | null
          valuation_provider?: string | null
          valuation_result?: Json | null
          valuation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financing_dossiers_co_applicant_client_id_fkey"
            columns: ["co_applicant_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_dossiers_scenarios: {
        Row: {
          belehnung: number | null
          bezeichnung: string
          bruttoeinkommen: number | null
          created_at: string
          dossier_id: string
          eigenmittel: number | null
          eigenmittelquote: number | null
          harte_eigenmittel: number | null
          hypothek: number | null
          id: string
          kalk_zinssatz: number | null
          kaufpreis: number | null
          status: string | null
          tragbarkeit: number | null
        }
        Insert: {
          belehnung?: number | null
          bezeichnung: string
          bruttoeinkommen?: number | null
          created_at?: string
          dossier_id: string
          eigenmittel?: number | null
          eigenmittelquote?: number | null
          harte_eigenmittel?: number | null
          hypothek?: number | null
          id?: string
          kalk_zinssatz?: number | null
          kaufpreis?: number | null
          status?: string | null
          tragbarkeit?: number | null
        }
        Update: {
          belehnung?: number | null
          bezeichnung?: string
          bruttoeinkommen?: number | null
          created_at?: string
          dossier_id?: string
          eigenmittel?: number | null
          eigenmittelquote?: number | null
          harte_eigenmittel?: number | null
          hypothek?: number | null
          id?: string
          kalk_zinssatz?: number | null
          kaufpreis?: number | null
          status?: string | null
          tragbarkeit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "financing_dossiers_scenarios_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "financing_dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_links: {
        Row: {
          agency_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          dossier_id: string | null
          expires_at: string
          id: string
          link_type: string
          token: string
          used_at: string | null
        }
        Insert: {
          agency_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          dossier_id?: string | null
          expires_at?: string
          id?: string
          link_type?: string
          token: string
          used_at?: string | null
        }
        Update: {
          agency_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          dossier_id?: string | null
          expires_at?: string
          id?: string
          link_type?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financing_links_dossier_id_fkey"
            columns: ["dossier_id"]
            isOneToOne: false
            referencedRelation: "financing_dossiers"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_profiles: {
        Row: {
          approval_status: string | null
          assigned_to: string | null
          bank_contact: string | null
          bank_email: string | null
          bank_name: string | null
          bank_phone: string | null
          bank_type: string | null
          budget: number | null
          client_id: string
          created_at: string
          equity: number | null
          id: string
          income: number | null
          internal_notes: string | null
          notes: string | null
          profile_status: string
          updated_at: string
        }
        Insert: {
          approval_status?: string | null
          assigned_to?: string | null
          bank_contact?: string | null
          bank_email?: string | null
          bank_name?: string | null
          bank_phone?: string | null
          bank_type?: string | null
          budget?: number | null
          client_id: string
          created_at?: string
          equity?: number | null
          id?: string
          income?: number | null
          internal_notes?: string | null
          notes?: string | null
          profile_status?: string
          updated_at?: string
        }
        Update: {
          approval_status?: string | null
          assigned_to?: string | null
          bank_contact?: string | null
          bank_email?: string | null
          bank_name?: string | null
          bank_phone?: string | null
          bank_type?: string | null
          budget?: number | null
          client_id?: string
          created_at?: string
          equity?: number | null
          id?: string
          income?: number | null
          internal_notes?: string | null
          notes?: string | null
          profile_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financing_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          agency_id: string | null
          created_at: string
          created_by: string | null
          document_type: string | null
          esign_envelope_id: string | null
          esign_provider: string | null
          esign_signed_at: string | null
          esign_status: string | null
          esign_url: string | null
          file_url: string | null
          html_content: string | null
          id: string
          pdf_generated_at: string | null
          pdf_provider: string | null
          pdf_url: string | null
          recipients: Json
          related_id: string | null
          related_type: string | null
          sent_at: string | null
          status: string
          template_id: string | null
          title: string | null
          variables: Json
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          created_by?: string | null
          document_type?: string | null
          esign_envelope_id?: string | null
          esign_provider?: string | null
          esign_signed_at?: string | null
          esign_status?: string | null
          esign_url?: string | null
          file_url?: string | null
          html_content?: string | null
          id?: string
          pdf_generated_at?: string | null
          pdf_provider?: string | null
          pdf_url?: string | null
          recipients?: Json
          related_id?: string | null
          related_type?: string | null
          sent_at?: string | null
          status?: string
          template_id?: string | null
          title?: string | null
          variables?: Json
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          created_by?: string | null
          document_type?: string | null
          esign_envelope_id?: string | null
          esign_provider?: string | null
          esign_signed_at?: string | null
          esign_status?: string | null
          esign_url?: string | null
          file_url?: string | null
          html_content?: string | null
          id?: string
          pdf_generated_at?: string | null
          pdf_provider?: string | null
          pdf_url?: string | null
          recipients?: Json
          related_id?: string | null
          related_type?: string | null
          sent_at?: string | null
          status?: string
          template_id?: string | null
          title?: string | null
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      hypo_calculations: {
        Row: {
          admin_pct: number
          agency_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          equity_pct: number
          id: string
          interest_pct: number
          label: string | null
          monthly_payment: number | null
          notes: string | null
          principal: number | null
          purchase_price: number
          start_date: string | null
          term_years: number
          total_interest: number | null
          total_paid: number | null
          updated_at: string
        }
        Insert: {
          admin_pct?: number
          agency_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          equity_pct: number
          id?: string
          interest_pct: number
          label?: string | null
          monthly_payment?: number | null
          notes?: string | null
          principal?: number | null
          purchase_price: number
          start_date?: string | null
          term_years: number
          total_interest?: number | null
          total_paid?: number | null
          updated_at?: string
        }
        Update: {
          admin_pct?: number
          agency_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          equity_pct?: number
          id?: string
          interest_pct?: number
          label?: string | null
          monthly_payment?: number | null
          notes?: string | null
          principal?: number | null
          purchase_price?: number
          start_date?: string | null
          term_years?: number
          total_interest?: number | null
          total_paid?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hypo_calculations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hypo_calculations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          agency_id: string | null
          created_at: string
          created_by: string | null
          email: string
          email_delivery_status: string
          expires_at: string
          first_name: string | null
          id: string
          invitation_type: string
          last_name: string | null
          platform_role: string | null
          replaces_invitation_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: string
          tenant_role: Database["public"]["Enums"]["app_role"] | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          agency_id?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          email_delivery_status?: string
          expires_at: string
          first_name?: string | null
          id?: string
          invitation_type: string
          last_name?: string | null
          platform_role?: string | null
          replaces_invitation_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          tenant_role?: Database["public"]["Enums"]["app_role"] | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          agency_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          email_delivery_status?: string
          expires_at?: string
          first_name?: string | null
          id?: string
          invitation_type?: string
          last_name?: string | null
          platform_role?: string | null
          replaces_invitation_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          tenant_role?: Database["public"]["Enums"]["app_role"] | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          agency_id: string | null
          assigned_to: string | null
          budget_max: number | null
          budget_min: number | null
          city: string | null
          company_name: string | null
          contact_first_name: string | null
          contact_last_name: string | null
          converted_client_id: string | null
          country: string | null
          created_at: string
          email: string | null
          entity_type: string
          full_name: string
          id: string
          import_batch_id: string | null
          import_source: string | null
          interest_type: string | null
          internal_notes: string | null
          language: string | null
          mobile: string | null
          notes: string | null
          old_crm_created_at: string | null
          old_crm_id: string | null
          old_crm_updated_at: string | null
          owner_id: string | null
          phone: string | null
          phone_direct: string | null
          portal_self_disclosure: Json | null
          postal_code: string | null
          preferred_location: string | null
          secondary_email: string | null
          source: string | null
          status: Database["public"]["Enums"]["lead_status"]
          tags: string[]
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          agency_id?: string | null
          assigned_to?: string | null
          budget_max?: number | null
          budget_min?: number | null
          city?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          converted_client_id?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          entity_type?: string
          full_name: string
          id?: string
          import_batch_id?: string | null
          import_source?: string | null
          interest_type?: string | null
          internal_notes?: string | null
          language?: string | null
          mobile?: string | null
          notes?: string | null
          old_crm_created_at?: string | null
          old_crm_id?: string | null
          old_crm_updated_at?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_direct?: string | null
          portal_self_disclosure?: Json | null
          postal_code?: string | null
          preferred_location?: string | null
          secondary_email?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          tags?: string[]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          agency_id?: string | null
          assigned_to?: string | null
          budget_max?: number | null
          budget_min?: number | null
          city?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          converted_client_id?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          entity_type?: string
          full_name?: string
          id?: string
          import_batch_id?: string | null
          import_source?: string | null
          interest_type?: string | null
          internal_notes?: string | null
          language?: string | null
          mobile?: string | null
          notes?: string | null
          old_crm_created_at?: string | null
          old_crm_id?: string | null
          old_crm_updated_at?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_direct?: string | null
          portal_self_disclosure?: Json | null
          postal_code?: string | null
          preferred_location?: string | null
          secondary_email?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          tags?: string[]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      livekit_settings: {
        Row: {
          agency_id: string | null
          api_key: string | null
          api_secret: string | null
          created_at: string
          enabled: boolean
          id: string
          updated_at: string
          ws_url: string | null
        }
        Insert: {
          agency_id?: string | null
          api_key?: string | null
          api_secret?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          updated_at?: string
          ws_url?: string | null
        }
        Update: {
          agency_id?: string | null
          api_key?: string | null
          api_secret?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          updated_at?: string
          ws_url?: string | null
        }
        Relationships: []
      }
      mandate_commission_splits: {
        Row: {
          agency_id: string | null
          created_at: string
          id: string
          mandate_id: string | null
          notes: string | null
          property_id: string
          role: string
          split_percent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          id?: string
          mandate_id?: string | null
          notes?: string | null
          property_id: string
          role?: string
          split_percent: number
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          id?: string
          mandate_id?: string | null
          notes?: string | null
          property_id?: string
          role?: string
          split_percent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mandate_commission_splits_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandate_commission_splits_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandate_commission_splits_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandate_commission_splits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mandates: {
        Row: {
          agency_id: string | null
          cancellation_fee: number | null
          cancellation_fee_notes: string | null
          client_id: string | null
          commission_model: string | null
          commission_value: number | null
          created_at: string
          generated_document_id: string | null
          id: string
          mandate_type: string
          notes: string | null
          property_id: string | null
          status: Database["public"]["Enums"]["mandate_status"]
          template_id: string | null
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          agency_id?: string | null
          cancellation_fee?: number | null
          cancellation_fee_notes?: string | null
          client_id?: string | null
          commission_model?: string | null
          commission_value?: number | null
          created_at?: string
          generated_document_id?: string | null
          id?: string
          mandate_type?: string
          notes?: string | null
          property_id?: string | null
          status?: Database["public"]["Enums"]["mandate_status"]
          template_id?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          agency_id?: string | null
          cancellation_fee?: number | null
          cancellation_fee_notes?: string | null
          client_id?: string | null
          commission_model?: string | null
          commission_value?: number | null
          created_at?: string
          generated_document_id?: string | null
          id?: string
          mandate_type?: string
          notes?: string | null
          property_id?: string | null
          status?: Database["public"]["Enums"]["mandate_status"]
          template_id?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mandates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandates_generated_document_id_fkey"
            columns: ["generated_document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      master_list_values: {
        Row: {
          agency_id: string | null
          created_at: string
          id: string
          is_active: boolean
          label_de: string
          list_key: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label_de: string
          list_key: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          label_de?: string
          list_key?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_list_values_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          agency_id: string | null
          client_id: string
          created_at: string
          id: string
          notes: string | null
          property_id: string
          reasons: Json | null
          score: number
          status: Database["public"]["Enums"]["match_status"]
        }
        Insert: {
          agency_id?: string | null
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          property_id: string
          reasons?: Json | null
          score?: number
          status?: Database["public"]["Enums"]["match_status"]
        }
        Update: {
          agency_id?: string | null
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          property_id?: string
          reasons?: Json | null
          score?: number
          status?: Database["public"]["Enums"]["match_status"]
        }
        Relationships: [
          {
            foreignKeyName: "matches_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      module_permissions: {
        Row: {
          agency_id: string | null
          can_create: boolean
          can_delete: boolean
          can_edit_all: boolean
          can_edit_own: boolean
          can_view: boolean
          id: string
          module: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          can_create?: boolean
          can_delete?: boolean
          can_edit_all?: boolean
          can_edit_own?: boolean
          can_view?: boolean
          id?: string
          module: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          can_create?: boolean
          can_delete?: boolean
          can_edit_all?: boolean
          can_edit_own?: boolean
          can_view?: boolean
          id?: string
          module?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_permissions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      nda_agreements: {
        Row: {
          agency_id: string | null
          archived_at: string | null
          archived_by: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          generated_document_id: string | null
          id: string
          is_archived: boolean
          nda_type: string
          notes: string | null
          penalty_amount: number
          property_id: string | null
          status: string
          template_id: string | null
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          agency_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          generated_document_id?: string | null
          id?: string
          is_archived?: boolean
          nda_type?: string
          notes?: string | null
          penalty_amount?: number
          property_id?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          agency_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          generated_document_id?: string | null
          id?: string
          is_archived?: boolean
          nda_type?: string
          notes?: string | null
          penalty_amount?: number
          property_id?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nda_agreements_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nda_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nda_agreements_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          appointment_reminder_minutes: number
          appointments_enabled: boolean
          created_at: string
          email_enabled: boolean
          in_app_enabled: boolean
          leads_enabled: boolean
          task_due_reminder: boolean
          task_overdue_reminder: boolean
          tasks_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_reminder_minutes?: number
          appointments_enabled?: boolean
          created_at?: string
          email_enabled?: boolean
          in_app_enabled?: boolean
          leads_enabled?: boolean
          task_due_reminder?: boolean
          task_overdue_reminder?: boolean
          tasks_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_reminder_minutes?: number
          appointments_enabled?: boolean
          created_at?: string
          email_enabled?: boolean
          in_app_enabled?: boolean
          leads_enabled?: boolean
          task_due_reminder?: boolean
          task_overdue_reminder?: boolean
          tasks_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          agency_id: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string | null
          read_at: string | null
          related_id: string | null
          related_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          read_at?: string | null
          related_id?: string | null
          related_type?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          read_at?: string | null
          related_id?: string | null
          related_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_entitlements: {
        Row: {
          created_at: string
          enabled: boolean
          entitlement_key: string
          plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          entitlement_key: string
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          entitlement_key?: string
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_limits: {
        Row: {
          created_at: string
          is_unlimited: boolean
          limit_key: string
          limit_value: number | null
          overage_credit_cost: number | null
          period: string | null
          plan_id: string
          policy: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          is_unlimited?: boolean
          limit_key: string
          limit_value?: number | null
          overage_credit_cost?: number | null
          period?: string | null
          plan_id: string
          policy?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          is_unlimited?: boolean
          limit_key?: string
          limit_value?: number | null
          overage_credit_cost?: number | null
          period?: string | null
          plan_id?: string
          policy?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_limits_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          currency: string | null
          description: string | null
          id: string
          is_custom: boolean | null
          is_public: boolean
          key: string
          monthly_credits: number | null
          name: string
          price_monthly: number | null
          price_yearly: number | null
          sort_order: number
          status: string
          stripe_price_key: string | null
          trial_days: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          is_custom?: boolean | null
          is_public?: boolean
          key: string
          monthly_credits?: number | null
          name: string
          price_monthly?: number | null
          price_yearly?: number | null
          sort_order?: number
          status?: string
          stripe_price_key?: string | null
          trial_days?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          is_custom?: boolean | null
          is_public?: boolean
          key?: string
          monthly_credits?: number | null
          name?: string
          price_monthly?: number | null
          price_yearly?: number | null
          sort_order?: number
          status?: string
          stripe_price_key?: string | null
          trial_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          is_system_owner: boolean
          platform_role: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          is_system_owner?: boolean
          platform_role?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          is_system_owner?: boolean
          platform_role?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          target_id: string | null
          target_label: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_label?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_label?: string | null
          target_type?: string
        }
        Relationships: []
      }
      platform_commercial_settings: {
        Row: {
          auto_trial_enabled: boolean
          id: boolean
          past_due_grace_days: number | null
          trial_credits: number | null
          trial_days: number
          trial_plan_id: string | null
          updated_at: string
        }
        Insert: {
          auto_trial_enabled?: boolean
          id?: boolean
          past_due_grace_days?: number | null
          trial_credits?: number | null
          trial_days?: number
          trial_plan_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_trial_enabled?: boolean
          id?: boolean
          past_due_grace_days?: number | null
          trial_credits?: number | null
          trial_days?: number
          trial_plan_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_commercial_settings_trial_plan_id_fkey"
            columns: ["trial_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_event_log: {
        Row: {
          action: string | null
          created_appointment_id: string | null
          created_lead_id: string | null
          entity: string
          portal_event_id: string
          processed_at: string
        }
        Insert: {
          action?: string | null
          created_appointment_id?: string | null
          created_lead_id?: string | null
          entity: string
          portal_event_id: string
          processed_at?: string
        }
        Update: {
          action?: string | null
          created_appointment_id?: string | null
          created_lead_id?: string | null
          entity?: string
          portal_event_id?: string
          processed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_event_log_created_appointment_id_fkey"
            columns: ["created_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_event_log_created_lead_id_fkey"
            columns: ["created_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_agency_id: string | null
          agency_id: string | null
          avatar_url: string | null
          commission_payout_rate: number | null
          commission_tier: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          language: string
          phone: string | null
          presence_status: string
          presence_updated_at: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          active_agency_id?: string | null
          agency_id?: string | null
          avatar_url?: string | null
          commission_payout_rate?: number | null
          commission_tier?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          language?: string
          phone?: string | null
          presence_status?: string
          presence_updated_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          active_agency_id?: string | null
          agency_id?: string | null
          avatar_url?: string | null
          commission_payout_rate?: number | null
          commission_tier?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          language?: string
          phone?: string | null
          presence_status?: string
          presence_updated_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string | null
          agency_id: string | null
          ancillary_costs_monthly: number | null
          area: number | null
          assigned_to: string | null
          availability_date: string | null
          balcony_area: number | null
          bathrooms: number | null
          building_count: number | null
          building_insurance_value: number | null
          building_type: string | null
          building_volume: number | null
          building_volume_ratio: number | null
          cellar_area: number | null
          cellar_available: boolean | null
          city: string | null
          condition: string | null
          country: string | null
          created_at: string
          deal_type: string | null
          deposit_amount: number | null
          deposit_date: string | null
          description: string | null
          development_status: string | null
          e_grid: string | null
          egid: string | null
          energy_class: string | null
          energy_efficiency_envelope: string | null
          energy_efficiency_overall: string | null
          energy_source: string | null
          ewid: string | null
          exterior_construction_area: number | null
          features: string[] | null
          floor: number | null
          garden_area: number | null
          gross_floor_area: number | null
          gross_living_area: number | null
          gross_yield: number | null
          hall_height: number | null
          heating_type: string | null
          id: string
          images: string[] | null
          import_batch_id: string | null
          import_source: string | null
          internal_minimum_price: number | null
          internal_notes: string | null
          is_unit: boolean
          land_price: number | null
          land_register_no: string | null
          latitude: number | null
          listing_type: Database["public"]["Enums"]["listing_type"]
          living_area: number | null
          location_description: string | null
          loggia_area: number | null
          longitude: number | null
          macro_location: Json | null
          marketing_type: string | null
          minergie_standard: string | null
          net_yield: number | null
          occupancy_rate: number | null
          occupancy_rate_date: string | null
          official_tax_value: number | null
          old_crm_id: string | null
          owner_client_id: string | null
          owner_costs_yearly: number | null
          owner_id: string | null
          parcel_no: string | null
          parent_property_id: string | null
          parking_spaces: number | null
          plot_area: number | null
          portal_property_id: string | null
          portal_published: boolean
          portal_published_at: string | null
          postal_code: string | null
          price: number | null
          price_from: number | null
          price_to: number | null
          property_type: Database["public"]["Enums"]["property_type"]
          public_enabled: boolean
          public_token: string | null
          raw_import: Json | null
          reference_no: string | null
          renovated_at: number | null
          renovation_fund: number | null
          rent: number | null
          rent_actual: number | null
          rent_target: number | null
          reservation_amount_default: number | null
          room_height: number | null
          rooms: number | null
          s_number: string | null
          sale_procedure: string | null
          sale_process_end: string | null
          sale_process_start: string | null
          seller_client_id: string | null
          separate_wc_count: number | null
          sia_416_area: number | null
          status: Database["public"]["Enums"]["property_status"]
          terrace_area: number | null
          title: string
          total_floors: number | null
          unit_count_commercial: number | null
          unit_count_residential: number | null
          unit_floor: string | null
          unit_number: string | null
          unit_status: string | null
          unit_type: string | null
          updated_at: string
          usable_area: number | null
          usage_types: string[] | null
          utilization_ratio: number | null
          value_quota: number | null
          vat_status: string | null
          year_built: number | null
          zone: string | null
        }
        Insert: {
          address?: string | null
          agency_id?: string | null
          ancillary_costs_monthly?: number | null
          area?: number | null
          assigned_to?: string | null
          availability_date?: string | null
          balcony_area?: number | null
          bathrooms?: number | null
          building_count?: number | null
          building_insurance_value?: number | null
          building_type?: string | null
          building_volume?: number | null
          building_volume_ratio?: number | null
          cellar_area?: number | null
          cellar_available?: boolean | null
          city?: string | null
          condition?: string | null
          country?: string | null
          created_at?: string
          deal_type?: string | null
          deposit_amount?: number | null
          deposit_date?: string | null
          description?: string | null
          development_status?: string | null
          e_grid?: string | null
          egid?: string | null
          energy_class?: string | null
          energy_efficiency_envelope?: string | null
          energy_efficiency_overall?: string | null
          energy_source?: string | null
          ewid?: string | null
          exterior_construction_area?: number | null
          features?: string[] | null
          floor?: number | null
          garden_area?: number | null
          gross_floor_area?: number | null
          gross_living_area?: number | null
          gross_yield?: number | null
          hall_height?: number | null
          heating_type?: string | null
          id?: string
          images?: string[] | null
          import_batch_id?: string | null
          import_source?: string | null
          internal_minimum_price?: number | null
          internal_notes?: string | null
          is_unit?: boolean
          land_price?: number | null
          land_register_no?: string | null
          latitude?: number | null
          listing_type?: Database["public"]["Enums"]["listing_type"]
          living_area?: number | null
          location_description?: string | null
          loggia_area?: number | null
          longitude?: number | null
          macro_location?: Json | null
          marketing_type?: string | null
          minergie_standard?: string | null
          net_yield?: number | null
          occupancy_rate?: number | null
          occupancy_rate_date?: string | null
          official_tax_value?: number | null
          old_crm_id?: string | null
          owner_client_id?: string | null
          owner_costs_yearly?: number | null
          owner_id?: string | null
          parcel_no?: string | null
          parent_property_id?: string | null
          parking_spaces?: number | null
          plot_area?: number | null
          portal_property_id?: string | null
          portal_published?: boolean
          portal_published_at?: string | null
          postal_code?: string | null
          price?: number | null
          price_from?: number | null
          price_to?: number | null
          property_type?: Database["public"]["Enums"]["property_type"]
          public_enabled?: boolean
          public_token?: string | null
          raw_import?: Json | null
          reference_no?: string | null
          renovated_at?: number | null
          renovation_fund?: number | null
          rent?: number | null
          rent_actual?: number | null
          rent_target?: number | null
          reservation_amount_default?: number | null
          room_height?: number | null
          rooms?: number | null
          s_number?: string | null
          sale_procedure?: string | null
          sale_process_end?: string | null
          sale_process_start?: string | null
          seller_client_id?: string | null
          separate_wc_count?: number | null
          sia_416_area?: number | null
          status?: Database["public"]["Enums"]["property_status"]
          terrace_area?: number | null
          title: string
          total_floors?: number | null
          unit_count_commercial?: number | null
          unit_count_residential?: number | null
          unit_floor?: string | null
          unit_number?: string | null
          unit_status?: string | null
          unit_type?: string | null
          updated_at?: string
          usable_area?: number | null
          usage_types?: string[] | null
          utilization_ratio?: number | null
          value_quota?: number | null
          vat_status?: string | null
          year_built?: number | null
          zone?: string | null
        }
        Update: {
          address?: string | null
          agency_id?: string | null
          ancillary_costs_monthly?: number | null
          area?: number | null
          assigned_to?: string | null
          availability_date?: string | null
          balcony_area?: number | null
          bathrooms?: number | null
          building_count?: number | null
          building_insurance_value?: number | null
          building_type?: string | null
          building_volume?: number | null
          building_volume_ratio?: number | null
          cellar_area?: number | null
          cellar_available?: boolean | null
          city?: string | null
          condition?: string | null
          country?: string | null
          created_at?: string
          deal_type?: string | null
          deposit_amount?: number | null
          deposit_date?: string | null
          description?: string | null
          development_status?: string | null
          e_grid?: string | null
          egid?: string | null
          energy_class?: string | null
          energy_efficiency_envelope?: string | null
          energy_efficiency_overall?: string | null
          energy_source?: string | null
          ewid?: string | null
          exterior_construction_area?: number | null
          features?: string[] | null
          floor?: number | null
          garden_area?: number | null
          gross_floor_area?: number | null
          gross_living_area?: number | null
          gross_yield?: number | null
          hall_height?: number | null
          heating_type?: string | null
          id?: string
          images?: string[] | null
          import_batch_id?: string | null
          import_source?: string | null
          internal_minimum_price?: number | null
          internal_notes?: string | null
          is_unit?: boolean
          land_price?: number | null
          land_register_no?: string | null
          latitude?: number | null
          listing_type?: Database["public"]["Enums"]["listing_type"]
          living_area?: number | null
          location_description?: string | null
          loggia_area?: number | null
          longitude?: number | null
          macro_location?: Json | null
          marketing_type?: string | null
          minergie_standard?: string | null
          net_yield?: number | null
          occupancy_rate?: number | null
          occupancy_rate_date?: string | null
          official_tax_value?: number | null
          old_crm_id?: string | null
          owner_client_id?: string | null
          owner_costs_yearly?: number | null
          owner_id?: string | null
          parcel_no?: string | null
          parent_property_id?: string | null
          parking_spaces?: number | null
          plot_area?: number | null
          portal_property_id?: string | null
          portal_published?: boolean
          portal_published_at?: string | null
          postal_code?: string | null
          price?: number | null
          price_from?: number | null
          price_to?: number | null
          property_type?: Database["public"]["Enums"]["property_type"]
          public_enabled?: boolean
          public_token?: string | null
          raw_import?: Json | null
          reference_no?: string | null
          renovated_at?: number | null
          renovation_fund?: number | null
          rent?: number | null
          rent_actual?: number | null
          rent_target?: number | null
          reservation_amount_default?: number | null
          room_height?: number | null
          rooms?: number | null
          s_number?: string | null
          sale_procedure?: string | null
          sale_process_end?: string | null
          sale_process_start?: string | null
          seller_client_id?: string | null
          separate_wc_count?: number | null
          sia_416_area?: number | null
          status?: Database["public"]["Enums"]["property_status"]
          terrace_area?: number | null
          title?: string
          total_floors?: number | null
          unit_count_commercial?: number | null
          unit_count_residential?: number | null
          unit_floor?: string | null
          unit_number?: string | null
          unit_status?: string | null
          unit_type?: string | null
          updated_at?: string
          usable_area?: number | null
          usage_types?: string[] | null
          utilization_ratio?: number | null
          value_quota?: number | null
          vat_status?: string | null
          year_built?: number | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_owner_client_id_fkey"
            columns: ["owner_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_parent_property_id_fkey"
            columns: ["parent_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_seller_client_id_fkey"
            columns: ["seller_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      property_assignees: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_assignees_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_feature_options: {
        Row: {
          agency_id: string | null
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          key: string
          label_de: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label_de: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label_de?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_feature_options_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      property_market_analyses: {
        Row: {
          agency_id: string | null
          created_at: string
          created_by: string | null
          id: string
          model: string | null
          property_id: string
          raw_markdown: string | null
          sections: Json
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string | null
          property_id: string
          raw_markdown?: string | null
          sections?: Json
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string | null
          property_id?: string
          raw_markdown?: string | null
          sections?: Json
        }
        Relationships: [
          {
            foreignKeyName: "property_market_analyses_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      property_media: {
        Row: {
          agency_id: string | null
          created_at: string
          description: string | null
          file_name: string | null
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          is_cover: boolean
          property_id: string
          sort_order: number
          title: string | null
          uploaded_by: string | null
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          description?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          is_cover?: boolean
          property_id: string
          sort_order?: number
          title?: string | null
          uploaded_by?: string | null
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          description?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          is_cover?: boolean
          property_id?: string
          sort_order?: number
          title?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_media_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_media_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_ownerships: {
        Row: {
          acquisition_price: number | null
          acquisition_type: string | null
          agency_id: string | null
          client_id: string
          created_at: string
          end_date: string | null
          id: string
          is_primary_contact: boolean
          land_register_entry: string | null
          notes: string | null
          ownership_type: Database["public"]["Enums"]["ownership_type"]
          property_id: string
          sale_price: number | null
          share_percent: number | null
          source: string
          start_date: string | null
          updated_at: string
        }
        Insert: {
          acquisition_price?: number | null
          acquisition_type?: string | null
          agency_id?: string | null
          client_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_primary_contact?: boolean
          land_register_entry?: string | null
          notes?: string | null
          ownership_type?: Database["public"]["Enums"]["ownership_type"]
          property_id: string
          sale_price?: number | null
          share_percent?: number | null
          source?: string
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          acquisition_price?: number | null
          acquisition_type?: string | null
          agency_id?: string | null
          client_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_primary_contact?: boolean
          land_register_entry?: string | null
          notes?: string | null
          ownership_type?: Database["public"]["Enums"]["ownership_type"]
          property_id?: string
          sale_price?: number | null
          share_percent?: number | null
          source?: string
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_ownerships_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_ownerships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_ownerships_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_pins: {
        Row: {
          color: string
          created_at: string
          id: string
          property_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          property_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          property_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_pins_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_credit_charges: {
        Row: {
          agency_id: string
          amount: number
          attempts: number
          created_at: string
          credit_operation_id: string | null
          id: string
          period_key: string
          resource_id: string
          status: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          amount: number
          attempts?: number
          created_at?: string
          credit_operation_id?: string | null
          id?: string
          period_key: string
          resource_id: string
          status: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          amount?: number
          attempts?: number
          created_at?: string
          credit_operation_id?: string | null
          id?: string
          period_key?: string
          resource_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_credit_charges_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_credit_charges_credit_operation_id_fkey"
            columns: ["credit_operation_id"]
            isOneToOne: false
            referencedRelation: "credit_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_credit_charges_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "recurring_credit_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_credit_resources: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string | null
          credit_cost_per_period: number | null
          ends_at: string | null
          id: string
          period: string
          quantity: number
          reason: string | null
          resource_key: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by?: string | null
          credit_cost_per_period?: number | null
          ends_at?: string | null
          id?: string
          period?: string
          quantity: number
          reason?: string | null
          resource_key: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string | null
          credit_cost_per_period?: number | null
          ends_at?: string | null
          id?: string
          period?: string
          quantity?: number
          reason?: string | null
          resource_key?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_credit_resources_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_credit_resources_resource_key_fkey"
            columns: ["resource_key"]
            isOneToOne: false
            referencedRelation: "usage_meters"
            referencedColumns: ["key"]
          },
        ]
      }
      reservations: {
        Row: {
          agency_id: string | null
          client_id: string | null
          created_at: string
          generated_document_id: string | null
          id: string
          notes: string | null
          property_id: string | null
          reservation_fee: number | null
          status: Database["public"]["Enums"]["reservation_status"]
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          agency_id?: string | null
          client_id?: string | null
          created_at?: string
          generated_document_id?: string | null
          id?: string
          notes?: string | null
          property_id?: string | null
          reservation_fee?: number | null
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          agency_id?: string | null
          client_id?: string | null
          created_at?: string
          generated_document_id?: string | null
          id?: string
          notes?: string | null
          property_id?: string | null
          reservation_fee?: number | null
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_generated_document_id_fkey"
            columns: ["generated_document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      reserved_subdomains: {
        Row: {
          created_at: string
          name: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          name: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          name?: string
          reason?: string | null
        }
        Relationships: []
      }
      search_profile_subscriptions: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_profile_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "client_search_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_object_tenants: {
        Row: {
          agency_id: string
          bucket_id: string
          created_at: string
          object_name: string
          source: string
        }
        Insert: {
          agency_id: string
          bucket_id: string
          created_at?: string
          object_name: string
          source?: string
        }
        Update: {
          agency_id?: string
          bucket_id?: string
          created_at?: string
          object_name?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_object_tenants_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          agency_id: string
          created_at: string
          environment: string
          stripe_customer_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          environment: string
          stripe_customer_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          environment?: string
          stripe_customer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          environment: string
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          environment: string
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          environment?: string
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
      subscription_admin_notes: {
        Row: {
          note: string
          subscription_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          note: string
          subscription_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          note?: string
          subscription_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_admin_notes_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          agency_id: string | null
          auto_renew: boolean | null
          billing_period: string | null
          billing_source: string | null
          cancel_at_period_end: boolean | null
          contract_currency: string | null
          contract_price: number | null
          created_at: string | null
          credit_period: string | null
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          invoice_date: string | null
          invoice_number: string | null
          last_payment_amount: number | null
          paid_at: string | null
          paid_until: string | null
          past_due_since: string | null
          payment_due_date: string | null
          plan_id: string | null
          price_id: string | null
          product_id: string | null
          source: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          trial_start: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          auto_renew?: boolean | null
          billing_period?: string | null
          billing_source?: string | null
          cancel_at_period_end?: boolean | null
          contract_currency?: string | null
          contract_price?: number | null
          created_at?: string | null
          credit_period?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          last_payment_amount?: number | null
          paid_at?: string | null
          paid_until?: string | null
          past_due_since?: string | null
          payment_due_date?: string | null
          plan_id?: string | null
          price_id?: string | null
          product_id?: string | null
          source?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agency_id?: string | null
          auto_renew?: boolean | null
          billing_period?: string | null
          billing_source?: string | null
          cancel_at_period_end?: boolean | null
          contract_currency?: string | null
          contract_price?: number | null
          created_at?: string | null
          credit_period?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          last_payment_amount?: number | null
          paid_at?: string | null
          paid_until?: string | null
          past_due_since?: string | null
          payment_due_date?: string | null
          plan_id?: string | null
          price_id?: string | null
          product_id?: string | null
          source?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          agency_id: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          related_id: string | null
          related_type: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          related_id?: string | null
          related_type?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          related_id?: string | null
          related_type?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_domains: {
        Row: {
          activated_at: string | null
          agency_id: string
          created_at: string
          domain: string
          domain_type: string
          id: string
          is_primary: boolean
          updated_at: string
          verification_checked_at: string | null
          verification_error: string | null
          verification_status: string
          verification_token: string | null
          verified_at: string | null
        }
        Insert: {
          activated_at?: string | null
          agency_id: string
          created_at?: string
          domain: string
          domain_type: string
          id?: string
          is_primary?: boolean
          updated_at?: string
          verification_checked_at?: string | null
          verification_error?: string | null
          verification_status?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Update: {
          activated_at?: string | null
          agency_id?: string
          created_at?: string
          domain?: string
          domain_type?: string
          id?: string
          is_primary?: boolean
          updated_at?: string
          verification_checked_at?: string | null
          verification_error?: string | null
          verification_status?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_domains_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_owner_invitations: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string | null
          email: string
          first_name: string
          id: string
          last_name: string
          status: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by?: string | null
          email: string
          first_name: string
          id?: string
          last_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_owner_invitations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      trash_items: {
        Row: {
          agency_id: string | null
          deleted_at: string
          deleted_by: string | null
          id: string
          label: string | null
          payload: Json
          record_id: string
          restored_at: string | null
          subtitle: string | null
          table_name: string
        }
        Insert: {
          agency_id?: string | null
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          label?: string | null
          payload: Json
          record_id: string
          restored_at?: string | null
          subtitle?: string | null
          table_name: string
        }
        Update: {
          agency_id?: string | null
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          label?: string | null
          payload?: Json
          record_id?: string
          restored_at?: string | null
          subtitle?: string | null
          table_name?: string
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string | null
          credit_cost: number
          credit_operation_id: string | null
          decision: string
          id: string
          idempotency_key: string
          included_quantity: number
          overage_quantity: number
          period_key: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          usage_key: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by?: string | null
          credit_cost?: number
          credit_operation_id?: string | null
          decision: string
          id?: string
          idempotency_key: string
          included_quantity?: number
          overage_quantity?: number
          period_key: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          usage_key: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string | null
          credit_cost?: number
          credit_operation_id?: string | null
          decision?: string
          id?: string
          idempotency_key?: string
          included_quantity?: number
          overage_quantity?: number
          period_key?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          usage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_credit_operation_id_fkey"
            columns: ["credit_operation_id"]
            isOneToOne: false
            referencedRelation: "credit_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_usage_key_fkey"
            columns: ["usage_key"]
            isOneToOne: false
            referencedRelation: "usage_meters"
            referencedColumns: ["key"]
          },
        ]
      }
      usage_meters: {
        Row: {
          created_at: string
          default_period: string
          key: string
          kind: string
          name: string
          recurring: boolean
          unit: string
        }
        Insert: {
          created_at?: string
          default_period?: string
          key: string
          kind: string
          name: string
          recurring?: boolean
          unit: string
        }
        Update: {
          created_at?: string
          default_period?: string
          key?: string
          kind?: string
          name?: string
          recurring?: boolean
          unit?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_calls: {
        Row: {
          context_id: string | null
          context_type: string
          created_at: string
          created_by: string
          ended_at: string | null
          id: string
          participants: string[]
          room_name: string
          started_at: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          context_id?: string | null
          context_type?: string
          created_at?: string
          created_by: string
          ended_at?: string | null
          id?: string
          participants?: string[]
          room_name: string
          started_at?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          context_id?: string | null
          context_type?: string
          created_at?: string
          created_by?: string
          ended_at?: string | null
          id?: string
          participants?: string[]
          room_name?: string
          started_at?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _commercial_credit_window: {
        Args: { _at?: string; _end: string; _start: string }
        Returns: {
          ce: string
          cs: string
        }[]
      }
      _commercial_grant_period_credits: {
        Args: { _sub_id: string }
        Returns: string
      }
      _commercial_resolve_agency: {
        Args: { _agency_id: string }
        Returns: string
      }
      _commercial_start_trial: {
        Args: { _actor: string; _agency_id: string }
        Returns: Json
      }
      _commercial_usage_decision: {
        Args: { _key: string; _qty: number; a: string }
        Returns: Json
      }
      _credit_available: { Args: { _agency_id: string }; Returns: number }
      _credit_debit: {
        Args: {
          _action_key: string
          _actor: string
          _agency_id: string
          _amount: number
          _op: string
          _source: string
          _wallet: string
        }
        Returns: Json
      }
      _credit_default_order: { Args: never; Returns: string[] }
      _credit_insert_grant: {
        Args: {
          _actor: string
          _agency_id: string
          _amount: number
          _bucket: string
          _expires_at: string
          _idem: string
          _kind: string
          _reason: string
          _ref_id: string
          _ref_type: string
          _source: string
        }
        Returns: string
      }
      _credit_open_lots: {
        Args: { _agency_id: string }
        Returns: {
          bucket: string
          expires_at: string
          lot_id: string
          remaining: number
        }[]
      }
      _credit_refund: {
        Args: {
          _actor: string
          _amount: number
          _operation_id: string
          _reason: string
        }
        Returns: string
      }
      _credit_reservation_release: {
        Args: { _new_status: string; _reason: string; _reservation_id: string }
        Returns: Json
      }
      _credit_wallet: { Args: { _agency_id: string }; Returns: string }
      _invitation_audit: {
        Args: {
          _action: string
          _extra?: Json
          _inv: Database["public"]["Tables"]["invitations"]["Row"]
        }
        Returns: undefined
      }
      _invitation_can_manage: {
        Args: { _inv: Database["public"]["Tables"]["invitations"]["Row"] }
        Returns: boolean
      }
      _invitation_issue: {
        Args: {
          _agency: string
          _email: string
          _first: string
          _last: string
          _prole: string
          _replaces?: string
          _trole: Database["public"]["Enums"]["app_role"]
          _type: string
        }
        Returns: {
          invitation_id: string
          token: string
        }[]
      }
      _manual_active_conflict: {
        Args: { _agency_id: string; _except: string; _start: string }
        Returns: boolean
      }
      _sole_agency_of: { Args: { _uid: string }; Returns: string }
      admin_get_stats: {
        Args: never
        Returns: {
          agencies_count: number
          appointments_count: number
          clients_count: number
          leads_count: number
          properties_count: number
          users_count: number
        }[]
      }
      admin_set_user_role: {
        Args: {
          _grant: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      agency_active_plan_id: { Args: { _agency_id: string }; Returns: string }
      agency_commercial_state: { Args: { _agency_id: string }; Returns: Json }
      agency_effective_limit: {
        Args: { _agency_id: string; _key: string }
        Returns: Json
      }
      agency_has_entitlement: {
        Args: { _agency_id: string; _key: string }
        Returns: boolean
      }
      agency_is_active: { Args: { _agency_id: string }; Returns: boolean }
      agency_module_enabled: { Args: { _module: string }; Returns: boolean }
      agency_module_enabled_for: {
        Args: { _agency_id: string; _module: string }
        Returns: boolean
      }
      bank_package_share_active: { Args: { _token: string }; Returns: boolean }
      bank_package_share_resolve: {
        Args: { _token: string }
        Returns: {
          attachment_count: number
          client_name: string
          company_email: string
          company_name: string
          company_website: string
          expires_at: string
          logo_url: string
          package_title: string
          primary_color: string
          secondary_color: string
          size_bytes: number
          status: string
        }[]
      }
      can_access_client: { Args: { _client_id: string }; Returns: boolean }
      can_access_property: { Args: { _property_id: string }; Returns: boolean }
      can_see_profile: {
        Args: { _profile_agency: string; _profile_id: string }
        Returns: boolean
      }
      commercial_advance_due_periods: { Args: never; Returns: Json }
      commercial_advance_period: {
        Args: { _subscription_id: string }
        Returns: Json
      }
      commercial_can_read: { Args: { _agency_id: string }; Returns: boolean }
      commercial_period_key: {
        Args: { _agency_id: string; _period: string }
        Returns: string
      }
      commercial_recurring_charge: {
        Args: { _resource_id: string }
        Returns: Json
      }
      commercial_recurring_charge_due: { Args: never; Returns: Json }
      commercial_set_cancel_at_period_end: {
        Args: { _agency_id: string; _cancel: boolean; _reason?: string }
        Returns: Json
      }
      commercial_subscription_state: {
        Args: { _agency_id: string }
        Returns: Json
      }
      commercial_usage_current: {
        Args: { _agency_id: string; _key: string; _period: string }
        Returns: number
      }
      commercial_usage_decision: {
        Args: {
          _agency_id?: string
          _requested_quantity?: number
          _usage_key: string
        }
        Returns: Json
      }
      commercial_usage_record: {
        Args: {
          _agency_id?: string
          _idempotency_key: string
          _quantity: number
          _reference_id?: string
          _reference_type?: string
          _usage_key: string
        }
        Returns: Json
      }
      commercial_valid_entitlement_key: {
        Args: { _key: string }
        Returns: boolean
      }
      create_notification: {
        Args: {
          _link: string
          _message: string
          _related_id: string
          _related_type: string
          _title: string
          _type: string
          _user_id: string
        }
        Returns: undefined
      }
      credit_action_effective_cost: {
        Args: { _action_key: string }
        Returns: number
      }
      credit_balance: { Args: { _agency_id?: string }; Returns: number }
      credit_balance_breakdown: { Args: { _agency_id?: string }; Returns: Json }
      credit_can_consume: { Args: { _action_key: string }; Returns: Json }
      credit_consume: {
        Args: {
          _action_key: string
          _agency_id?: string
          _idempotency_key: string
        }
        Returns: Json
      }
      credit_grant: {
        Args: {
          _agency_id: string
          _amount: number
          _bucket: string
          _expires_at: string
          _idempotency_key: string
          _reason: string
          _reference_id?: string
          _reference_type?: string
          _source: string
        }
        Returns: string
      }
      credit_refund: {
        Args: { _amount?: number; _operation_id: string; _reason?: string }
        Returns: string
      }
      credit_reservation_finalize: {
        Args: { _reservation_id: string }
        Returns: Json
      }
      credit_reservation_release: {
        Args: { _reason?: string; _reservation_id: string }
        Returns: Json
      }
      credit_reservations_expire: { Args: never; Returns: number }
      credit_reserve: {
        Args: {
          _action_key: string
          _agency_id?: string
          _idempotency_key: string
          _reference_id?: string
          _reference_type?: string
          _ttl_seconds?: number
        }
        Returns: Json
      }
      current_agency_id: { Args: never; Returns: string }
      financing_link_resolve: {
        Args: { _token: string }
        Returns: {
          client_name: string
          completion_percent: number
          dossier_id: string
          section_additional: Json
          section_affordability: Json
          section_customer: Json
          section_financing: Json
          section_income: Json
          section_property_docs: Json
          section_self_employed: Json
          section_tax: Json
          status: string
        }[]
      }
      financing_link_save: {
        Args: { _completion: number; _payload: Json; _token: string }
        Returns: undefined
      }
      financing_link_submit: { Args: { _token: string }; Returns: undefined }
      format_property_reference: { Args: { _n: number }; Returns: string }
      get_tenant_config: { Args: never; Returns: Json }
      has_active_subscription: {
        Args: { agency_uuid: string; check_env?: string }
        Returns: boolean
      }
      has_agency_role: {
        Args: {
          _agency_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invitation_accept: { Args: { _token: string }; Returns: Json }
      invitation_create_tenant_member: {
        Args: {
          _email: string
          _first_name?: string
          _last_name?: string
          _role: string
        }
        Returns: Json
      }
      invitation_effective_status: {
        Args: { _expires: string; _status: string }
        Returns: string
      }
      invitation_hash: { Args: { _token: string }; Returns: string }
      invitation_list_tenant: {
        Args: never
        Returns: {
          accepted_at: string
          created_at: string
          email: string
          email_delivery_status: string
          expires_at: string
          first_name: string
          id: string
          invitation_type: string
          last_name: string
          status: string
          tenant_role: string
        }[]
      }
      invitation_preview: { Args: { _token: string }; Returns: Json }
      invitation_resend: { Args: { _invitation_id: string }; Returns: Json }
      invitation_revoke: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      invitation_signup_target: { Args: { _token: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      is_agency_commission_admin: {
        Args: { _agency_id: string }
        Returns: boolean
      }
      is_agency_manager: { Args: { _agency_id: string }; Returns: boolean }
      is_agency_member: { Args: { _agency_id: string }; Returns: boolean }
      is_agency_owner_or_admin: {
        Args: { _agency_id: string }
        Returns: boolean
      }
      is_agent: { Args: never; Returns: boolean }
      is_client_assignee: { Args: { _client_id: string }; Returns: boolean }
      is_commission_admin: { Args: never; Returns: boolean }
      is_commission_split_member: {
        Args: { _record_id: string }
        Returns: boolean
      }
      is_manager_or_above: { Args: never; Returns: boolean }
      is_owner_or_admin: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_property_assignee: { Args: { _property_id: string }; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      is_system_owner: { Args: never; Returns: boolean }
      is_user_agency_member: {
        Args: { _agency_id: string; _user_id: string }
        Returns: boolean
      }
      my_workspace_status: { Args: never; Returns: string }
      my_workspaces: {
        Args: never
        Returns: {
          agency_id: string
          custom_domain: string
          favicon_url: string
          is_current: boolean
          logo_url: string
          name: string
          role: string
          subdomain: string
        }[]
      }
      platform_activity: {
        Args: { _agency_id?: string; _limit?: number }
        Returns: {
          agency_id: string
          agency_name: string
          at: string
          kind: string
          label: string
        }[]
      }
      platform_add_custom_domain: {
        Args: { _agency_id: string; _domain: string }
        Returns: string
      }
      platform_assert_admin: { Args: never; Returns: undefined }
      platform_assert_system_owner: { Args: never; Returns: undefined }
      platform_assign_plan: {
        Args: {
          _agency_id: string
          _billing_period: string
          _plan_id: string
          _reason: string
        }
        Returns: Json
      }
      platform_cancel_manual_subscription: {
        Args: { _immediate: boolean; _reason: string; _subscription_id: string }
        Returns: Json
      }
      platform_check_owner_email: { Args: { _email: string }; Returns: boolean }
      platform_check_subdomain: { Args: { _slug: string }; Returns: string }
      platform_core_module_keys: { Args: never; Returns: string[] }
      platform_create_manual_subscription: {
        Args: {
          _agency_id: string
          _auto_renew: boolean
          _billing_period: string
          _billing_source: string
          _currency: string
          _end: string
          _invoice_date: string
          _invoice_number: string
          _note: string
          _payment_due_date: string
          _plan_id: string
          _price: number
          _reason: string
          _start: string
          _status: string
        }
        Returns: Json
      }
      platform_create_tenant: {
        Args: {
          _modules: string[]
          _name: string
          _owner_email: string
          _owner_first_name: string
          _owner_last_name: string
          _slug: string
        }
        Returns: Json
      }
      platform_credit_adjust: {
        Args: {
          _agency_id: string
          _amount: number
          _bucket: string
          _expires_at: string
          _reason: string
        }
        Returns: string
      }
      platform_credit_refund: {
        Args: { _amount: number; _operation_id: string; _reason: string }
        Returns: string
      }
      platform_domain_audit: {
        Args: {
          _action: string
          _actor: string
          _d: Database["public"]["Tables"]["tenant_domains"]["Row"]
        }
        Returns: undefined
      }
      platform_domain_center: {
        Args: { _agency_id?: string }
        Returns: {
          activated_at: string
          agency_id: string
          agency_name: string
          agency_status: string
          created_at: string
          domain: string
          domain_type: string
          has_branding: boolean
          id: string
          is_primary: boolean
          verification_checked_at: string
          verification_error: string
          verification_status: string
          verified_at: string
        }[]
      }
      platform_domain_dns_record: { Args: { _id: string }; Returns: Json }
      platform_domain_record_check: {
        Args: { _actor: string; _error: string; _id: string; _ok: boolean }
        Returns: string
      }
      platform_extend_trial: {
        Args: { _agency_id: string; _days: number; _reason: string }
        Returns: Json
      }
      platform_feedback_attachments: {
        Args: { _feedback_id: string }
        Returns: Json
      }
      platform_find_user_by_email: { Args: { _email: string }; Returns: Json }
      platform_get_agency_billing: {
        Args: { _agency_id: string }
        Returns: Json
      }
      platform_invite_tenant_owner: {
        Args: {
          _agency_id: string
          _email: string
          _first_name?: string
          _last_name?: string
        }
        Returns: Json
      }
      platform_invite_user: {
        Args: { _email: string; _role: string }
        Returns: Json
      }
      platform_list_admins: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          platform_role: string
          user_id: string
        }[]
      }
      platform_list_audit_logs: {
        Args: { _agency_id?: string; _limit?: number }
        Returns: {
          action: string
          actor_name: string
          created_at: string
          id: string
          metadata: Json
          target_id: string
          target_label: string
          target_type: string
        }[]
      }
      platform_list_domains: {
        Args: { _agency_id?: string }
        Returns: {
          activated_at: string
          agency_id: string
          agency_name: string
          created_at: string
          domain: string
          domain_type: string
          id: string
          verification_status: string
          verified_at: string
        }[]
      }
      platform_list_feedback: {
        Args: { _agency_id?: string }
        Returns: {
          agency_id: string
          agency_name: string
          author_email: string
          author_name: string
          comments: number
          created_at: string
          description: string
          id: string
          priority: string
          status: string
          title: string
          type: string
          votes: number
        }[]
      }
      platform_list_invitations: {
        Args: { _agency_id?: string; _type?: string }
        Returns: {
          accepted_at: string
          agency_id: string
          agency_name: string
          created_at: string
          email: string
          email_delivery_status: string
          expires_at: string
          first_name: string
          id: string
          invitation_type: string
          last_name: string
          role: string
          status: string
        }[]
      }
      platform_list_members: {
        Args: { _agency_id?: string }
        Returns: {
          agency_id: string
          agency_name: string
          created_at: string
          email: string
          full_name: string
          is_active: boolean
          platform_role: string
          tenant_role: string
          user_id: string
        }[]
      }
      platform_list_modules: {
        Args: { _agency_id?: string }
        Returns: {
          agency_id: string
          agency_name: string
          is_enabled: boolean
          is_entitled: boolean
          module: string
        }[]
      }
      platform_list_owner_invitations: {
        Args: { _agency_id: string }
        Returns: {
          created_at: string
          email: string
          first_name: string
          last_name: string
          status: string
        }[]
      }
      platform_list_platform_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          has_membership: boolean
          platform_role: string
          updated_at: string
          user_id: string
        }[]
      }
      platform_list_tenants: {
        Args: never
        Returns: {
          created_at: string
          custom_domain: string
          custom_domain_active: boolean
          custom_domain_status: string
          has_branding: boolean
          id: string
          members: number
          modules_active: number
          name: string
          status: string
          subdomain: string
        }[]
      }
      platform_module_keys: { Args: never; Returns: string[] }
      platform_overview: { Args: never; Returns: Json }
      platform_record_manual_payment: {
        Args: {
          _amount: number
          _invoice_number: string
          _paid_at: string
          _paid_until: string
          _reason: string
          _subscription_id: string
        }
        Returns: Json
      }
      platform_remove_domain: { Args: { _id: string }; Returns: undefined }
      platform_remove_user_access: {
        Args: { _user_id: string }
        Returns: undefined
      }
      platform_role: { Args: never; Returns: string }
      platform_set_agency_addon: {
        Args: {
          _active: boolean
          _addon_id: string
          _agency_id: string
          _ends_at?: string
          _quantity?: number
        }
        Returns: undefined
      }
      platform_set_commercial_settings: {
        Args: {
          _auto_trial: boolean
          _reason: string
          _trial_credits: number
          _trial_days: number
          _trial_plan_id: string
        }
        Returns: undefined
      }
      platform_set_domain_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      platform_set_module_entitlement: {
        Args: { _agency_id: string; _entitled: boolean; _module: string }
        Returns: undefined
      }
      platform_set_plan_allowance: {
        Args: {
          _included: number
          _key: string
          _overage_credit_cost: number
          _period: string
          _plan_id: string
          _policy: string
          _unit?: string
        }
        Returns: undefined
      }
      platform_set_plan_entitlement: {
        Args: { _enabled: boolean; _key: string; _plan_id: string }
        Returns: undefined
      }
      platform_set_plan_limit: {
        Args: {
          _limit_key: string
          _plan_id: string
          _unlimited: boolean
          _value: number
        }
        Returns: undefined
      }
      platform_set_primary_domain: { Args: { _id: string }; Returns: undefined }
      platform_set_recurring_resource: {
        Args: {
          _agency_id: string
          _credit_cost_per_period: number
          _ends_at: string
          _period: string
          _quantity: number
          _reason: string
          _resource_id?: string
          _resource_key: string
          _starts_at: string
        }
        Returns: string
      }
      platform_set_tenant_status: {
        Args: { _agency_id: string; _status: string }
        Returns: string
      }
      platform_set_user_role: {
        Args: { _role: string; _user_id: string }
        Returns: string
      }
      platform_tenant_branding: { Args: { _agency_id: string }; Returns: Json }
      platform_update_feedback: {
        Args: { _id: string; _priority?: string; _status?: string }
        Returns: undefined
      }
      platform_update_manual_subscription: {
        Args: {
          _auto_renew: boolean
          _billing_period: string
          _billing_source: string
          _currency: string
          _end: string
          _invoice_date: string
          _invoice_number: string
          _note: string
          _payment_due_date: string
          _plan_id: string
          _price: number
          _reason: string
          _subscription_id: string
        }
        Returns: Json
      }
      platform_update_tenant: {
        Args: { _agency_id: string; _name: string }
        Returns: undefined
      }
      platform_upsert_addon: {
        Args: {
          _billing_type: string
          _description: string
          _entitlements: string[]
          _key: string
          _limit_increments: Json
          _name: string
          _status: string
        }
        Returns: string
      }
      platform_upsert_credit_action: {
        Args: {
          _action_key: string
          _active: boolean
          _category: string
          _credit_cost: number
          _description: string
          _name: string
        }
        Returns: string
      }
      platform_upsert_credit_package: {
        Args: {
          _credits: number
          _currency: string
          _key: string
          _name: string
          _price_amount: number
          _sort_order: number
          _status: string
        }
        Returns: string
      }
      platform_upsert_plan: {
        Args: {
          _description: string
          _is_public: boolean
          _key: string
          _name: string
          _sort_order: number
          _status: string
        }
        Returns: string
      }
      property_set_public: {
        Args: { _enabled: boolean; _id: string }
        Returns: string
      }
      public_property_view: { Args: { _token: string }; Returns: Json }
      purge_expired_search_profiles: { Args: never; Returns: number }
      resolve_public_tenant_branding: {
        Args: { _hostname: string }
        Returns: Json
      }
      role_can: {
        Args: {
          _action: string
          _agency_id: string
          _module: string
          _other?: string
          _owner?: string
        }
        Returns: boolean
      }
      self_disclosure_link_resolve: {
        Args: { _token: string }
        Returns: {
          client_id: string
          client_name: string
          disclosure: Json
          status: string
        }[]
      }
      self_disclosure_link_save: {
        Args: { _payload: Json; _token: string }
        Returns: undefined
      }
      self_disclosure_link_submit: {
        Args: { _token: string }
        Returns: undefined
      }
      self_disclosure_link_submit_full: {
        Args: { _coapplicants?: Json; _token: string }
        Returns: undefined
      }
      send_self_disclosure_reminders: { Args: never; Returns: number }
      set_current_agency: { Args: { _agency_id: string }; Returns: string }
      set_default_template: {
        Args: { _template_id: string }
        Returns: undefined
      }
      single_agency_of: { Args: { _user_id: string }; Returns: string }
      storage_object_agency: {
        Args: { _bucket: string; _name: string; _owner: string }
        Returns: string
      }
      stripe_grant_credit_purchase: {
        Args: { _agency_id: string; _package_key: string; _session_id: string }
        Returns: string
      }
      stripe_sync_subscription: {
        Args: {
          _agency_id: string
          _cancel_at_period_end: boolean
          _environment: string
          _period_end: string
          _period_start: string
          _price_key: string
          _product_id: string
          _status: string
          _stripe_customer_id: string
          _stripe_subscription_id: string
          _user_id: string
        }
        Returns: string
      }
      tenant_billing_catalog: { Args: never; Returns: Json }
      tenant_branding_of: { Args: { _agency: string }; Returns: Json }
      tenant_custom_domain_activate: { Args: never; Returns: undefined }
      tenant_custom_domain_remove: { Args: never; Returns: undefined }
      tenant_custom_domain_request: {
        Args: { _domain: string }
        Returns: undefined
      }
      tenant_domain_record_check: {
        Args: { _error: string; _id: string; _ok: boolean }
        Returns: undefined
      }
      tenant_parent_agencies: { Args: { j: Json }; Returns: string[] }
      tenant_subdomain_available: { Args: { _slug: string }; Returns: boolean }
      tenant_subdomain_root: { Args: never; Returns: string }
      trash_restore: { Args: { _id: string }; Returns: undefined }
      user_can: { Args: { _action: string; _module: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "owner"
        | "agent"
        | "assistant"
        | "superadmin"
        | "employee"
        | "manager"
        | "admin"
      appointment_status: "scheduled" | "completed" | "cancelled"
      appointment_type: "viewing" | "meeting" | "call" | "other"
      client_relationship_type:
        | "spouse"
        | "co_applicant"
        | "co_investor"
        | "other"
      client_role_status: "active" | "inactive" | "completed" | "cancelled"
      client_role_type:
        | "buyer"
        | "seller"
        | "owner"
        | "former_owner"
        | "tenant"
        | "landlord"
        | "financing_applicant"
        | "co_applicant"
        | "investor"
        | "contact_person"
        | "general_contact"
      client_status:
        | "entwurf"
        | "pendent"
        | "vollstaendig"
        | "finanzierung"
        | "abgeschlossen"
        | "abgelehnt"
        | "storniert"
      client_type:
        | "buyer"
        | "seller"
        | "tenant"
        | "landlord"
        | "investor"
        | "other"
        | "owner"
      document_type:
        | "client_document"
        | "property_document"
        | "contract"
        | "mandate"
        | "reservation"
        | "financing"
        | "media"
        | "other"
        | "nda"
        | "reservation_receipt"
        | "mandate_partial"
      feedback_priority: "low" | "medium" | "high" | "critical"
      feedback_status:
        | "new"
        | "planned"
        | "in_progress"
        | "done"
        | "rejected"
        | "under_review"
        | "duplicate"
        | "updated"
      feedback_type: "idea" | "bug" | "question" | "other"
      financing_checklist_section:
        | "customer"
        | "financing_structure"
        | "property_docs"
        | "income_employment"
        | "tax"
        | "self_employed"
        | "affordability"
        | "additional_check"
        | "submission_quality"
        | "rejection_reasons"
      financing_checklist_status:
        | "open"
        | "present"
        | "missing"
        | "not_relevant"
      financing_dossier_status:
        | "draft"
        | "quick_check"
        | "documents_missing"
        | "ready_for_bank"
        | "submitted_to_bank"
        | "approved"
        | "rejected"
        | "cancelled"
      financing_quick_check_status:
        | "realistic"
        | "critical"
        | "not_financeable"
        | "incomplete"
      financing_status: "draft" | "submitted" | "reviewed"
      financing_type:
        | "purchase"
        | "renovation"
        | "increase"
        | "refinance"
        | "new_build"
        | "mortgage_increase"
      lead_status:
        | "new"
        | "contacted"
        | "qualified"
        | "converted"
        | "lost"
        | "viewing_planned"
      listing_type: "sale" | "rent"
      mandate_status:
        | "draft"
        | "sent"
        | "signed"
        | "active"
        | "expired"
        | "cancelled"
      match_status:
        | "suggested"
        | "contacted"
        | "interested"
        | "rejected"
        | "converted"
        | "shortlisted"
      ownership_type: "owner" | "co_owner" | "former_owner"
      property_status:
        | "draft"
        | "available"
        | "reserved"
        | "sold"
        | "rented"
        | "archived"
        | "preparation"
        | "active"
      property_type:
        | "apartment"
        | "house"
        | "commercial"
        | "land"
        | "other"
        | "parking"
        | "mixed_use"
      reservation_status:
        | "draft"
        | "sent"
        | "signed"
        | "cancelled"
        | "converted"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status: "open" | "in_progress" | "waiting" | "done" | "cancelled"
      user_role: "owner" | "admin" | "agent" | "assistant" | "backoffice"
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
      app_role: [
        "owner",
        "agent",
        "assistant",
        "superadmin",
        "employee",
        "manager",
        "admin",
      ],
      appointment_status: ["scheduled", "completed", "cancelled"],
      appointment_type: ["viewing", "meeting", "call", "other"],
      client_relationship_type: [
        "spouse",
        "co_applicant",
        "co_investor",
        "other",
      ],
      client_role_status: ["active", "inactive", "completed", "cancelled"],
      client_role_type: [
        "buyer",
        "seller",
        "owner",
        "former_owner",
        "tenant",
        "landlord",
        "financing_applicant",
        "co_applicant",
        "investor",
        "contact_person",
        "general_contact",
      ],
      client_status: [
        "entwurf",
        "pendent",
        "vollstaendig",
        "finanzierung",
        "abgeschlossen",
        "abgelehnt",
        "storniert",
      ],
      client_type: [
        "buyer",
        "seller",
        "tenant",
        "landlord",
        "investor",
        "other",
        "owner",
      ],
      document_type: [
        "client_document",
        "property_document",
        "contract",
        "mandate",
        "reservation",
        "financing",
        "media",
        "other",
        "nda",
        "reservation_receipt",
        "mandate_partial",
      ],
      feedback_priority: ["low", "medium", "high", "critical"],
      feedback_status: [
        "new",
        "planned",
        "in_progress",
        "done",
        "rejected",
        "under_review",
        "duplicate",
        "updated",
      ],
      feedback_type: ["idea", "bug", "question", "other"],
      financing_checklist_section: [
        "customer",
        "financing_structure",
        "property_docs",
        "income_employment",
        "tax",
        "self_employed",
        "affordability",
        "additional_check",
        "submission_quality",
        "rejection_reasons",
      ],
      financing_checklist_status: [
        "open",
        "present",
        "missing",
        "not_relevant",
      ],
      financing_dossier_status: [
        "draft",
        "quick_check",
        "documents_missing",
        "ready_for_bank",
        "submitted_to_bank",
        "approved",
        "rejected",
        "cancelled",
      ],
      financing_quick_check_status: [
        "realistic",
        "critical",
        "not_financeable",
        "incomplete",
      ],
      financing_status: ["draft", "submitted", "reviewed"],
      financing_type: [
        "purchase",
        "renovation",
        "increase",
        "refinance",
        "new_build",
        "mortgage_increase",
      ],
      lead_status: [
        "new",
        "contacted",
        "qualified",
        "converted",
        "lost",
        "viewing_planned",
      ],
      listing_type: ["sale", "rent"],
      mandate_status: [
        "draft",
        "sent",
        "signed",
        "active",
        "expired",
        "cancelled",
      ],
      match_status: [
        "suggested",
        "contacted",
        "interested",
        "rejected",
        "converted",
        "shortlisted",
      ],
      ownership_type: ["owner", "co_owner", "former_owner"],
      property_status: [
        "draft",
        "available",
        "reserved",
        "sold",
        "rented",
        "archived",
        "preparation",
        "active",
      ],
      property_type: [
        "apartment",
        "house",
        "commercial",
        "land",
        "other",
        "parking",
        "mixed_use",
      ],
      reservation_status: ["draft", "sent", "signed", "cancelled", "converted"],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: ["open", "in_progress", "waiting", "done", "cancelled"],
      user_role: ["owner", "admin", "agent", "assistant", "backoffice"],
    },
  },
} as const
