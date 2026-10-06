-- ─────────────────────────────────────────────────────────────────────────────
-- Credit unit: 1 old credit becomes 10 new credits (ADR-047).
--
-- WHY A MIGRATION FILE AT ALL, in a phase whose databases are re-seeded from
-- infra/initdb: because a unit change is the one thing a re-seed cannot teach
-- you. The seed shows the destination; only this file shows that the journey is
-- possible, and the hard part — an append-only ledger — is answered here or not
-- at all. infra/initdb/70-billing.sql carries the destination; this carries the
-- path, and the two must stay in step.
--
-- THE HARD PART. credit_ledger_entry is append-only by a BEFORE UPDATE OR DELETE
-- FOR EACH ROW trigger (ADR-033 §1), so historical amounts cannot be rescaled
-- and MUST NOT BE. They are correct as written; what they lack is the unit they
-- were written in. So:
--
--   * every historical row is LABELLED, not rewritten. ALTER TABLE ADD COLUMN
--     with a constant default is DDL, not an UPDATE, so the trigger does not
--     fire; and on PostgreSQL 11+ the default is stored in the catalogue rather
--     than written into rows, so not one row is touched. Verified against the
--     live table before this file was written.
--   * the wallet IS rescaled — credit_wallet is mutable state, not a record of
--     what happened — and the rescale is itself recorded as a ledger entry, so
--     the chain stays continuous: the last v1 balance_after × 10 equals the
--     conversion entry's v2 balance_after, and a replay can verify across the
--     boundary instead of stopping at it.
--
-- Reading old history afterwards: an amount means what its unit_version says.
-- v1 rows are old credits, v2 rows are new. Nothing is ambiguous and nothing was
-- corrupted, which is the whole reason the ledger is append-only.
--
-- PRECONDITION: no ACTIVE hold. A hold pins its pricebook version, so one taken
-- at v1 rates would settle v1 credits against a v2 wallet. This file refuses
-- rather than converting them, because rescaling a reservation silently changes
-- what a user was promised.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE active_holds INT;
BEGIN
  SELECT count(*) INTO active_holds FROM credit_hold WHERE status = 'ACTIVE';
  IF active_holds > 0 THEN
    RAISE EXCEPTION 'refusing to rescale: % ACTIVE hold(s) pinned to pricebook v1', active_holds;
  END IF;
END $$;

-- 1. Label the past. Existing rows are v1 by the column default; new rows are v2
--    by the default that replaces it. The epoch is a property of WHEN a row was
--    written, which the database knows better than any caller — so no producer
--    has to remember to pass it, and none can forget.
ALTER TABLE credit_ledger_entry ADD COLUMN unit_version INT NOT NULL DEFAULT 1;
ALTER TABLE credit_ledger_entry ALTER COLUMN unit_version SET DEFAULT 2;
COMMENT ON COLUMN credit_ledger_entry.unit_version IS
  'Credit unit this row is denominated in. 1 = pre-ADR-047 credits, 2 = 10x finer. Never rewritten.';

-- 2. Retire the v1 pricebook. Kept, not deleted: a settled hold names the
--    version it was priced at, and an audit that cannot resolve that version
--    cannot verify the debit it produced.
UPDATE credit_pricebook SET effective_to = now() WHERE version = 1 AND effective_to IS NULL;

-- 3. The v2 pricebook: every rate x10, every floor still 1 — which is the point.
--    The floor was 1 old credit and becomes 0.1 old credits, so a 363-token turn
--    stops costing the same as a 999-token one.
INSERT INTO credit_pricebook (version, capability, model_name, unit, credits_per_unit, minimum_credits, estimate_credits) VALUES
(2, 'CHAT',  NULL, 'KILOTOKEN',       10.0000,  1,   20),
(2, 'IMAGE', NULL, 'IMAGE_STEP',      19.0730,  5,  200),
(2, 'VIDEO', NULL, 'OUTPUT_SECOND',  900.0000, 90, 3600),
(2, 'AGENT', NULL, 'CALL',            50.0000,  5,   50),
(2, 'IMAGE', 'llava:latest',           'KILOTOKEN', 10.0000, 1,  30),
(2, 'IMAGE', 'llava:v1.6',             'KILOTOKEN', 10.0000, 1,  30),
(2, 'IMAGE', 'bakllava:latest',        'KILOTOKEN', 10.0000, 1,  30),
(2, 'IMAGE', 'llama3.2-vision:latest', 'KILOTOKEN', 10.0000, 1,  30),
(2, 'VIDEO', 'orazaka-compose',        'OUTPUT_SECOND', 20.0000, 2, 300),
(2, 'AUDIO', 'whisper-tiny-en',        'AUDIO_MINUTE',  60.0000, 6,  60),
(2, 'AUDIO', 'whisper-base',           'AUDIO_MINUTE',  60.0000, 6,  60),
(2, 'AUDIO', 'piper-en-low',           'KILOCHAR',      40.0000, 4,  40),
(2, 'AUDIO', 'piper-en-medium-ryan',   'KILOCHAR',      40.0000, 4,  40),
(2, 'AUDIO', 'piper-fr-medium',        'KILOCHAR',      40.0000, 4,  40),
(2, 'AUDIO', 'tts-1',                  'KILOCHAR',      40.0000, 4,  40);

-- 4. Rescale the wallets, and say so in the ledger. Two statements, one
--    transaction: a balance that moved without an entry is exactly the
--    unauditable state the ledger exists to prevent.
INSERT INTO credit_ledger_entry
  (actor_id, entry_type, bucket, amount, balance_after, reference_type, reference_id,
   idempotency_key, reason, created_by, unit_version)
SELECT actor_id, 'ADJUSTMENT', 'GRANTED', balance_granted * 9, balance_granted * 10,
       'ADMIN', 'credit-scale-v2', 'credit-scale-v2:' || actor_id || ':GRANTED',
       'Credit unit rescaled x10 (ADR-047) — purchasing power unchanged', 'system', 2
FROM credit_wallet WHERE balance_granted <> 0;

INSERT INTO credit_ledger_entry
  (actor_id, entry_type, bucket, amount, balance_after, reference_type, reference_id,
   idempotency_key, reason, created_by, unit_version)
SELECT actor_id, 'ADJUSTMENT', 'PURCHASED', balance_purchased * 9, balance_purchased * 10,
       'ADMIN', 'credit-scale-v2', 'credit-scale-v2:' || actor_id || ':PURCHASED',
       'Credit unit rescaled x10 (ADR-047) — purchasing power unchanged', 'system', 2
FROM credit_wallet WHERE balance_purchased <> 0;

UPDATE credit_wallet
   SET balance_granted   = balance_granted * 10,
       balance_purchased = balance_purchased * 10,
       held              = held * 10,
       version           = version + 1,
       updated_at        = now();

-- 5. The money anchor moves with the unit, so the price in euros does not.
--    1 old credit was 1 cent; 1 new credit is a tenth of that, which no integer
--    number of cents can express — so the anchor is restated in millicents and
--    the old key is retired rather than left to be read as 1 cent per new credit,
--    which would be a tenfold price rise nobody decided.
UPDATE billing_runtime_config
   SET config_key = 'billing.credit.unit-price-millicents',
       config_value = '100',
       description  = 'Money anchor: millicents per credit at list price. 1 kilotoken = 1000 millicents = 1 cent, unchanged across the v1->v2 rescale (ADR-047).'
 WHERE config_key = 'billing.credit.unit-price-cents';

-- 6. Amounts that are credit quantities, not rates, move with the unit too.
UPDATE billing_runtime_config SET config_value = '500'
 WHERE config_key = 'billing.overshoot.max-credits';
UPDATE billing_runtime_config SET config_value = '100000'
 WHERE config_key = 'billing.adjustment.daily-max-credits';

COMMIT;
