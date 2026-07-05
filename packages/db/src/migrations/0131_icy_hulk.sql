CREATE TABLE "agent_bridge_reply_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"room_id" uuid,
	"agent_id" uuid,
	"content_length" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"error_detail" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"delegation_id" uuid,
	"room_id" text,
	"turn_id" text NOT NULL,
	"kind" text NOT NULL,
	"tool_name" text,
	"mutated" boolean,
	"artifact" jsonb,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_dev_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"kind" text DEFAULT 'app' NOT NULL,
	"feedback_origin_id" text,
	"repo" text,
	"owner_agent_id" uuid,
	"accent" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_dev_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"starter_stack" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribute_controls" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"control_type" text NOT NULL,
	"category" text NOT NULL,
	"prompt_template" text NOT NULL,
	"helper_text" text,
	"sort_order" integer DEFAULT 0,
	"applicable_to" jsonb,
	"enabled" boolean DEFAULT true,
	CONSTRAINT "attribute_controls_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "attribute_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"control_id" integer,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"prompt_fragment" text NOT NULL,
	"preview_image_path" text,
	"sort_order" integer DEFAULT 0,
	"enabled" boolean DEFAULT true,
	"content_rating" text DEFAULT 'sfw'
);
--> statement-breakpoint
CREATE TABLE "book_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text DEFAULT 'export' NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"output_path" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "_bridge_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_message" text NOT NULL,
	"checksum" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_upload_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text,
	"step" text DEFAULT 'upload' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"strategy" text,
	"strategy_config" jsonb,
	"metadata" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bulk_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"draft_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"detected_type" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"caption" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_suggested_caption" text,
	"scheduled_post_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_jarvis_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"auto_brief_on_load" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_secret_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"secret_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"config_path" text NOT NULL,
	"version_selector" text DEFAULT 'latest' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_secret_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_status" text,
	"health_checked_at" timestamp with time zone,
	"health_message" text,
	"health_details" jsonb,
	"disabled_at" timestamp with time zone,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"run_id" uuid NOT NULL,
	"kind" text DEFAULT 'image' NOT NULL,
	"path" text NOT NULL,
	"url" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"slide_index" integer DEFAULT 0 NOT NULL,
	"skill" text,
	"prompt" text,
	"agent_id" text,
	"persona" text,
	"favorited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_preset_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"preset_slug" text NOT NULL,
	"brief" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"child_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "design_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"skill" text NOT NULL,
	"agent_id" text DEFAULT 'claude' NOT NULL,
	"design_system_id" text,
	"prompt" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_type" text DEFAULT 'html' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"od_run_id" text,
	"od_project_id" text,
	"asset_path" text,
	"asset_url" text,
	"preview_url" text,
	"png_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mp4_path" text,
	"raster_status" text DEFAULT 'pending' NOT NULL,
	"raster_error" text,
	"preset_run_id" uuid,
	"idempotency_key" text,
	"error" text,
	"token_cost_usd" numeric(12, 6),
	"render_cost_usd" numeric(12, 6),
	"tokens_in" integer,
	"tokens_out" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"prompt_template_id" uuid,
	"batch_id" uuid NOT NULL,
	"provider_host" text DEFAULT 'replicate' NOT NULL,
	"model" text,
	"prompt_text" text NOT NULL,
	"lora_scale" numeric(4, 2),
	"steps" integer,
	"guidance" numeric(4, 2),
	"aspect_ratio" text,
	"seed" bigint,
	"status" text DEFAULT 'queued' NOT NULL,
	"replicate_prediction_id" text,
	"output_path" text,
	"content_rating" text DEFAULT 'sfw' NOT NULL,
	"cost_usd" numeric(10, 4),
	"cost_estimate_usd" numeric(10, 4),
	"actual_cost_usd" numeric(10, 4),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gym_agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"prompt_candidate_id" uuid,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"average_score" integer,
	"best_score" integer,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"suite_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scores" jsonb,
	"overall_score" integer,
	"model_used" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"prompt_candidate_id" uuid,
	"agent_profile_id" uuid,
	"duration_ms" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_eval_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"test_cases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_prompt_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt_template" text,
	"model" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"temperature" integer DEFAULT 70 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"type" text DEFAULT 'external_api' NOT NULL,
	"provider_host" text DEFAULT 'replicate' NOT NULL,
	"provider_key" text,
	"endpoint" text,
	"model" text,
	"default_params" jsonb,
	"bio" text,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"cost_per_unit" numeric(10, 6) DEFAULT '0' NOT NULL,
	"status" text,
	"status_detail" text,
	"training_capable" boolean DEFAULT false NOT NULL,
	"training_model" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"group_id" uuid,
	"avatar_path" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_recovery_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_issue_id" uuid NOT NULL,
	"recovery_issue_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_type" text DEFAULT 'agent' NOT NULL,
	"owner_agent_id" uuid,
	"owner_user_id" text,
	"previous_owner_agent_id" uuid,
	"return_owner_agent_id" uuid,
	"cause" text NOT NULL,
	"fingerprint" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_action" text NOT NULL,
	"wake_policy" jsonb,
	"monitor_policy" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer,
	"timeout_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"outcome" text,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"ref_type" text,
	"ref_id" text,
	"metadata" jsonb,
	"severity" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jarvis_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_actor_id" text NOT NULL,
	"user_transcript" text NOT NULL,
	"agent_reply" text NOT NULL,
	"voice_tier" text DEFAULT 'browser-native' NOT NULL,
	"llm_provider" text,
	"llm_model" text,
	"persona_version" text,
	"response_type" text,
	"truncated" boolean DEFAULT false,
	"source" text,
	"context_snapshot" jsonb,
	"latency_ms" text,
	"interrupted_at" timestamp with time zone,
	"interrupted_at_chars" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jarvis_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid,
	"agent" text NOT NULL,
	"task" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" text,
	"metadata" jsonb,
	"requested_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jarvis_learned_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_actor_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_message_id" uuid,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"source_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"properties" jsonb,
	"source_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_hubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"top_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lora_training_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"persona_id" uuid NOT NULL,
	"provider_id" uuid,
	"provider_host" text DEFAULT 'replicate' NOT NULL,
	"trainer_model" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"content_rating" text DEFAULT 'sfw' NOT NULL,
	"external_job_id" text,
	"training_zip_path" text,
	"output_lora_path" text,
	"trigger_word" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cost_usd" numeric(10, 4),
	"error_message" text,
	"hyperparams" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"source" text DEFAULT 'production' NOT NULL,
	"provider_host" text,
	"prompt" text,
	"lora_strength" numeric(4, 2),
	"model" text,
	"image_path" text NOT NULL,
	"thumbnail_path" text,
	"generation_metadata" jsonb,
	"replicate_prediction_id" text,
	"cost_usd" numeric(10, 4),
	"content_rating" text DEFAULT 'sfw' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"persona_id" uuid,
	"template_text" text NOT NULL,
	"default_lora_scale" numeric(4, 2),
	"default_steps" integer,
	"default_guidance" numeric(4, 2),
	"default_aspect_ratio" text,
	"content_rating" text DEFAULT 'sfw' NOT NULL,
	"tags" text[],
	"attribute_preset" jsonb DEFAULT '{}'::jsonb,
	"preview_image_path" text,
	"preview_image_paths" jsonb DEFAULT '[]'::jsonb,
	"category" text,
	"gender_targeting" text DEFAULT 'any',
	"applicable_tools" text[] DEFAULT '{"photoshoot"}',
	"compatible_models" text[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"agent_id" uuid,
	"user_id" uuid,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"sender_type" text NOT NULL,
	"content" text NOT NULL,
	"message_type" text DEFAULT 'chat' NOT NULL,
	"metadata" jsonb,
	"parent_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"type" text DEFAULT 'collaboration' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"secret_id" uuid NOT NULL,
	"version" integer,
	"provider" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"consumer_type" text NOT NULL,
	"consumer_id" text NOT NULL,
	"config_path" text,
	"issue_id" uuid,
	"heartbeat_run_id" uuid,
	"plugin_id" uuid,
	"outcome" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"username" text,
	"avatar_url" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"oauth_access_token_encrypted" jsonb,
	"oauth_refresh_token_encrypted" jsonb,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connect_method" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"metadata" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_app_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" jsonb NOT NULL,
	"client_secret_last4" text,
	"redirect_uri" text,
	"consumer_key" text,
	"consumer_secret_encrypted" jsonb,
	"consumer_secret_last4" text,
	"bearer_token_encrypted" jsonb,
	"bearer_token_last4" text,
	"default_scopes" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated_at" timestamp with time zone,
	"last_validation_status" text,
	"last_validation_message" text
);
--> statement-breakpoint
CREATE TABLE "social_dms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"social_account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text NOT NULL,
	"direction" text NOT NULL,
	"sender_platform_user_id" text,
	"sender_handle" text,
	"sender_display_name" text,
	"sender_avatar_url" text,
	"sender_verified" boolean DEFAULT false NOT NULL,
	"sender_is_first_contact" boolean DEFAULT false NOT NULL,
	"text" text,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_post_id" text,
	"platform_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"error_message" text,
	"published_at" timestamp with time zone,
	"analytics" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"post_type" text DEFAULT 'text' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prompt_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text DEFAULT 'misc' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"source" text,
	"source_url" text,
	"license" text,
	"created_by" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reel_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reel_id" uuid NOT NULL,
	"scene_index" integer NOT NULL,
	"description" text NOT NULL,
	"camera_framing" text,
	"emotion" text,
	"scene_duration_seconds" numeric(4, 2) NOT NULL,
	"keyframe_prompt" text NOT NULL,
	"motion_hint" text,
	"keyframe_job_id" text,
	"keyframe_provider_host" text,
	"keyframe_image_url" text,
	"keyframe_image_local_path" text,
	"keyframe_cost_usd" numeric(8, 4),
	"video_job_id" text,
	"video_provider_host" text,
	"video_model" text,
	"video_clip_url" text,
	"video_clip_local_path" text,
	"video_cost_usd" numeric(8, 4),
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reel_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"title" text NOT NULL,
	"narrative_arc" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reel_series_entries" (
	"series_id" uuid NOT NULL,
	"reel_id" uuid NOT NULL,
	"episode_index" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reel_series_entries_series_id_reel_id_pk" PRIMARY KEY("series_id","reel_id")
);
--> statement-breakpoint
CREATE TABLE "reel_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"niche" text,
	"name" text NOT NULL,
	"description" text,
	"style_preset" text NOT NULL,
	"prompt_scaffold" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"aspect_ratio" text NOT NULL,
	"default_music_mood" text,
	"default_video_provider" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"title" text,
	"prompt" text NOT NULL,
	"style_preset" text,
	"duration_seconds" integer NOT NULL,
	"aspect_ratio" text NOT NULL,
	"director_title" text,
	"music_mood" text,
	"status" text NOT NULL,
	"error_message" text,
	"final_video_url" text,
	"final_video_local_path" text,
	"thumbnail_url" text,
	"final_duration_seconds" numeric(6, 2),
	"total_cost_usd" numeric(10, 4),
	"posted_to_platforms" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "skill_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"actor_type" text DEFAULT 'agent' NOT NULL,
	"actor_id" text,
	"agent_name" text,
	"context" text,
	"outcome" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_bible_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"voice_card" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_bible_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_bible_outline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_number" integer DEFAULT 1 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_bible_style" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"pov" text DEFAULT '' NOT NULL,
	"tense" text DEFAULT '' NOT NULL,
	"comps" text DEFAULT '' NOT NULL,
	"sample_paragraph" text DEFAULT '' NOT NULL,
	"banned_cliches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_bible_world_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensory_notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"delegation_id" uuid NOT NULL,
	"depends_on_delegation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "agent_bridge" jsonb;--> statement-breakpoint
ALTER TABLE "company_secret_versions" ADD COLUMN "provider_version_ref" text;--> statement-breakpoint
ALTER TABLE "company_secret_versions" ADD COLUMN "status" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_secret_versions" ADD COLUMN "fingerprint_sha256" text NOT NULL;--> statement-breakpoint
ALTER TABLE "company_secret_versions" ADD COLUMN "rotation_job_id" text;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "managed_mode" text DEFAULT 'paperclip_managed' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "provider_config_id" uuid;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "last_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "last_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_skills" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_skills" ADD COLUMN "icon_key" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "locked_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "locked_by_user_id" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "review_policy" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN "routine_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "env" jsonb;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_delegation_id_jarvis_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."jarvis_delegations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_dev_apps" ADD CONSTRAINT "app_dev_apps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_dev_apps" ADD CONSTRAINT "app_dev_apps_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_dev_blueprints" ADD CONSTRAINT "app_dev_blueprints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_control_id_attribute_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."attribute_controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_exports" ADD CONSTRAINT "book_exports_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_exports" ADD CONSTRAINT "book_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_upload_drafts" ADD CONSTRAINT "bulk_upload_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_uploads" ADD CONSTRAINT "bulk_uploads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_uploads" ADD CONSTRAINT "bulk_uploads_draft_id_bulk_upload_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."bulk_upload_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_uploads" ADD CONSTRAINT "bulk_uploads_scheduled_post_id_social_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_jarvis_settings" ADD CONSTRAINT "company_jarvis_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_bindings" ADD CONSTRAINT "company_secret_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_bindings" ADD CONSTRAINT "company_secret_bindings_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_provider_configs" ADD CONSTRAINT "company_secret_provider_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_secret_provider_configs" ADD CONSTRAINT "company_secret_provider_configs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_assets" ADD CONSTRAINT "design_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_assets" ADD CONSTRAINT "design_assets_run_id_design_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."design_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_preset_runs" ADD CONSTRAINT "design_preset_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_runs" ADD CONSTRAINT "design_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_persona_id_image_providers_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."image_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_prompt_template_id_prompt_templates_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_agent_profiles" ADD CONSTRAINT "gym_agent_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_agent_profiles" ADD CONSTRAINT "gym_agent_profiles_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_agent_profiles" ADD CONSTRAINT "gym_agent_profiles_prompt_candidate_id_gym_prompt_candidates_id_fk" FOREIGN KEY ("prompt_candidate_id") REFERENCES "public"."gym_prompt_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_runs" ADD CONSTRAINT "gym_eval_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_runs" ADD CONSTRAINT "gym_eval_runs_suite_id_gym_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."gym_eval_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_runs" ADD CONSTRAINT "gym_eval_runs_prompt_candidate_id_gym_prompt_candidates_id_fk" FOREIGN KEY ("prompt_candidate_id") REFERENCES "public"."gym_prompt_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_runs" ADD CONSTRAINT "gym_eval_runs_agent_profile_id_gym_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."gym_agent_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_suites" ADD CONSTRAINT "gym_eval_suites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_prompt_candidates" ADD CONSTRAINT "gym_prompt_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_providers" ADD CONSTRAINT "image_providers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_providers" ADD CONSTRAINT "image_providers_group_id_persona_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."persona_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_recovery_issue_id_issues_id_fk" FOREIGN KEY ("recovery_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_previous_owner_agent_id_agents_id_fk" FOREIGN KEY ("previous_owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recovery_actions" ADD CONSTRAINT "issue_recovery_actions_return_owner_agent_id_agents_id_fk" FOREIGN KEY ("return_owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_conversations" ADD CONSTRAINT "jarvis_conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_delegations" ADD CONSTRAINT "jarvis_delegations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_delegations" ADD CONSTRAINT "jarvis_delegations_conversation_id_jarvis_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jarvis_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_learned_preferences" ADD CONSTRAINT "jarvis_learned_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_learned_preferences" ADD CONSTRAINT "jarvis_learned_preferences_source_message_id_jarvis_conversations_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."jarvis_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_entity_id_knowledge_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."knowledge_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_entity_id_knowledge_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."knowledge_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD CONSTRAINT "knowledge_entities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD CONSTRAINT "knowledge_entities_source_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_hubs" ADD CONSTRAINT "knowledge_hubs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lora_training_jobs" ADD CONSTRAINT "lora_training_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lora_training_jobs" ADD CONSTRAINT "lora_training_jobs_persona_id_image_providers_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."image_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lora_training_jobs" ADD CONSTRAINT "lora_training_jobs_provider_id_image_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."image_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_generations" ADD CONSTRAINT "persona_generations_persona_id_image_providers_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."image_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_groups" ADD CONSTRAINT "persona_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_persona_id_image_providers_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."image_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_parent_message_id_room_messages_id_fk" FOREIGN KEY ("parent_message_id") REFERENCES "public"."room_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_secret_id_company_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_events" ADD CONSTRAINT "secret_access_events_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_dms" ADD CONSTRAINT "social_dms_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_categories" ADD CONSTRAINT "prompt_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_scenes" ADD CONSTRAINT "reel_scenes_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_series" ADD CONSTRAINT "reel_series_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_series" ADD CONSTRAINT "reel_series_persona_id_persona_groups_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_series_entries" ADD CONSTRAINT "reel_series_entries_series_id_reel_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."reel_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_series_entries" ADD CONSTRAINT "reel_series_entries_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_templates" ADD CONSTRAINT "reel_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reels" ADD CONSTRAINT "reels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reels" ADD CONSTRAINT "reels_persona_id_persona_groups_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_usage_events" ADD CONSTRAINT "skill_usage_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_usage_events" ADD CONSTRAINT "skill_usage_events_skill_id_company_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."company_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_characters" ADD CONSTRAINT "story_bible_characters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD CONSTRAINT "story_bible_chat_messages_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_outline" ADD CONSTRAINT "story_bible_outline_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_style" ADD CONSTRAINT "story_bible_style_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_bible_world_locations" ADD CONSTRAINT "story_bible_world_locations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_task_dependencies" ADD CONSTRAINT "team_task_dependencies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_task_dependencies" ADD CONSTRAINT "team_task_dependencies_delegation_id_jarvis_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."jarvis_delegations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_task_dependencies" ADD CONSTRAINT "team_task_dependencies_depends_on_delegation_id_jarvis_delegations_id_fk" FOREIGN KEY ("depends_on_delegation_id") REFERENCES "public"."jarvis_delegations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_bridge_reply_attempts_agent_created_idx" ON "agent_bridge_reply_attempts" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_bridge_reply_attempts_company_created_idx" ON "agent_bridge_reply_attempts" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_bridge_reply_attempts_outcome_idx" ON "agent_bridge_reply_attempts" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "agent_operations_company_created_idx" ON "agent_operations" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_operations_agent_created_idx" ON "agent_operations" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_operations_delegation_idx" ON "agent_operations" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "agent_operations_turn_idx" ON "agent_operations" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_dev_apps_company_key_unique" ON "app_dev_apps" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "app_dev_apps_company_idx" ON "app_dev_apps" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "app_dev_blueprints_category_idx" ON "app_dev_blueprints" USING btree ("category","sort_order");--> statement-breakpoint
CREATE INDEX "attribute_controls_category_idx" ON "attribute_controls" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_attribute_options_control" ON "attribute_options" USING btree ("control_id","sort_order");--> statement-breakpoint
CREATE INDEX "book_exports_book_id_idx" ON "book_exports" USING btree ("book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "books_slug_unique_idx" ON "books" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "bulk_upload_drafts_company_status_idx" ON "bulk_upload_drafts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "bulk_upload_drafts_company_updated_idx" ON "bulk_upload_drafts" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "bulk_uploads_company_idx" ON "bulk_uploads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "bulk_uploads_draft_idx" ON "bulk_uploads" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "bulk_uploads_draft_order_idx" ON "bulk_uploads" USING btree ("draft_id","order_index");--> statement-breakpoint
CREATE INDEX "company_jarvis_settings_company_idx" ON "company_jarvis_settings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_jarvis_settings_company_uq" ON "company_jarvis_settings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_secret_bindings_company_idx" ON "company_secret_bindings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_secret_bindings_secret_idx" ON "company_secret_bindings" USING btree ("secret_id");--> statement-breakpoint
CREATE INDEX "company_secret_bindings_target_idx" ON "company_secret_bindings" USING btree ("company_id","target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_secret_bindings_target_path_uq" ON "company_secret_bindings" USING btree ("company_id","target_type","target_id","config_path");--> statement-breakpoint
CREATE INDEX "company_secret_provider_configs_company_idx" ON "company_secret_provider_configs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_secret_provider_configs_company_provider_idx" ON "company_secret_provider_configs" USING btree ("company_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "company_secret_provider_configs_default_uq" ON "company_secret_provider_configs" USING btree ("company_id","provider") WHERE "company_secret_provider_configs"."is_default" = true;--> statement-breakpoint
CREATE INDEX "design_assets_company_created_idx" ON "design_assets" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "design_assets_run_id_idx" ON "design_assets" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "design_assets_kind_idx" ON "design_assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "design_assets_favorited_idx" ON "design_assets" USING btree ("favorited");--> statement-breakpoint
CREATE INDEX "design_assets_skill_idx" ON "design_assets" USING btree ("skill");--> statement-breakpoint
CREATE INDEX "design_preset_runs_company_created_idx" ON "design_preset_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "design_preset_runs_slug_idx" ON "design_preset_runs" USING btree ("preset_slug");--> statement-breakpoint
CREATE INDEX "design_runs_company_created_idx" ON "design_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "design_runs_status_idx" ON "design_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "design_runs_skill_idx" ON "design_runs" USING btree ("skill");--> statement-breakpoint
CREATE INDEX "design_runs_preset_run_idx" ON "design_runs" USING btree ("preset_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_runs_idem_unique" ON "design_runs" USING btree ("company_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "generation_jobs_persona_created_idx" ON "generation_jobs" USING btree ("persona_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "generation_jobs_batch_idx" ON "generation_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generation_jobs_provider_host_idx" ON "generation_jobs" USING btree ("provider_host");--> statement-breakpoint
CREATE INDEX "gym_agent_profiles_company_idx" ON "gym_agent_profiles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "gym_agent_profiles_agent_idx" ON "gym_agent_profiles" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "gym_eval_runs_company_suite_idx" ON "gym_eval_runs" USING btree ("company_id","suite_id");--> statement-breakpoint
CREATE INDEX "gym_eval_runs_suite_idx" ON "gym_eval_runs" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "gym_eval_suites_company_idx" ON "gym_eval_suites" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_eval_suites_company_name_unique" ON "gym_eval_suites" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "gym_prompt_candidates_company_idx" ON "gym_prompt_candidates" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_prompt_candidates_company_name_unique" ON "gym_prompt_candidates" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "image_providers_company_idx" ON "image_providers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "image_providers_type_idx" ON "image_providers" USING btree ("type");--> statement-breakpoint
CREATE INDEX "image_providers_sort_order_idx" ON "image_providers" USING btree ("company_id","sort_order");--> statement-breakpoint
CREATE INDEX "image_providers_group_idx" ON "image_providers" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "issue_recovery_actions_company_source_status_idx" ON "issue_recovery_actions" USING btree ("company_id","source_issue_id","status");--> statement-breakpoint
CREATE INDEX "issue_recovery_actions_company_owner_status_idx" ON "issue_recovery_actions" USING btree ("company_id","owner_agent_id","status");--> statement-breakpoint
CREATE INDEX "issue_recovery_actions_company_recovery_issue_idx" ON "issue_recovery_actions" USING btree ("company_id","recovery_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_recovery_actions_active_source_uq" ON "issue_recovery_actions" USING btree ("company_id","source_issue_id") WHERE "issue_recovery_actions"."status" in ('active', 'escalated');--> statement-breakpoint
CREATE UNIQUE INDEX "issue_recovery_actions_active_fingerprint_uq" ON "issue_recovery_actions" USING btree ("company_id","source_issue_id","cause","fingerprint") WHERE "issue_recovery_actions"."status" in ('active', 'escalated');--> statement-breakpoint
CREATE INDEX "jarvis_alerts_company_created_idx" ON "jarvis_alerts" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "jarvis_alerts_source_idx" ON "jarvis_alerts" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "jarvis_alerts_pending_idx" ON "jarvis_alerts" USING btree ("dismissed_at","created_at");--> statement-breakpoint
CREATE INDEX "jarvis_conversations_company_created_idx" ON "jarvis_conversations" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "jarvis_conversations_persona_version_idx" ON "jarvis_conversations" USING btree ("persona_version");--> statement-breakpoint
CREATE INDEX "jarvis_conversations_source_created_idx" ON "jarvis_conversations" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "jarvis_delegations_company_created_idx" ON "jarvis_delegations" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "jarvis_delegations_status_idx" ON "jarvis_delegations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jarvis_delegations_conversation_idx" ON "jarvis_delegations" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_learned_preferences_actor_key_uq" ON "jarvis_learned_preferences" USING btree ("company_id","user_actor_id","key");--> statement-breakpoint
CREATE INDEX "jarvis_learned_preferences_actor_confidence_idx" ON "jarvis_learned_preferences" USING btree ("company_id","user_actor_id","confidence");--> statement-breakpoint
CREATE INDEX "knowledge_edges_company_idx" ON "knowledge_edges" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "knowledge_edges_source_idx" ON "knowledge_edges" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "knowledge_edges_target_idx" ON "knowledge_edges" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX "knowledge_entities_company_idx" ON "knowledge_entities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "knowledge_entities_company_type_label_idx" ON "knowledge_entities" USING btree ("company_id","type","label");--> statement-breakpoint
CREATE INDEX "knowledge_hubs_company_idx" ON "knowledge_hubs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lora_training_jobs_persona_idx" ON "lora_training_jobs" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "lora_training_jobs_status_idx" ON "lora_training_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lora_training_jobs_external_idx" ON "lora_training_jobs" USING btree ("external_job_id");--> statement-breakpoint
CREATE INDEX "lora_training_jobs_company_idx" ON "lora_training_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "persona_generations_persona_created_idx" ON "persona_generations" USING btree ("persona_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "persona_groups_company_idx" ON "persona_groups" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "prompt_templates_persona_idx" ON "prompt_templates" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "room_members_room_idx" ON "room_members" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_members_room_agent_idx" ON "room_members" USING btree ("room_id","agent_id");--> statement-breakpoint
CREATE INDEX "room_members_room_user_idx" ON "room_members" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "room_messages_room_created_at_idx" ON "room_messages" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "room_messages_room_sender_idx" ON "room_messages" USING btree ("room_id","sender_id");--> statement-breakpoint
CREATE INDEX "room_messages_parent_message_idx" ON "room_messages" USING btree ("parent_message_id");--> statement-breakpoint
CREATE INDEX "rooms_company_status_idx" ON "rooms" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "rooms_company_type_idx" ON "rooms" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "secret_access_events_company_created_idx" ON "secret_access_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "secret_access_events_secret_created_idx" ON "secret_access_events" USING btree ("secret_id","created_at");--> statement-breakpoint
CREATE INDEX "secret_access_events_consumer_idx" ON "secret_access_events" USING btree ("company_id","consumer_type","consumer_id");--> statement-breakpoint
CREATE INDEX "secret_access_events_run_idx" ON "secret_access_events" USING btree ("heartbeat_run_id");--> statement-breakpoint
CREATE INDEX "social_accounts_company_platform_idx" ON "social_accounts" USING btree ("company_id","platform");--> statement-breakpoint
CREATE INDEX "social_accounts_company_status_idx" ON "social_accounts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "social_accounts_platform_account_idx" ON "social_accounts" USING btree ("platform","platform_account_id");--> statement-breakpoint
CREATE INDEX "social_app_credentials_platform_uniq" ON "social_app_credentials" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "social_dms_account_sent_idx" ON "social_dms" USING btree ("social_account_id","sent_at");--> statement-breakpoint
CREATE INDEX "social_dms_thread_idx" ON "social_dms" USING btree ("social_account_id","thread_id","sent_at");--> statement-breakpoint
CREATE INDEX "social_dms_unread_idx" ON "social_dms" USING btree ("social_account_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_dms_platform_message_uniq" ON "social_dms" USING btree ("platform","message_id");--> statement-breakpoint
CREATE INDEX "social_post_targets_post_idx" ON "social_post_targets" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_post_targets_account_idx" ON "social_post_targets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "social_post_targets_status_idx" ON "social_post_targets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_post_targets_idempotency_idx" ON "social_post_targets" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "social_posts_company_status_idx" ON "social_posts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "social_posts_company_scheduled_idx" ON "social_posts" USING btree ("company_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "social_posts_company_created_idx" ON "social_posts" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "social_posts_due_idx" ON "social_posts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "webhook_event_log_source_created_idx" ON "webhook_event_log" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "webhook_event_log_event_type_idx" ON "webhook_event_log" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_categories_company_key_unique" ON "prompt_categories" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "prompt_categories_sort_idx" ON "prompt_categories" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "prompts_company_idx" ON "prompts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "prompts_category_idx" ON "prompts" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_seed_key_unique" ON "prompts" USING btree ("source","title");--> statement-breakpoint
CREATE INDEX "reel_scenes_reel_idx" ON "reel_scenes" USING btree ("reel_id");--> statement-breakpoint
CREATE INDEX "reel_scenes_status_idx" ON "reel_scenes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reel_series_entries_episode_idx" ON "reel_series_entries" USING btree ("series_id","episode_index");--> statement-breakpoint
CREATE INDEX "reel_templates_niche_idx" ON "reel_templates" USING btree ("niche");--> statement-breakpoint
CREATE INDEX "reel_templates_company_idx" ON "reel_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "reels_company_idx" ON "reels" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "reels_persona_idx" ON "reels" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "reels_status_idx" ON "reels" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sue_skill_id_idx" ON "skill_usage_events" USING btree ("company_id","skill_id");--> statement-breakpoint
CREATE INDEX "sue_company_idx" ON "skill_usage_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "sue_created_at_idx" ON "skill_usage_events" USING btree ("company_id","skill_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_book_created_at_idx" ON "story_bible_chat_messages" USING btree ("book_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_task_dependencies_edge_unique" ON "team_task_dependencies" USING btree ("delegation_id","depends_on_delegation_id");--> statement-breakpoint
CREATE INDEX "team_task_dependencies_company_idx" ON "team_task_dependencies" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "team_task_dependencies_delegation_idx" ON "team_task_dependencies" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX "team_task_dependencies_depends_on_idx" ON "team_task_dependencies" USING btree ("depends_on_delegation_id");--> statement-breakpoint
ALTER TABLE "company_secrets" ADD CONSTRAINT "company_secrets_provider_config_id_company_secret_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."company_secret_provider_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_locked_by_agent_id_agents_id_fk" FOREIGN KEY ("locked_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_routine_revision_id_routine_revisions_id_fk" FOREIGN KEY ("routine_revision_id") REFERENCES "public"."routine_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_secret_versions_fingerprint_idx" ON "company_secret_versions" USING btree ("fingerprint_sha256");--> statement-breakpoint
CREATE INDEX "company_secrets_provider_config_idx" ON "company_secrets" USING btree ("provider_config_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_secrets_company_key_uq" ON "company_secrets" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "documents_title_search_idx" ON "documents" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_latest_body_search_idx" ON "documents" USING gin ("latest_body" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "routine_runs_revision_idx" ON "routine_runs" USING btree ("routine_revision_id");