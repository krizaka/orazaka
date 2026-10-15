import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Alert } from "@krizaka/ui/alert";
import { Select } from "@krizaka/ui/field";
import { api, errorMessage, hostOf, on, parseServices, type CliCall, type CliResult, type ServiceStatus, type Snapshot } from "../lib/api";
import { useI18n } from "../lib/i18n";

const LOG_SERVICES = ["router", "ollama", "media-worker", "image-worker", "ui"];
const tone = { running: "success", partial: "warning", stopped: "neutral" } as const;

export function StackPanel({ snap, goSettings }: { snap: Snapshot; goSettings: () => void }) {
  const { t, format } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [service, setService] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  const quiet = useRef(false);

  useEffect(() => {
    const off = on<{ line: string }>("cli-line", (p) => !quiet.current && setLines((l) => [...l.slice(-800), p.line]));
    return () => void off.then((f) => f());
  }, []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const run = useCallback(
    async (label: string, call: CliCall): Promise<CliResult | null> => {
      setBusy(label);
      setNote(null);
      quiet.current = call.command === "status" || call.command === "version";
      try {
        const r = await api.cli(call);
        if (r.timedOut) setNote(t("stack.timedOut"));
        else if (!r.ok) setNote(format(t("stack.exit"), { code: String(r.code ?? "?") }));
        return r;
      } catch (e) {
        setNote(errorMessage(e));
        return null;
      } finally {
        quiet.current = false;
        setBusy(null);
      }
    },
    [t, format],
  );

  const refreshStatus = useCallback(async () => {
    const r = await run("status", { command: "status" });
    if (r?.ok) setServices(parseServices(r.lines));
  }, [run]);

  const started = useRef(false);
  useEffect(() => {
    if (!snap.sidecar || started.current) return;
    started.current = true;
    // One command at a time (the backend refuses overlap): the version, then the status.
    void (async () => {
      const v = await run("version", { command: "version" });
      if (v?.ok) setCliVersion(v.lines.join(" ").trim().split(/\s+/).pop() ?? null);
      await refreshStatus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.sidecar]);

  useEffect(() => {
    const off = on<string>("tray-action", (a) => {
      if (a === "start") void run("start", { command: "start", mode: "dev" }).then(refreshStatus);
      if (a === "stop") void run("stop", { command: "stop" }).then(refreshStatus);
    });
    return () => void off.then((f) => f());
  }, [run, refreshStatus]);

  const state = snap.probe.state;
  const remote = snap.settings.mode === "remote";
  const needsWorkspace = !snap.settings.workspaceDir;
  const disabled = busy !== null || !snap.sidecar;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{t("stack.title")}</h2>
          <Badge tone={tone[state]} dot pulse={state === "running"}>{t(`stack.status.${state}`)}</Badge>
          {cliVersion && <span className="mono text-xs text-fg-secondary">{format(t("stack.cliVersion"), { version: cliVersion })}</span>}
        </div>
        <p className="text-sm text-fg-secondary">{t("stack.lead")}</p>
        {remote && <Alert tone="info">{format(t("stack.remoteNote"), { host: hostOf(snap.settings.remoteUrl) })}</Alert>}
        {!snap.sidecar && <Alert tone="danger">{t("stack.sidecarMissing")}</Alert>}
        {snap.sidecar && needsWorkspace && (
          <Alert tone="warning" action={<Button size="sm" variant="secondary" onClick={goSettings}>{t("tabs.settings")}</Button>}>
            {t("stack.workspaceNeeded")}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled || needsWorkspace} loading={busy === "start"} onClick={() => void run("start", { command: "start", mode: "dev" }).then(refreshStatus)}>
            {t("stack.start")}
          </Button>
          <Button variant="secondary" disabled={disabled || needsWorkspace} loading={busy === "stop"} onClick={() => void run("stop", { command: "stop" }).then(refreshStatus)}>
            {t("stack.stop")}
          </Button>
          <Button variant="outline" disabled={disabled} loading={busy === "doctor"} onClick={() => void run("doctor", { command: "doctor" })}>
            {t("stack.doctor")}
          </Button>
          <Button variant="ghost" disabled={disabled} loading={busy === "status"} onClick={() => void refreshStatus()}>
            {t("common.refresh")}
          </Button>
        </div>
        {note && <p className="text-sm text-fg-secondary" role="status">{note}</p>}

        <h3 className="pt-2 text-sm font-semibold uppercase tracking-wide text-fg-secondary">{t("stack.services")}</h3>
        {services.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("stack.noServices")}</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface-2">
            {services.map((s) => (
              <li key={s.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1">{s.name}</span>
                <span className="mono text-xs text-fg-secondary">:{s.port}</span>
                <Badge size="sm" tone={s.status === "running" ? "success" : "neutral"} dot>{s.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex min-h-[22rem] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-semibold uppercase tracking-wide text-fg-secondary">{t("stack.logs")}</h3>
          <Select aria-label={t("stack.logService")} value={service} onChange={(e) => setService(e.target.value)} className="h-8 w-44 text-xs">
            <option value="">{t("stack.allServices")}</option>
            {LOG_SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Button size="sm" variant="secondary" disabled={disabled || !service} onClick={() => { setLines([]); void run("logs", { command: "logs", service, tail: 120 }); }}>
            {t("stack.fetchLogs")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLines([])}>{t("stack.clearLogs")}</Button>
        </div>
        <pre ref={logRef} aria-live="off" className="min-h-0 flex-1 overflow-auto rounded-xl border border-border-default bg-surface-2 p-3 text-xs leading-relaxed text-fg-secondary whitespace-pre-wrap">
          {lines.length ? lines.join("\n") : t("stack.logsEmpty")}
        </pre>
      </section>
    </div>
  );
}
