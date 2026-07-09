-- 0148: Make gate_policy seed idempotent — add UNIQUE constraint on (company_id, stage_name)
-- Drops the non-unique index and replaces it with a UNIQUE index.
-- This prevents duplicate INSERTs on re-seed or re-apply of migration 0144.
-- Branch-only safeguard. Does NOT affect existing clean data (5 unique rows).

-- Drop the old non-unique index
DROP INDEX IF EXISTS "gate_policy_company_stage_idx";

-- Create UNIQUE index — rejects duplicate (company_id, stage_name) pairs
CREATE UNIQUE INDEX "gate_policy_company_stage_unique_idx"
  ON "gate_policy" USING btree ("company_id", "stage_name");
