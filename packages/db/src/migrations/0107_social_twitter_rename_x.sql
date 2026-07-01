-- Rename the X platform key from "twitter" to "x" across every social_*
-- table that stores it as a text column. Also normalize the redirect URI on
-- the social_app_credentials row so the OAuth handshake hits the live
-- /auth/social-callback/x endpoint Tyler's X dev app is configured for.
--
-- Tables with a `platform` column: social_app_credentials, social_accounts,
-- social_post_targets. (social_posts itself has no platform column — the
-- platform is recorded per-target in social_post_targets.)

UPDATE "social_app_credentials"
   SET "platform" = 'x',
       "redirect_uri" = 'https://paperclip.augiport.com/auth/social-callback/x',
       "updated_at" = NOW()
 WHERE "platform" = 'twitter';--> statement-breakpoint

UPDATE "social_accounts"
   SET "platform" = 'x',
       "updated_at" = NOW()
 WHERE "platform" = 'twitter';--> statement-breakpoint

UPDATE "social_post_targets"
   SET "platform" = 'x',
       "updated_at" = NOW()
 WHERE "platform" = 'twitter';
