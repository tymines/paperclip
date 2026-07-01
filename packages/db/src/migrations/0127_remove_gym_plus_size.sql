-- Remove two SFW catalog options the audit found unfixable by re-firing:
--   * PhotoShoot "Gym" scene  — renders an apartment instead of a gym.
--   * "Plus Size" body type   — renders slim and trips the NSFW safety filter.
--
-- Neither has a working preview thumbnail and neither is recoverable by simply
-- regenerating, so per Tyler's audit call we remove the options for now. Both
-- are deferred until hand-curated (see docs / memory note). Idempotent.
--
-- The Gym prompt_templates row's only dependents are generation_jobs via an
-- ON DELETE SET NULL FK, so deleting it is safe (history rows keep their image,
-- just lose the template link).
DELETE FROM "prompt_templates"
WHERE "name" = 'Gym'
  AND "category" = 'gym';

-- "Plus Size" lives under the body_type attribute control. Resolve the control
-- by key so we don't depend on a hard-coded control id.
DELETE FROM "attribute_options"
WHERE "value" = 'plus'
  AND "control_id" IN (
    SELECT "id" FROM "attribute_controls" WHERE "key" = 'body_type'
  );
