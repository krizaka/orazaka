-- The voice turn (ADR-076). Fresh databases get the same from their initdb files:
-- orazaka-job-service 30-jobs-config.sql (voices and their locale) and
-- krizaka-billing 70-billing.sql (the voices' prices, session-summary's grants).
-- The wellbeing pack's session-summary Studio and its Québec crisis line install themselves at the
-- studio service's next start (PackBootstrap: a bundle that ships a Studio the catalogue lacks).
\c orazaka_db

ALTER TABLE orazaka_models ADD COLUMN IF NOT EXISTS locale VARCHAR(16);
ALTER TABLE orazaka_models ADD COLUMN IF NOT EXISTS locale_default BOOLEAN NOT NULL DEFAULT FALSE;
DO $$ BEGIN
  ALTER TABLE orazaka_models ADD CONSTRAINT ck_models_locale_default_has_locale
    CHECK (NOT locale_default OR locale IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_models_locale_default ON orazaka_models (category, locale) WHERE locale_default;

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, max_steps, recommended_fps, supported_hardware) VALUES
('piper-fr-siwis-medium', 'Piper Siwis (fr-FR, féminine)', 'speech', 'Medium,Fr', 'localai', FALSE, NULL, NULL, NULL),
('piper-fr-tom-medium', 'Piper Tom (fr-FR, masculine)', 'speech', 'Medium,Fr', 'localai', FALSE, NULL, NULL, NULL)
ON CONFLICT (model_name) DO NOTHING;

INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default) VALUES
('qwen2.5:7b', 'Qwen 2.5 7B Instruct', 'chat', 'q4_K_M', 'ollama', FALSE)
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET description = 'Qwen 2.5 7B Instruct (Apache-2.0) — fluent French and English, the model the voice turn is measured with: first spoken sentence in about two seconds on an M1 Max.' WHERE model_name = 'qwen2.5:7b';

UPDATE orazaka_models SET description = 'French neural TTS (Piper, Siwis voice, female, CC-BY 4.0). Clear, natural French — the fr-FR voice of the voice turn.' WHERE model_name = 'piper-fr-siwis-medium';
UPDATE orazaka_models SET description = 'French neural TTS (Piper, Tom voice, male, AGPL-3.0 weights). 44.1 kHz, warm timbre — the second fr-FR voice of the voice turn.' WHERE model_name = 'piper-fr-tom-medium';
UPDATE orazaka_models SET locale = 'en' WHERE model_name IN ('piper-en-low', 'piper-en-medium-ryan');
UPDATE orazaka_models SET locale = 'fr-FR' WHERE model_name IN ('piper-fr-medium', 'piper-fr-siwis-medium', 'piper-fr-tom-medium');
UPDATE orazaka_models SET locale_default = (model_name IN ('piper-en-medium-ryan', 'piper-fr-siwis-medium')) WHERE category = 'speech';

\c krizaka_billing_db

-- The current version only (v2): these voices were never priced at v1 on a database that lived
-- through it, and a v1 row inserted now would be a current row of a retired version.
INSERT INTO credit_pricebook (version, capability, model_name, unit, credits_per_unit, minimum_credits, estimate_credits) VALUES
(2, 'AUDIO', 'piper-fr-siwis-medium', 'KILOCHAR', 40.0000, 4, 40),
(2, 'AUDIO', 'piper-fr-tom-medium',   'KILOCHAR', 40.0000, 4, 40)
ON CONFLICT DO NOTHING;

INSERT INTO billing_plan_entitlement (plan_key, entitlement_key, value_type, value)
SELECT plan_key, 'studio.session-summary', 'boolean', 'true'
  FROM (VALUES ('free'), ('premium'), ('ultimate')) AS plans(plan_key)
ON CONFLICT (plan_key, entitlement_key) DO NOTHING;
