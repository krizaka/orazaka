-- orazaka#301 — a REGULATED pack's consent statement can ship translations (pack.consent_statements,
-- {"en": "…"}; consent_statement stays the default language, French). Fresh databases get the same
-- column from orazaka-studio infra/initdb/80-studio.sql. The wellbeing pack's statement 2.0 (English
-- and French) installs itself at the studio service's next start (PackBootstrap).
\c orazaka_studio_db

ALTER TABLE pack ADD COLUMN IF NOT EXISTS consent_statements JSONB;
