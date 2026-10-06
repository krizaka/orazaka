-- A capability routed by the broker has no HTTP surface, and the schema said every one has.
--
-- A Tier-W pack contributes a capability drained by its own worker and reachable by no URL.
-- `http_method NOT NULL DEFAULT 'POST'` wrote a verb naming nothing, `CapabilityDescriptor`
-- refused that half-endpoint, and the refusal happened while LOADING THE REGISTRY — so every
-- request on the conversation service failed, not just one naming that capability (ADR-054 §8).
--
-- The invariant belongs here as well as in the record: both halves, or neither.
\c orazaka_db

ALTER TABLE orazaka_capabilities ALTER COLUMN http_method DROP NOT NULL;
ALTER TABLE orazaka_capabilities ALTER COLUMN http_method DROP DEFAULT;

UPDATE orazaka_capabilities SET http_method = NULL WHERE uri_path IS NULL;

ALTER TABLE orazaka_capabilities
    DROP CONSTRAINT IF EXISTS ck_orazaka_capabilities_endpoint;
ALTER TABLE orazaka_capabilities
    ADD CONSTRAINT ck_orazaka_capabilities_endpoint
    CHECK ((uri_path IS NULL) = (http_method IS NULL));
