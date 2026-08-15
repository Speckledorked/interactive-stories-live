-- User.themePreference: 'light' | 'dark' | 'system'.
--
-- Nullable with no default: NULL means "never chose", which the client
-- treats as 'system'. Adding a NOT NULL DEFAULT would rewrite every
-- existing row to claim an explicit preference the user never made.
ALTER TABLE "User" ADD COLUMN "themePreference" TEXT;
