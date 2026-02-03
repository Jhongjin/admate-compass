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
    PostgrestVersion: "13.0.4"
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
      admin_users: {
        Row: {
          created_at: string | null
          email: string
          granted_at: string | null
          granted_by: string | null
          id: number
          is_active: boolean | null
          revoked_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          granted_at?: string | null
          granted_by?: string | null
          id?: number
          is_active?: boolean | null
          revoked_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          granted_at?: string | null
          granted_by?: string | null
          id?: number
          is_active?: boolean | null
          revoked_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      api_usage_logs: {
        Row: {
          conversation_id: number | null
          cost_usd: number | null
          created_at: string | null
          id: string
          input_tokens: number
          metadata: Json | null
          model: string
          output_tokens: number
          provider: string
          total_tokens: number
          user_id: string | null
        }
        Insert: {
          conversation_id?: number | null
          cost_usd?: number | null
          created_at?: string | null
          id?: string
          input_tokens?: number
          metadata?: Json | null
          model: string
          output_tokens?: number
          provider: string
          total_tokens?: number
          user_id?: string | null
        }
        Update: {
          conversation_id?: number | null
          cost_usd?: number | null
          created_at?: string | null
          id?: string
          input_tokens?: number
          metadata?: Json | null
          model?: string
          output_tokens?: number
          provider?: string
          total_tokens?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          ai_response: string
          conversation_id: string
          created_at: string | null
          id: number
          is_favorite: boolean | null
          sources: Json | null
          updated_at: string | null
          user_id: string
          user_message: string
        }
        Insert: {
          ai_response: string
          conversation_id: string
          created_at?: string | null
          id?: number
          is_favorite?: boolean | null
          sources?: Json | null
          updated_at?: string | null
          user_id: string
          user_message: string
        }
        Update: {
          ai_response?: string
          conversation_id?: string
          created_at?: string | null
          id?: number
          is_favorite?: boolean | null
          sources?: Json | null
          updated_at?: string | null
          user_id?: string
          user_message?: string
        }
        Relationships: []
      }
      discovered_urls: {
        Row: {
          created_at: string | null
          depth: number
          id: string
          job_id: string | null
          parent_url: string | null
          path: Json | null
          selected: boolean | null
          source: string
          title: string | null
          updated_at: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          depth: number
          id?: string
          job_id?: string | null
          parent_url?: string | null
          path?: Json | null
          selected?: boolean | null
          source: string
          title?: string | null
          updated_at?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          depth?: number
          id?: string
          job_id?: string | null
          parent_url?: string | null
          path?: Json | null
          selected?: boolean | null
          source?: string
          title?: string | null
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovered_urls_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "processing_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunk_weights: {
        Row: {
          chunk_id: string
          created_at: string | null
          document_id: string
          id: number
          last_updated: string | null
          negative_feedback_count: number | null
          positive_feedback_count: number | null
          weight_score: number | null
        }
        Insert: {
          chunk_id: string
          created_at?: string | null
          document_id: string
          id?: number
          last_updated?: string | null
          negative_feedback_count?: number | null
          positive_feedback_count?: number | null
          weight_score?: number | null
        }
        Update: {
          chunk_id?: string
          created_at?: string | null
          document_id?: string
          id?: number
          last_updated?: string | null
          negative_feedback_count?: number | null
          positive_feedback_count?: number | null
          weight_score?: number | null
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          chunk_id: number
          content: string
          created_at: string | null
          document_id: string
          embedding: string | null
          hierarchy_level: string | null
          id: string
          metadata: Json | null
          parent_chunk_id: string | null
        }
        Insert: {
          chunk_id: number
          content: string
          created_at?: string | null
          document_id: string
          embedding?: string | null
          hierarchy_level?: string | null
          id: string
          metadata?: Json | null
          parent_chunk_id?: string | null
        }
        Update: {
          chunk_id?: number
          content?: string
          created_at?: string | null
          document_id?: string
          embedding?: string | null
          hierarchy_level?: string | null
          id?: string
          metadata?: Json | null
          parent_chunk_id?: string | null
        }
        Relationships: []
      }
      document_chunks_backup_768: {
        Row: {
          chunk_id: string | null
          content: string | null
          created_at: string | null
          document_id: string | null
          embedding: string | null
          id: number | null
          metadata: Json | null
        }
        Insert: {
          chunk_id?: string | null
          content?: string | null
          created_at?: string | null
          document_id?: string | null
          embedding?: string | null
          id?: number | null
          metadata?: Json | null
        }
        Update: {
          chunk_id?: string | null
          content?: string | null
          created_at?: string | null
          document_id?: string | null
          embedding?: string | null
          id?: number | null
          metadata?: Json | null
        }
        Relationships: []
      }
      document_metadata: {
        Row: {
          chunk_count: number | null
          created_at: string | null
          embedding_count: number | null
          id: string
          metadata: Json | null
          original_file_name: string | null
          processed_at: string | null
          size: number
          status: string
          title: string
          type: string
          updated_at: string | null
          uploaded_at: string
        }
        Insert: {
          chunk_count?: number | null
          created_at?: string | null
          embedding_count?: number | null
          id: string
          metadata?: Json | null
          original_file_name?: string | null
          processed_at?: string | null
          size: number
          status?: string
          title: string
          type: string
          updated_at?: string | null
          uploaded_at: string
        }
        Update: {
          chunk_count?: number | null
          created_at?: string | null
          embedding_count?: number | null
          id?: string
          metadata?: Json | null
          original_file_name?: string | null
          processed_at?: string | null
          size?: number
          status?: string
          title?: string
          type?: string
          updated_at?: string | null
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_metadata_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_processing_logs: {
        Row: {
          created_at: string | null
          document_id: string
          error: string | null
          id: number
          message: string | null
          metadata: Json | null
          status: string
          step: string
        }
        Insert: {
          created_at?: string | null
          document_id: string
          error?: string | null
          id?: number
          message?: string | null
          metadata?: Json | null
          status: string
          step: string
        }
        Update: {
          created_at?: string | null
          document_id?: string
          error?: string | null
          id?: number
          message?: string | null
          metadata?: Json | null
          status?: string
          step?: string
        }
        Relationships: []
      }
      document_splits: {
        Row: {
          content: string
          created_at: string | null
          document_id: string
          end_char: number | null
          id: string
          job_id: string | null
          page_number: number | null
          section_title: string | null
          split_count: number
          split_index: number
          start_char: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          document_id: string
          end_char?: number | null
          id?: string
          job_id?: string | null
          page_number?: number | null
          section_title?: string | null
          split_count: number
          split_index: number
          start_char?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          document_id?: string
          end_char?: number | null
          id?: string
          job_id?: string | null
          page_number?: number | null
          section_title?: string | null
          split_count?: number
          split_index?: number
          start_char?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_splits_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_splits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "processing_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          chunk_count: number | null
          content: string | null
          created_at: string | null
          document_url: string | null
          file_size: number | null
          file_type: string | null
          id: string
          main_document_id: string | null
          original_file_name: string | null
          sanitized_file_name: string | null
          size: number | null
          source_vendor: string | null
          split_status: Json | null
          status: string | null
          title: string
          type: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          chunk_count?: number | null
          content?: string | null
          created_at?: string | null
          document_url?: string | null
          file_size?: number | null
          file_type?: string | null
          id: string
          main_document_id?: string | null
          original_file_name?: string | null
          sanitized_file_name?: string | null
          size?: number | null
          source_vendor?: string | null
          split_status?: Json | null
          status?: string | null
          title: string
          type: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          chunk_count?: number | null
          content?: string | null
          created_at?: string | null
          document_url?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          main_document_id?: string | null
          original_file_name?: string | null
          sanitized_file_name?: string | null
          size?: number | null
          source_vendor?: string | null
          split_status?: Json | null
          status?: string | null
          title?: string
          type?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_main_document_id_fkey"
            columns: ["main_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          conversation_id: string
          created_at: string | null
          helpful: boolean
          id: number
          message_id: string
          sources: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          helpful: boolean
          id?: number
          message_id: string
          sources?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          helpful?: boolean
          id?: number
          message_id?: string
          sources?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      log_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_status: string | null
          created_at: string | null
          email_count: number | null
          first_sent_at: string | null
          id: number
          ip_address: string | null
          last_sent_at: string | null
          log_id: string
          log_level: string
          log_message: string
          log_timestamp: string | null
          log_type: string
          next_send_at: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_status?: string | null
          created_at?: string | null
          email_count?: number | null
          first_sent_at?: string | null
          id?: number
          ip_address?: string | null
          last_sent_at?: string | null
          log_id: string
          log_level: string
          log_message: string
          log_timestamp?: string | null
          log_type: string
          next_send_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_status?: string | null
          created_at?: string | null
          email_count?: number | null
          first_sent_at?: string | null
          id?: number
          ip_address?: string | null
          last_sent_at?: string | null
          log_id?: string
          log_level?: string
          log_message?: string
          log_timestamp?: string | null
          log_type?: string
          next_send_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ollama_document_chunks: {
        Row: {
          chunk_id: string
          content: string
          created_at: string | null
          document_id: string
          embedding: string | null
          id: number
          metadata: Json | null
          updated_at: string | null
        }
        Insert: {
          chunk_id: string
          content: string
          created_at?: string | null
          document_id: string
          embedding?: string | null
          id?: number
          metadata?: Json | null
          updated_at?: string | null
        }
        Update: {
          chunk_id?: string
          content?: string
          created_at?: string | null
          document_id?: string
          embedding?: string | null
          id?: number
          metadata?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      processing_jobs: {
        Row: {
          attempts: number
          created_at: string | null
          document_id: string | null
          error: string | null
          finished_at: string | null
          id: string
          job_type: string
          max_attempts: number
          payload: Json | null
          priority: number
          result: Json | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string | null
          document_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          job_type: string
          max_attempts?: number
          payload?: Json | null
          priority?: number
          result?: Json | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string | null
          document_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          job_type?: string
          max_attempts?: number
          payload?: Json | null
          priority?: number
          result?: Json | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_metrics: {
        Row: {
          bytes: number | null
          chunks: number | null
          created_at: string
          dl_ms: number | null
          document_id: string | null
          emb_ms: number | null
          id: string
          job_id: string | null
          note: string | null
          ocr_ms: number | null
          parse_ms: number | null
          text_length: number | null
          total_ms: number | null
        }
        Insert: {
          bytes?: number | null
          chunks?: number | null
          created_at?: string
          dl_ms?: number | null
          document_id?: string | null
          emb_ms?: number | null
          id?: string
          job_id?: string | null
          note?: string | null
          ocr_ms?: number | null
          parse_ms?: number | null
          text_length?: number | null
          total_ms?: number | null
        }
        Update: {
          bytes?: number | null
          chunks?: number | null
          created_at?: string
          dl_ms?: number | null
          document_id?: string | null
          emb_ms?: number | null
          id?: string
          job_id?: string | null
          note?: string | null
          ocr_ms?: number | null
          parse_ms?: number | null
          text_length?: number | null
          total_ms?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          name: string | null
          team: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id: string
          name?: string | null
          team?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string | null
          team?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      url_templates: {
        Row: {
          created_at: string | null
          id: number
          name: string
          updated_at: string | null
          urls: string[]
        }
        Insert: {
          created_at?: string | null
          id?: number
          name: string
          updated_at?: string | null
          urls: string[]
        }
        Update: {
          created_at?: string | null
          id?: number
          name?: string
          updated_at?: string | null
          urls?: string[]
        }
        Relationships: []
      }
    }
    Views: {
      chunk_weight_stats: {
        Row: {
          avg_weight: number | null
          max_weight: number | null
          min_weight: number | null
          total_chunks_with_weights: number | null
          total_negative_feedback: number | null
          total_positive_feedback: number | null
        }
        Relationships: []
      }
      conversation_stats: {
        Row: {
          first_conversation: string | null
          last_conversation: string | null
          total_conversations: number | null
          unique_conversations: number | null
          user_id: string | null
        }
        Relationships: []
      }
      feedback_stats: {
        Row: {
          count: number | null
          date: string | null
          helpful: boolean | null
        }
        Relationships: []
      }
      team_question_stats: {
        Row: {
          avg_response_time: number | null
          question_count: number | null
          questions_30d: number | null
          questions_7d: number | null
          team: string | null
        }
        Relationships: []
      }
      team_user_stats: {
        Row: {
          first_user_created: string | null
          last_user_created: string | null
          new_users_30d: number | null
          new_users_7d: number | null
          team: string | null
          user_count: number | null
        }
        Relationships: []
      }
      total_feedback_stats: {
        Row: {
          negative_feedback: number | null
          positive_feedback: number | null
          positive_percentage: number | null
          total_feedback: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_chunk_weight: {
        Args: { negative_count: number; positive_count: number }
        Returns: number
      }
      check_email_exists: { Args: { input_email: string }; Returns: boolean }
      check_embedding_dimensions: {
        Args: never
        Returns: {
          chunk_id: string
          dimension: number
          embedding_type: string
          sample_values: number[]
        }[]
      }
      check_vector_dimensions: {
        Args: never
        Returns: {
          chunk_id: string
          embedding_text: string
          error_message: string
          parse_success: boolean
          vector_dimension: number
        }[]
      }
      clean_text_encoding: { Args: { input_text: string }; Returns: string }
      cleanup_old_discovered_urls: { Args: never; Returns: undefined }
      get_app_setting: { Args: { setting_key: string }; Returns: string }
      get_chunk_hierarchy: {
        Args: { p_chunk_id?: string; p_document_id: string }
        Returns: {
          chunk_id: string
          content: string
          depth: number
          hierarchy_level: string
          metadata: Json
          parent_chunk_id: string
          path: string[]
        }[]
      }
      get_chunk_metadata_stats: {
        Args: never
        Returns: {
          avg_chunk_size: number
          avg_confidence: number
          avg_importance: number
          chunk_type: string
          total_count: number
        }[]
      }
      get_chunks_by_level: {
        Args: { p_document_id: string; p_level: string }
        Returns: {
          chunk_id: string
          content: string
          metadata: Json
          parent_chunk_id: string
          sibling_count: number
        }[]
      }
      get_daily_api_usage: {
        Args: { end_date?: string; start_date?: string }
        Returns: {
          date: string
          provider: string
          total_cost_usd: number
          total_input_tokens: number
          total_output_tokens: number
          total_requests: number
          total_tokens: number
        }[]
      }
      get_database_size: { Args: never; Returns: string }
      get_edge_function_url: { Args: never; Returns: string }
      get_hierarchy_stats: {
        Args: { p_document_id?: string }
        Returns: {
          avg_content_length: number
          chunk_count: number
          document_id: string
          hierarchy_level: string
          max_depth: number
        }[]
      }
      get_monthly_api_usage: {
        Args: { months_back?: number }
        Returns: {
          month: string
          provider: string
          total_cost_usd: number
          total_input_tokens: number
          total_output_tokens: number
          total_requests: number
          total_tokens: number
        }[]
      }
      get_service_role_key: { Args: never; Returns: string }
      get_team_question_stats: {
        Args: never
        Returns: {
          avg_response_time: number
          question_count: number
          questions_30d: number
          questions_7d: number
          team: string
        }[]
      }
      get_team_user_stats: {
        Args: never
        Returns: {
          first_user_created: string
          last_user_created: string
          new_users_30d: number
          new_users_7d: number
          team: string
          user_count: number
        }[]
      }
      get_vector_index_stats: {
        Args: never
        Returns: {
          index_name: string
          index_scans: number
          index_size: string
          table_name: string
          tuples_fetched: number
          tuples_read: number
        }[]
      }
      increment_email_count: { Args: { alert_id: number }; Returns: number }
      is_admin_user: { Args: { user_email: string }; Returns: boolean }
      is_valid_utf8: { Args: { input_text: string }; Returns: boolean }
      match_documents: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      search_chunks_by_importance: {
        Args: {
          match_count?: number
          min_importance?: number
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          content: string
          importance: number
          metadata: Json
          similarity: number
        }[]
      }
      search_chunks_by_type: {
        Args: {
          chunk_type_filter?: string[]
          match_count?: number
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          chunk_type: string
          content: string
          metadata: Json
          similarity: number
        }[]
      }
      search_documents: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
          vendor_filter?: string[]
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          document_type: string
          metadata: Json
          similarity: number
          source_vendor: string
          title: string
        }[]
      }
      search_documents_backup: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
          vendor_filter?: string[]
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          metadata: Json
          similarity: number
          source_vendor: string
          title: string
        }[]
      }
      search_documents_by_text: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_text: string
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          metadata: Json
          similarity: number
          title: string
        }[]
      }
      search_documents_with_weights: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
          vendor_filter?: string[]
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          document_type: string
          metadata: Json
          similarity: number
          source_vendor: string
          title: string
          weighted_similarity: number
        }[]
      }
      search_ollama_documents: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          content: string
          embedding: string
          metadata: Json
          similarity: number
        }[]
      }
      search_similar_chunks: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_text: string
        }
        Returns: {
          chunk_id: string
          content: string
          created_at: string
          document_id: string
          metadata: Json
          similarity: number
        }[]
      }
      test_search_performance: {
        Args: { iterations?: number; test_query_embedding: string }
        Returns: {
          execution_time_ms: number
          iteration: number
          result_count: number
        }[]
      }
      test_vector_parsing: {
        Args: { test_embedding: unknown }
        Returns: {
          dimension: number
          input_type: string
          parsed_type: string
          sample_values: number[]
        }[]
      }
      update_app_setting: {
        Args: { setting_key: string; setting_value: string }
        Returns: boolean
      }
      validate_chunk_metadata: {
        Args: { metadata_json: Json }
        Returns: boolean
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
