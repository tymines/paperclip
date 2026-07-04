ALTER TABLE "issues" ADD COLUMN "worktree_path" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "branch_name" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "lease_expires_at" timestamp with time zone;