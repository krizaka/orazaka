-- ADR-066 — the four media capabilities nobody billed now declare a unit, and video analysis gets a
-- rate of its own.
--
-- infra/initdb/30-jobs-config.sql and 70-billing.sql carry the same values for a fresh database, and
-- the three must stay in step (SeedBootstrapIT loads them).
\c orazaka_db

UPDATE orazaka_capabilities SET billable_unit = 'AUDIO_MINUTE' WHERE feature_key = 'orazaka.core.media.audio';
UPDATE orazaka_capabilities SET billable_unit = 'KILOCHAR'     WHERE feature_key = 'orazaka.core.chat.speech';
UPDATE orazaka_capabilities SET billable_unit = 'KILOTOKEN'    WHERE feature_key = 'orazaka.core.media.vision';
UPDATE orazaka_capabilities SET billable_unit = 'AUDIO_MINUTE' WHERE feature_key = 'orazaka.core.media.video.analysis';

\c orazaka_billing_db
SET ROLE orazaka_billing;

-- ⚠ PLACEHOLDER rate: it needs the owner's decision, like every other rate seeded so far.
INSERT INTO credit_pricebook (version, capability, model_name, unit, credits_per_unit, minimum_credits, estimate_credits)
SELECT 2, 'VIDEO', 'orazaka-video-analysis', 'AUDIO_MINUTE', 45.0000, 5, 90
 WHERE NOT EXISTS (
   SELECT 1 FROM credit_pricebook
    WHERE capability = 'VIDEO' AND model_name = 'orazaka-video-analysis' AND effective_to IS NULL);
