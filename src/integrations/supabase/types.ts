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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_templates: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          template_key: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          template_key: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          template_key?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      ai_usage_log: {
        Row: {
          cost_estimate: number | null
          created_at: string
          feature: string
          id: string
          tokens_used: number | null
          workspace_id: string | null
        }
        Insert: {
          cost_estimate?: number | null
          created_at?: string
          feature: string
          id?: string
          tokens_used?: number | null
          workspace_id?: string | null
        }
        Update: {
          cost_estimate?: number | null
          created_at?: string
          feature?: string
          id?: string
          tokens_used?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_uploads: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          parsed: boolean | null
          parsed_at: string | null
          school_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          parsed?: boolean | null
          parsed_at?: string | null
          school_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          parsed?: boolean | null
          parsed_at?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_uploads_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      class_rotations: {
        Row: {
          created_at: string
          day_of_week: string
          grade: string
          id: string
          notes: string | null
          rotation_type: string
          school_id: string
          slot_index: number
          specialist_id: string | null
          teacher_id: string | null
          updated_at: string
          week_label: string | null
        }
        Insert: {
          created_at?: string
          day_of_week: string
          grade: string
          id?: string
          notes?: string | null
          rotation_type?: string
          school_id: string
          slot_index?: number
          specialist_id?: string | null
          teacher_id?: string | null
          updated_at?: string
          week_label?: string | null
        }
        Update: {
          created_at?: string
          day_of_week?: string
          grade?: string
          id?: string
          notes?: string | null
          rotation_type?: string
          school_id?: string
          slot_index?: number
          specialist_id?: string | null
          teacher_id?: string | null
          updated_at?: string
          week_label?: string | null
        }
        Relationships: []
      }
      classroom_teachers: {
        Row: {
          am_pm_preference: string | null
          combo_partner_id: string | null
          created_at: string
          day_preference: string | null
          email: string | null
          grade: string
          id: string
          lunch_minutes: number | null
          name: string
          phone: string | null
          planning_minutes: number | null
          planning_type: string | null
          room: string | null
          school_id: string
          team: string | null
          updated_at: string
          weekly_planning_minutes: number | null
        }
        Insert: {
          am_pm_preference?: string | null
          combo_partner_id?: string | null
          created_at?: string
          day_preference?: string | null
          email?: string | null
          grade: string
          id?: string
          lunch_minutes?: number | null
          name: string
          phone?: string | null
          planning_minutes?: number | null
          planning_type?: string | null
          room?: string | null
          school_id: string
          team?: string | null
          updated_at?: string
          weekly_planning_minutes?: number | null
        }
        Update: {
          am_pm_preference?: string | null
          combo_partner_id?: string | null
          created_at?: string
          day_preference?: string | null
          email?: string | null
          grade?: string
          id?: string
          lunch_minutes?: number | null
          name?: string
          phone?: string | null
          planning_minutes?: number | null
          planning_type?: string | null
          room?: string | null
          school_id?: string
          team?: string | null
          updated_at?: string
          weekly_planning_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "classroom_teachers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          created_at: string
          day_of_week: string | null
          description: string | null
          end_time: string | null
          grades: string | null
          id: string
          lead_specialist_id: string | null
          name: string
          school_id: string
          sessions: Json
          start_time: string | null
          suggested_end_time: string | null
          suggested_start_time: string | null
        }
        Insert: {
          created_at?: string
          day_of_week?: string | null
          description?: string | null
          end_time?: string | null
          grades?: string | null
          id?: string
          lead_specialist_id?: string | null
          name: string
          school_id: string
          sessions?: Json
          start_time?: string | null
          suggested_end_time?: string | null
          suggested_start_time?: string | null
        }
        Update: {
          created_at?: string
          day_of_week?: string | null
          description?: string | null
          end_time?: string | null
          grades?: string | null
          id?: string
          lead_specialist_id?: string | null
          name?: string
          school_id?: string
          sessions?: Json
          start_time?: string | null
          suggested_end_time?: string | null
          suggested_start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clubs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      coordinator_prep: {
        Row: {
          am_pm_preference: string | null
          cart_users: string | null
          created_at: string
          custom_grade_prefs: string | null
          day_preference: string[] | null
          dismissed_dashboard_suggestion: boolean
          district_calendar_url: string | null
          early_release_day: string | null
          early_release_end_time: string | null
          grade_preference: string | null
          has_special_rotation: boolean | null
          holiday_notes: string | null
          id: string
          mostly_monday_holidays: boolean | null
          part_time_users: string | null
          school_id: string | null
          school_site_url: string | null
          special_rotation_notes: string | null
          specialist_count: number | null
          two_school_users: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          am_pm_preference?: string | null
          cart_users?: string | null
          created_at?: string
          custom_grade_prefs?: string | null
          day_preference?: string[] | null
          dismissed_dashboard_suggestion?: boolean
          district_calendar_url?: string | null
          early_release_day?: string | null
          early_release_end_time?: string | null
          grade_preference?: string | null
          has_special_rotation?: boolean | null
          holiday_notes?: string | null
          id?: string
          mostly_monday_holidays?: boolean | null
          part_time_users?: string | null
          school_id?: string | null
          school_site_url?: string | null
          special_rotation_notes?: string | null
          specialist_count?: number | null
          two_school_users?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          am_pm_preference?: string | null
          cart_users?: string | null
          created_at?: string
          custom_grade_prefs?: string | null
          day_preference?: string[] | null
          dismissed_dashboard_suggestion?: boolean
          district_calendar_url?: string | null
          early_release_day?: string | null
          early_release_end_time?: string | null
          grade_preference?: string | null
          has_special_rotation?: boolean | null
          holiday_notes?: string | null
          id?: string
          mostly_monday_holidays?: boolean | null
          part_time_users?: string | null
          school_id?: string | null
          school_site_url?: string | null
          special_rotation_notes?: string | null
          specialist_count?: number | null
          two_school_users?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      crm_entries: {
        Row: {
          company_name: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          last_contact: string | null
          notes: string | null
          owner: string | null
          phone: string | null
          source: string | null
          stage: Database["public"]["Enums"]["crm_stage"] | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_contact?: string | null
          notes?: string | null
          owner?: string | null
          phone?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["crm_stage"] | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          last_contact?: string | null
          notes?: string | null
          owner?: string | null
          phone?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["crm_stage"] | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      export_records: {
        Row: {
          created_at: string
          created_by: string | null
          export_type: string
          file_path: string | null
          format: Database["public"]["Enums"]["export_format"]
          generation_id: string | null
          id: string
          school_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          export_type: string
          file_path?: string | null
          format: Database["public"]["Enums"]["export_format"]
          generation_id?: string | null
          id?: string
          school_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          export_type?: string
          file_path?: string | null
          format?: Database["public"]["Enums"]["export_format"]
          generation_id?: string | null
          id?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_records_generation_id_fkey"
            columns: ["generation_id"]
            isOneToOne: false
            referencedRelation: "schedule_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_plan_templates: {
        Row: {
          body: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          school_id: string
          specialist_id: string | null
          subject: string | null
          updated_at: string
        }
        Insert: {
          body?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          school_id: string
          specialist_id?: string | null
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          school_id?: string
          specialist_id?: string | null
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lesson_plans: {
        Row: {
          activities: Json
          block_id: string | null
          created_at: string
          created_by: string | null
          id: string
          materials: string | null
          notes: string | null
          objective: string | null
          plan_date: string | null
          school_id: string
          specialist_id: string | null
          standards: string[]
          title: string
          updated_at: string
        }
        Insert: {
          activities?: Json
          block_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          materials?: string | null
          notes?: string | null
          objective?: string | null
          plan_date?: string | null
          school_id: string
          specialist_id?: string | null
          standards?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          activities?: Json
          block_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          materials?: string | null
          notes?: string | null
          objective?: string | null
          plan_date?: string | null
          school_id?: string
          specialist_id?: string | null
          standards?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      license_keys: {
        Row: {
          assigned_workspace: string | null
          created_at: string
          duration_days: number | null
          expires_at: string | null
          id: string
          key: string
          max_schools: number | null
          plan: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          status: Database["public"]["Enums"]["license_status"] | null
        }
        Insert: {
          assigned_workspace?: string | null
          created_at?: string
          duration_days?: number | null
          expires_at?: string | null
          id?: string
          key: string
          max_schools?: number | null
          plan?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          status?: Database["public"]["Enums"]["license_status"] | null
        }
        Update: {
          assigned_workspace?: string | null
          created_at?: string
          duration_days?: number | null
          expires_at?: string | null
          id?: string
          key?: string
          max_schools?: number | null
          plan?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          status?: Database["public"]["Enums"]["license_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "license_keys_assigned_workspace_fkey"
            columns: ["assigned_workspace"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_enabled: boolean
          id: string
          notify_export_complete: boolean
          notify_schedule_generated: boolean
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          id?: string
          notify_export_complete?: boolean
          notify_schedule_generated?: boolean
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          id?: string
          notify_export_complete?: boolean
          notify_schedule_generated?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string | null
          read: boolean
          title: string
          type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          read?: boolean
          title: string
          type: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      parsed_calendar_events: {
        Row: {
          approved: boolean | null
          created_at: string
          end_date: string | null
          event_date: string | null
          event_type: Database["public"]["Enums"]["calendar_event_type"]
          id: string
          school_id: string
          title: string
          upload_id: string | null
        }
        Insert: {
          approved?: boolean | null
          created_at?: string
          end_date?: string | null
          event_date?: string | null
          event_type: Database["public"]["Enums"]["calendar_event_type"]
          id?: string
          school_id: string
          title: string
          upload_id?: string | null
        }
        Update: {
          approved?: boolean | null
          created_at?: string
          end_date?: string | null
          event_date?: string | null
          event_type?: Database["public"]["Enums"]["calendar_event_type"]
          id?: string
          school_id?: string
          title?: string
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parsed_calendar_events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_calendar_events_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "calendar_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recess_lunch_config: {
        Row: {
          am_recess_end: string | null
          am_recess_start: string | null
          created_at: string
          early_release_am_recess_end: string | null
          early_release_am_recess_start: string | null
          early_release_lunch_end: string | null
          early_release_lunch_start: string | null
          early_release_pm_recess_end: string | null
          early_release_pm_recess_start: string | null
          grade_band: string
          id: string
          lunch_end: string | null
          lunch_start: string | null
          pm_recess_end: string | null
          pm_recess_start: string | null
          school_id: string
        }
        Insert: {
          am_recess_end?: string | null
          am_recess_start?: string | null
          created_at?: string
          early_release_am_recess_end?: string | null
          early_release_am_recess_start?: string | null
          early_release_lunch_end?: string | null
          early_release_lunch_start?: string | null
          early_release_pm_recess_end?: string | null
          early_release_pm_recess_start?: string | null
          grade_band?: string
          id?: string
          lunch_end?: string | null
          lunch_start?: string | null
          pm_recess_end?: string | null
          pm_recess_start?: string | null
          school_id: string
        }
        Update: {
          am_recess_end?: string | null
          am_recess_start?: string | null
          created_at?: string
          early_release_am_recess_end?: string | null
          early_release_am_recess_start?: string | null
          early_release_lunch_end?: string | null
          early_release_lunch_start?: string | null
          early_release_pm_recess_end?: string | null
          early_release_pm_recess_start?: string | null
          grade_band?: string
          id?: string
          lunch_end?: string | null
          lunch_start?: string | null
          pm_recess_end?: string | null
          pm_recess_start?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recess_lunch_config_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_blocks: {
        Row: {
          created_at: string
          day_of_week: string
          end_time: string
          generation_id: string
          grade: string | null
          id: string
          is_override: boolean | null
          notes: string | null
          placement_reason: string | null
          room: string | null
          specialist_id: string | null
          start_time: string
          subject: string | null
          teacher_id: string | null
          week_label: string | null
        }
        Insert: {
          created_at?: string
          day_of_week: string
          end_time: string
          generation_id: string
          grade?: string | null
          id?: string
          is_override?: boolean | null
          notes?: string | null
          placement_reason?: string | null
          room?: string | null
          specialist_id?: string | null
          start_time: string
          subject?: string | null
          teacher_id?: string | null
          week_label?: string | null
        }
        Update: {
          created_at?: string
          day_of_week?: string
          end_time?: string
          generation_id?: string
          grade?: string | null
          id?: string
          is_override?: boolean | null
          notes?: string | null
          placement_reason?: string | null
          room?: string | null
          specialist_id?: string | null
          start_time?: string
          subject?: string | null
          teacher_id?: string | null
          week_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_blocks_generation_id_fkey"
            columns: ["generation_id"]
            isOneToOne: false
            referencedRelation: "schedule_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_specialist_id_fkey"
            columns: ["specialist_id"]
            isOneToOne: false
            referencedRelation: "specialists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "classroom_teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_generations: {
        Row: {
          attempted_strategies: Json
          chosen_strategy: string | null
          created_at: string
          fallback_reason: string | null
          feedback_signal: string | null
          generated_at: string | null
          id: string
          manual_edit_count: number | null
          monte_carlo_attempts: number | null
          quote: string | null
          sa_improvement: number | null
          sa_iterations: number | null
          school_id: string
          score_breakdown: Json | null
          status: string | null
          verify_issues_found: number | null
          verify_quality_score: number | null
          verify_summary: string | null
          version: number | null
          warnings: Json | null
          winning_score: number | null
        }
        Insert: {
          attempted_strategies?: Json
          chosen_strategy?: string | null
          created_at?: string
          fallback_reason?: string | null
          feedback_signal?: string | null
          generated_at?: string | null
          id?: string
          manual_edit_count?: number | null
          monte_carlo_attempts?: number | null
          quote?: string | null
          sa_improvement?: number | null
          sa_iterations?: number | null
          school_id: string
          score_breakdown?: Json | null
          status?: string | null
          verify_issues_found?: number | null
          verify_quality_score?: number | null
          verify_summary?: string | null
          version?: number | null
          warnings?: Json | null
          winning_score?: number | null
        }
        Update: {
          attempted_strategies?: Json
          chosen_strategy?: string | null
          created_at?: string
          fallback_reason?: string | null
          feedback_signal?: string | null
          generated_at?: string | null
          id?: string
          manual_edit_count?: number | null
          monte_carlo_attempts?: number | null
          quote?: string | null
          sa_improvement?: number | null
          sa_iterations?: number | null
          school_id?: string
          score_breakdown?: Json | null
          status?: string | null
          verify_issues_found?: number | null
          verify_quality_score?: number | null
          verify_summary?: string | null
          version?: number | null
          warnings?: Json | null
          winning_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_generations_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          admin_rotation: Json | null
          am_recess_first_bell: string | null
          am_recess_minutes: number | null
          big_group_config: Json | null
          class_duration: number | null
          conflict_grades: string[] | null
          conflict_strategies: string[] | null
          conflict_strategy:
            | Database["public"]["Enums"]["conflict_strategy"]
            | null
          conflict_timing: string | null
          contractual_minutes_extracted: Json | null
          contractual_minutes_file_path: string | null
          contractual_minutes_status: string | null
          contractual_minutes_url: string | null
          created_at: string
          default_am_pm_preference: string | null
          default_day_preference: string | null
          discovered_calendar_url: string | null
          district_website: string | null
          early_release_day: string | null
          early_release_end_time: string | null
          end_time: string | null
          extra_plt_target_minutes: number | null
          grade_time_config: Json | null
          grades_served: string[] | null
          id: string
          is_demo: boolean
          keep_grades_together: boolean
          lunch_first_bell: string | null
          lunch_minutes: number | null
          lunch_minutes_default: number | null
          name: string
          notes: string | null
          passing_time: number | null
          planning_minutes: number | null
          planning_time_when: string
          plt_label: string
          pm_recess_first_bell: string | null
          pm_recess_minutes: number | null
          recess_grade_bands: Json | null
          rotation_wheel_grades: string[]
          rotations_start_time: string | null
          schedule_type: Database["public"]["Enums"]["schedule_type"] | null
          school_year: string | null
          setup_complete: boolean | null
          setup_step: number | null
          setup_time: number | null
          start_time: string | null
          suggest_extra_plt: boolean
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          admin_rotation?: Json | null
          am_recess_first_bell?: string | null
          am_recess_minutes?: number | null
          big_group_config?: Json | null
          class_duration?: number | null
          conflict_grades?: string[] | null
          conflict_strategies?: string[] | null
          conflict_strategy?:
            | Database["public"]["Enums"]["conflict_strategy"]
            | null
          conflict_timing?: string | null
          contractual_minutes_extracted?: Json | null
          contractual_minutes_file_path?: string | null
          contractual_minutes_status?: string | null
          contractual_minutes_url?: string | null
          created_at?: string
          default_am_pm_preference?: string | null
          default_day_preference?: string | null
          discovered_calendar_url?: string | null
          district_website?: string | null
          early_release_day?: string | null
          early_release_end_time?: string | null
          end_time?: string | null
          extra_plt_target_minutes?: number | null
          grade_time_config?: Json | null
          grades_served?: string[] | null
          id?: string
          is_demo?: boolean
          keep_grades_together?: boolean
          lunch_first_bell?: string | null
          lunch_minutes?: number | null
          lunch_minutes_default?: number | null
          name: string
          notes?: string | null
          passing_time?: number | null
          planning_minutes?: number | null
          planning_time_when?: string
          plt_label?: string
          pm_recess_first_bell?: string | null
          pm_recess_minutes?: number | null
          recess_grade_bands?: Json | null
          rotation_wheel_grades?: string[]
          rotations_start_time?: string | null
          schedule_type?: Database["public"]["Enums"]["schedule_type"] | null
          school_year?: string | null
          setup_complete?: boolean | null
          setup_step?: number | null
          setup_time?: number | null
          start_time?: string | null
          suggest_extra_plt?: boolean
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          admin_rotation?: Json | null
          am_recess_first_bell?: string | null
          am_recess_minutes?: number | null
          big_group_config?: Json | null
          class_duration?: number | null
          conflict_grades?: string[] | null
          conflict_strategies?: string[] | null
          conflict_strategy?:
            | Database["public"]["Enums"]["conflict_strategy"]
            | null
          conflict_timing?: string | null
          contractual_minutes_extracted?: Json | null
          contractual_minutes_file_path?: string | null
          contractual_minutes_status?: string | null
          contractual_minutes_url?: string | null
          created_at?: string
          default_am_pm_preference?: string | null
          default_day_preference?: string | null
          discovered_calendar_url?: string | null
          district_website?: string | null
          early_release_day?: string | null
          early_release_end_time?: string | null
          end_time?: string | null
          extra_plt_target_minutes?: number | null
          grade_time_config?: Json | null
          grades_served?: string[] | null
          id?: string
          is_demo?: boolean
          keep_grades_together?: boolean
          lunch_first_bell?: string | null
          lunch_minutes?: number | null
          lunch_minutes_default?: number | null
          name?: string
          notes?: string | null
          passing_time?: number | null
          planning_minutes?: number | null
          planning_time_when?: string
          plt_label?: string
          pm_recess_first_bell?: string | null
          pm_recess_minutes?: number | null
          recess_grade_bands?: Json | null
          rotation_wheel_grades?: string[]
          rotations_start_time?: string | null
          schedule_type?: Database["public"]["Enums"]["schedule_type"] | null
          school_year?: string | null
          setup_complete?: boolean | null
          setup_step?: number | null
          setup_time?: number | null
          start_time?: string | null
          suggest_extra_plt?: boolean
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schools_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_weight_profiles: {
        Row: {
          created_at: string
          id: string
          last_updated: string | null
          sample_count: number
          school_id: string
          weights: Json
        }
        Insert: {
          created_at?: string
          id?: string
          last_updated?: string | null
          sample_count?: number
          school_id: string
          weights?: Json
        }
        Update: {
          created_at?: string
          id?: string
          last_updated?: string | null
          sample_count?: number
          school_id?: string
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "scoring_weight_profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      special_events: {
        Row: {
          created_at: string
          date_mode: string
          end_time: string | null
          event_date: string | null
          event_month: string | null
          event_type: string | null
          id: string
          name: string
          notes: string | null
          school_id: string
          start_time: string | null
        }
        Insert: {
          created_at?: string
          date_mode?: string
          end_time?: string | null
          event_date?: string | null
          event_month?: string | null
          event_type?: string | null
          id?: string
          name: string
          notes?: string | null
          school_id: string
          start_time?: string | null
        }
        Update: {
          created_at?: string
          date_mode?: string
          end_time?: string | null
          event_date?: string | null
          event_month?: string | null
          event_type?: string | null
          id?: string
          name?: string
          notes?: string | null
          school_id?: string
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "special_events_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      specialists: {
        Row: {
          additional_minutes: Json
          class_duration: number | null
          created_at: string
          days_at_second_school: string[] | null
          days_at_third_school: string[] | null
          extra_minutes: number | null
          grade_rotation: Json | null
          id: string
          is_part_time: boolean | null
          location: string | null
          lunch_minutes: number | null
          name: string
          notes: string | null
          part_time_lunch_minutes: number | null
          part_time_planning_minutes: number | null
          planning_minutes: number | null
          planning_preferences: string | null
          planning_type: string | null
          plus_rotation: Json | null
          school_id: string
          second_location: string | null
          second_school_name: string | null
          subject: string
          third_location: string | null
          third_school_name: string | null
          three_schools: boolean | null
          two_schools: boolean | null
          updated_at: string
          uses_cart: boolean | null
          weekly_planning_minutes: number | null
          working_days: string[] | null
        }
        Insert: {
          additional_minutes?: Json
          class_duration?: number | null
          created_at?: string
          days_at_second_school?: string[] | null
          days_at_third_school?: string[] | null
          extra_minutes?: number | null
          grade_rotation?: Json | null
          id?: string
          is_part_time?: boolean | null
          location?: string | null
          lunch_minutes?: number | null
          name: string
          notes?: string | null
          part_time_lunch_minutes?: number | null
          part_time_planning_minutes?: number | null
          planning_minutes?: number | null
          planning_preferences?: string | null
          planning_type?: string | null
          plus_rotation?: Json | null
          school_id: string
          second_location?: string | null
          second_school_name?: string | null
          subject: string
          third_location?: string | null
          third_school_name?: string | null
          three_schools?: boolean | null
          two_schools?: boolean | null
          updated_at?: string
          uses_cart?: boolean | null
          weekly_planning_minutes?: number | null
          working_days?: string[] | null
        }
        Update: {
          additional_minutes?: Json
          class_duration?: number | null
          created_at?: string
          days_at_second_school?: string[] | null
          days_at_third_school?: string[] | null
          extra_minutes?: number | null
          grade_rotation?: Json | null
          id?: string
          is_part_time?: boolean | null
          location?: string | null
          lunch_minutes?: number | null
          name?: string
          notes?: string | null
          part_time_lunch_minutes?: number | null
          part_time_planning_minutes?: number | null
          planning_minutes?: number | null
          planning_preferences?: string | null
          planning_type?: string | null
          plus_rotation?: Json | null
          school_id?: string
          second_location?: string | null
          second_school_name?: string | null
          subject?: string
          third_location?: string | null
          third_school_name?: string | null
          three_schools?: boolean | null
          two_schools?: boolean | null
          updated_at?: string
          uses_cart?: boolean | null
          weekly_planning_minutes?: number | null
          working_days?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "specialists_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_reply: string | null
          created_at: string
          id: string
          message: string
          status: string
          subject: string
          updated_at: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          admin_reply?: string | null
          created_at?: string
          id?: string
          message: string
          status?: string
          subject: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          admin_reply?: string | null
          created_at?: string
          id?: string
          message?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          access_source: Database["public"]["Enums"]["access_source"] | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          access_source?: Database["public"]["Enums"]["access_source"] | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          access_source?: Database["public"]["Enums"]["access_source"] | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_workspace_member: { Args: { _workspace_id: string }; Returns: boolean }
    }
    Enums: {
      access_source: "stripe" | "license" | "admin_override" | "enterprise"
      app_role:
        | "owner"
        | "admin"
        | "specialist_teacher"
        | "classroom_teacher"
        | "office_staff"
        | "viewer"
      calendar_event_type:
        | "holiday"
        | "teacher_workday"
        | "no_school"
        | "early_release"
        | "closure"
        | "event"
        | "first_day"
        | "last_day"
      conflict_strategy:
        | "standard"
        | "ab_week"
        | "quick_30"
        | "big_group"
        | "makeup"
        | "extra_rotation"
      crm_stage: "lead" | "prospect" | "trial" | "customer" | "churned"
      export_format: "pdf" | "csv" | "excel" | "docx"
      license_status: "active" | "redeemed" | "expired" | "revoked"
      schedule_type: "whole_school" | "staggered"
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
      access_source: ["stripe", "license", "admin_override", "enterprise"],
      app_role: [
        "owner",
        "admin",
        "specialist_teacher",
        "classroom_teacher",
        "office_staff",
        "viewer",
      ],
      calendar_event_type: [
        "holiday",
        "teacher_workday",
        "no_school",
        "early_release",
        "closure",
        "event",
        "first_day",
        "last_day",
      ],
      conflict_strategy: [
        "standard",
        "ab_week",
        "quick_30",
        "big_group",
        "makeup",
        "extra_rotation",
      ],
      crm_stage: ["lead", "prospect", "trial", "customer", "churned"],
      export_format: ["pdf", "csv", "excel", "docx"],
      license_status: ["active", "redeemed", "expired", "revoked"],
      schedule_type: ["whole_school", "staggered"],
    },
  },
} as const
