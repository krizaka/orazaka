-- 2026-10-30 — FLUX.2 [klein] takes reference images (krizaka/krizaka-internal#158), for an existing database.
--
--   docker exec -i <postgres> psql -U <owner> -d orazaka_db < infra/migrations/2026-10-30-flux2-klein-references.sql
--
-- How many reference pictures a model conditions on is catalogue data, read by the engine's image adapter
-- (orazaka-ai-engine ReferenceImages): `options` = {"maxReferences": n}. A model without it refuses references by name.
-- FLUX.2 [klein] 4B (Apache-2.0) conditions on them through stable-diffusion.cpp's `ref_images`; 4 keeps a 1360x768 key
-- frame inside the 24-48 GB cards of the `small`/`big`/`cinema`/`kit` profiles. Only an image row whose options are empty is
-- touched (image rows carry no other options). Idempotent.
\c orazaka_db

UPDATE orazaka_models SET options = '{"maxReferences":4}'
WHERE model_name = 'flux-2-klein-4b' AND (options IS NULL OR options = '');
