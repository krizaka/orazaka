-- The embedding model of dev (ORO-ORAZAKA). Run against orazaka_db; idempotent.
-- Routing is data: POST /api/v1/embeddings resolves the default model of the `embedding` category, never a
-- provider the caller names. BGE-M3 (MIT): multilingual (English and French), 1024 dimensions, served by DigitalOcean
-- serverless inference — the same provider row as chat (do-inference).
INSERT INTO orazaka_models (model_name, model_label, category, options, provider_name, is_default, description)
VALUES ('bge-m3', 'BGE-M3', 'embedding', NULL, 'do-inference', FALSE,
        'BGE-M3 (MIT) on DigitalOcean serverless inference — multilingual text embeddings (English, French), '
        || '1024 dimensions. The embedding default of the dev environment: semantic search and recommendations.')
ON CONFLICT (model_name) DO NOTHING;
UPDATE orazaka_models SET is_default = (model_name = 'bge-m3') WHERE category = 'embedding';
