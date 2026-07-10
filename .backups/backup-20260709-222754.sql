BEGIN;
-- _bridge_health: 0 rows
-- account: 1 rows
COPY "public"."account" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- activity_log: 408 rows
COPY "public"."activity_log" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- agent_api_keys: 2 rows
COPY "public"."agent_api_keys" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- agent_bridge_reply_attempts: 0 rows
-- agent_config_revisions: 1 rows
COPY "public"."agent_config_revisions" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- agent_operations: 0 rows
-- agent_runtime_state: 3 rows
COPY "public"."agent_runtime_state" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- agent_task_sessions: 0 rows
-- agent_wakeup_requests: 56 rows
COPY "public"."agent_wakeup_requests" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- agents: 19 rows
COPY "public"."agents" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- app_dev_apps: 1 rows
COPY "public"."app_dev_apps" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- app_dev_blueprints: 8 rows
COPY "public"."app_dev_blueprints" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- approval_comments: 0 rows
-- approvals: 0 rows
-- artifacts: 1 rows
COPY "public"."artifacts" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- assets: 0 rows
-- attribute_controls: 6 rows
COPY "public"."attribute_controls" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- attribute_options: 41 rows
COPY "public"."attribute_options" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- board_api_keys: 19 rows
COPY "public"."board_api_keys" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- book_exports: 0 rows
-- books: 0 rows
-- budget_incidents: 0 rows
-- budget_policies: 0 rows
-- bulk_upload_drafts: 0 rows
-- bulk_uploads: 0 rows
-- cli_auth_challenges: 5 rows
COPY "public"."cli_auth_challenges" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- companies: 1 rows
COPY "public"."companies" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- company_jarvis_settings: 0 rows
-- company_logos: 0 rows
-- company_memberships: 3 rows
COPY "public"."company_memberships" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- company_secret_bindings: 0 rows
-- company_secret_provider_configs: 0 rows
-- company_secret_versions: 0 rows
-- company_secrets: 0 rows
-- company_skills: 14 rows
COPY "public"."company_skills" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- company_user_sidebar_preferences: 0 rows
-- cost_events: 0 rows
-- design_assets: 0 rows
-- design_preset_runs: 0 rows
-- design_runs: 0 rows
-- document_revisions: 6 rows
COPY "public"."document_revisions" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- documents: 1 rows
COPY "public"."documents" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- environment_leases: 29 rows
COPY "public"."environment_leases" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- environments: 1 rows
COPY "public"."environments" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- execution_workspaces: 0 rows
-- feedback_exports: 0 rows
-- feedback_votes: 0 rows
-- finance_events: 0 rows
-- gate_policy: 5 rows
COPY "public"."gate_policy" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- generation_jobs: 0 rows
-- goals: 0 rows
-- gym_agent_profiles: 0 rows
-- gym_eval_runs: 1 rows
COPY "public"."gym_eval_runs" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- gym_eval_suites: 2 rows
COPY "public"."gym_eval_suites" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- gym_prompt_candidates: 1 rows
COPY "public"."gym_prompt_candidates" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- heartbeat_run_events: 72 rows
COPY "public"."heartbeat_run_events" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- heartbeat_run_watchdog_decisions: 0 rows
-- heartbeat_runs: 37 rows
COPY "public"."heartbeat_runs" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- image_providers: 9 rows
COPY "public"."image_providers" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- inbox_dismissals: 0 rows
-- instance_settings: 1 rows
COPY "public"."instance_settings" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- instance_user_roles: 2 rows
COPY "public"."instance_user_roles" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- invites: 0 rows
-- issue_approvals: 0 rows
-- issue_attachments: 0 rows
-- issue_comments: 13967 rows
COPY "public"."issue_comments" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- issue_documents: 1 rows
COPY "public"."issue_documents" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- issue_execution_decisions: 0 rows
-- issue_inbox_archives: 0 rows
-- issue_labels: 0 rows
-- issue_read_states: 3 rows
COPY "public"."issue_read_states" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- issue_recovery_actions: 0 rows
-- issue_reference_mentions: 2 rows
COPY "public"."issue_reference_mentions" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- issue_relations: 0 rows
-- issue_thread_interactions: 0 rows
-- issue_tree_hold_members: 0 rows
-- issue_tree_holds: 0 rows
-- issue_work_products: 0 rows
-- issues: 286 rows
COPY "public"."issues" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- jarvis_alerts: 0 rows
-- jarvis_conversations: 0 rows
-- jarvis_delegations: 0 rows
-- jarvis_learned_preferences: 0 rows
-- join_requests: 0 rows
-- knowledge_edges: 0 rows
-- knowledge_entities: 0 rows
-- knowledge_hubs: 0 rows
-- labels: 0 rows
-- lora_training_jobs: 0 rows
-- manuscript_chapters: 0 rows
-- persona_generations: 0 rows
-- persona_groups: 0 rows
-- pipeline_runs: 0 rows
-- plugin_company_settings: 0 rows
-- plugin_config: 0 rows
-- plugin_database_namespaces: 0 rows
-- plugin_entities: 0 rows
-- plugin_job_runs: 0 rows
-- plugin_jobs: 0 rows
-- plugin_logs: 0 rows
-- plugin_managed_resources: 0 rows
-- plugin_migrations: 0 rows
-- plugin_state: 0 rows
-- plugin_webhook_deliveries: 0 rows
-- plugins: 0 rows
-- principal_permission_grants: 1 rows
COPY "public"."principal_permission_grants" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- project_goals: 0 rows
-- project_workspaces: 0 rows
-- projects: 0 rows
-- prompt_categories: 10 rows
COPY "public"."prompt_categories" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- prompt_templates: 50 rows
COPY "public"."prompt_templates" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- prompts: 0 rows
-- rail_config: 6 rows
COPY "public"."rail_config" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- rail_events: 92 rows
COPY "public"."rail_events" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- room_members: 4 rows
COPY "public"."room_members" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- room_messages: 27 rows
COPY "public"."room_messages" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- rooms: 3 rows
COPY "public"."rooms" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- routine_revisions: 0 rows
-- routine_runs: 0 rows
-- routine_triggers: 0 rows
-- routines: 0 rows
-- run_stages: 0 rows
-- secret_access_events: 0 rows
-- session: 26 rows
COPY "public"."session" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- skill_usage_events: 0 rows
-- social_accounts: 0 rows
-- social_app_credentials: 0 rows
-- social_dms: 0 rows
-- social_post_targets: 0 rows
-- social_posts: 0 rows
-- story_bible_characters: 0 rows
-- story_bible_chat_messages: 0 rows
-- story_bible_outline: 0 rows
-- story_bible_style: 0 rows
-- story_bible_world_locations: 0 rows
-- team_task_dependencies: 0 rows
-- user: 2 rows
COPY "public"."user" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- user_sidebar_preferences: 0 rows
-- verification: 1 rows
COPY "public"."verification" TO STDOUT WITH (FORMAT text, DELIMITER E'\t', NULL '\\N');
-- webhook_event_log: 0 rows
-- workspace_operations: 0 rows
-- workspace_runtime_services: 0 rows
COMMIT;
