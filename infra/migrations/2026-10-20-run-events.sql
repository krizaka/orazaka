-- ─────────────────────────────────────────────────────────────────────────────
-- RUN EVENTS (orazaka#241, ADR-083 slice 10): a run's changes are numbered, in the database, so every instance and
-- every reconnecting client agrees on the numbers — `GET /runs/{id}/events` sends the number as the SSE `id`, and a
-- client that comes back with `Last-Event-ID` is sent only what it has not seen.
-- `studio_run.event_seq` rises by one at each change of the run (status, outputs, error, end) or of one of its steps
-- (inserted, status or output changed); the update that raises it holds the run's row lock, so the numbers are gapless
-- per run whoever writes. `studio_run_event` keeps what each number was (kind + a few words), and goes with its run.
-- A trigger, not application code: the saga, the sweeper and the settlement all write these tables. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE studio_run ADD COLUMN IF NOT EXISTS event_seq BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS studio_run_event (
    run_id     UUID         NOT NULL REFERENCES studio_run(id) ON DELETE CASCADE,
    seq        BIGINT       NOT NULL,
    kind       VARCHAR(30)  NOT NULL,
    detail     JSONB        NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, seq)
);

CREATE OR REPLACE FUNCTION studio_run_event_number() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.event_seq := 1;
    ELSIF NEW.event_seq = OLD.event_seq AND (
            NEW.status IS DISTINCT FROM OLD.status OR NEW.outputs IS DISTINCT FROM OLD.outputs
            OR NEW.error_message IS DISTINCT FROM OLD.error_message
            OR NEW.finished_at IS DISTINCT FROM OLD.finished_at) THEN
        NEW.event_seq := OLD.event_seq + 1;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION studio_run_event_record() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.event_seq IS DISTINCT FROM OLD.event_seq THEN
        INSERT INTO studio_run_event (run_id, seq, kind, detail)
        VALUES (NEW.id, NEW.event_seq, CASE WHEN TG_OP = 'INSERT' THEN 'run.created' ELSE 'run.updated' END,
                jsonb_build_object('status', NEW.status))
        ON CONFLICT (run_id, seq) DO NOTHING;
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION studio_run_event_step() RETURNS trigger AS $$
BEGIN
    UPDATE studio_run SET event_seq = event_seq + 1 WHERE id = NEW.run_id;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_studio_run_event_number ON studio_run;
CREATE TRIGGER trg_studio_run_event_number BEFORE INSERT OR UPDATE ON studio_run
    FOR EACH ROW EXECUTE FUNCTION studio_run_event_number();
DROP TRIGGER IF EXISTS trg_studio_run_event_record ON studio_run;
CREATE TRIGGER trg_studio_run_event_record AFTER INSERT OR UPDATE ON studio_run
    FOR EACH ROW EXECUTE FUNCTION studio_run_event_record();
DROP TRIGGER IF EXISTS trg_studio_run_event_step_new ON studio_run_step;
CREATE TRIGGER trg_studio_run_event_step_new AFTER INSERT ON studio_run_step
    FOR EACH ROW EXECUTE FUNCTION studio_run_event_step();
DROP TRIGGER IF EXISTS trg_studio_run_event_step_changed ON studio_run_step;
CREATE TRIGGER trg_studio_run_event_step_changed AFTER UPDATE ON studio_run_step
    FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status OR NEW.output IS DISTINCT FROM OLD.output)
    EXECUTE FUNCTION studio_run_event_step();
