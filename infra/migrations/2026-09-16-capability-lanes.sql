-- ADR-067 — every capability declares the lane its work waits in, and image analysis moves to the
-- interactive lane's routing key.
--
-- infra/initdb/30-jobs-config.sql carries the same column and the same values for a fresh database,
-- and the two must stay in step (SeedBootstrapIT loads it).
\c orazaka_db

ALTER TABLE orazaka_capabilities ADD COLUMN IF NOT EXISTS latency_class VARCHAR(20) NOT NULL DEFAULT 'BATCH';
ALTER TABLE orazaka_capabilities DROP CONSTRAINT IF EXISTS ck_orazaka_capabilities_latency_class;
ALTER TABLE orazaka_capabilities ADD CONSTRAINT ck_orazaka_capabilities_latency_class
    CHECK (latency_class IN ('INTERACTIVE','BATCH'));

-- Measured on this machine from orazaka_jobs, not guessed: image generation p50 67.1 s (n=4),
-- image analysis p50 4.9 s (n=16), chat completion p50 1.1 s (n=97).
UPDATE orazaka_capabilities SET latency_class = 'INTERACTIVE'
 WHERE feature_key IN ('orazaka.core.chat.completion', 'orazaka.core.chat.speech', 'orazaka.core.media.vision');
UPDATE orazaka_capabilities SET latency_class = 'BATCH'
 WHERE feature_key IN ('orazaka.core.media.image', 'orazaka.core.media.video',
                       'orazaka.core.media.audio', 'orazaka.core.media.video.analysis',
                       'orazaka.studio.media.compose');

-- One key cannot feed two queues: image analysis shared job.media.generate with image generation,
-- which is precisely what made the lane impossible.
UPDATE orazaka_capabilities SET routing_key = 'job.media.analyze'
 WHERE feature_key = 'orazaka.core.media.vision';
