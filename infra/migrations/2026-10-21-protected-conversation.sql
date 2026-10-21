-- orazaka#301 — the conversations a REGULATED pack's turns (voice, listening) are held in: no content, only
-- whose they are, so they can be erased on request and aged out after 30 days. Fresh databases get the same
-- from orazaka-conversation-service infra/initdb/20-conversation.sql.
\c orazaka_db

CREATE TABLE IF NOT EXISTS orazaka_protected_conversation (
    conversation_id VARCHAR(255) PRIMARY KEY,
    actor_id        VARCHAR(255) NOT NULL,
    installation_id VARCHAR(64)  NOT NULL,
    pack_key        VARCHAR(50)  NOT NULL,
    first_seen_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_protected_conversation_actor ON orazaka_protected_conversation (actor_id, pack_key);
CREATE INDEX IF NOT EXISTS idx_protected_conversation_seen ON orazaka_protected_conversation (last_seen_at);
