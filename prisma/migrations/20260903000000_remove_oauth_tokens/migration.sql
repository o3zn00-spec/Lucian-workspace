-- LUCIAN uses OAuth only for owner identity verification and does not call
-- provider APIs. Remove previously persisted bearer material; future account
-- links omit these values at the Auth.js adapter boundary.
UPDATE "Account"
SET
  "access_token" = NULL,
  "refresh_token" = NULL,
  "id_token" = NULL,
  "session_state" = NULL;
