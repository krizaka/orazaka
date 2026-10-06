-- A capability a pack contributes may have no synchronous surface (ADR-049).
--
-- orazaka_capabilities.uri_path was NOT NULL while every contract describing it said "null when
-- it has none". A Tier-W pack — whose work is submitted over AMQP and nothing else — is the
-- first thing that had to have one, and it got a 500 with no message.
\c orazaka_db
ALTER TABLE orazaka_capabilities ALTER COLUMN uri_path DROP NOT NULL;
ALTER TABLE orazaka_capabilities ALTER COLUMN http_method SET DEFAULT 'POST';
