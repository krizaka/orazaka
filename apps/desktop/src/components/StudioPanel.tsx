import { useEffect, useState } from "react";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Alert } from "@krizaka/ui/alert";
import {
  api,
  type Entry,
  type SagaRun,
  type Snapshot,
  type StudioBlueprint,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

export function StudioPanel({ snap }: { snap: Snapshot }) {
  const { t } = useI18n();
  const [blueprints, setBlueprints] = useState<StudioBlueprint[]>([]);
  const [selectedBlueprint, setSelectedBlueprint] = useState<StudioBlueprint | null>(null);
  const [activeRun, setActiveRun] = useState<SagaRun | null>(null);
  const [formInputs, setFormInputs] = useState<Record<string, unknown>>({});
  const [availableFiles, setAvailableFiles] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.blueprints()
      .then(setBlueprints)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Ingest files from granted roots for input attachments
  useEffect(() => {
    if (snap.roots.length === 0) return;
    void Promise.all(
      snap.roots.map((r) =>
        api.listDir(r).then((l) => l.entries.filter((e) => !e.isDir)).catch(() => [])
      )
    ).then((res) => setAvailableFiles(res.flat()));
  }, [snap.roots]);

  const launchRun = async (blueprint: StudioBlueprint) => {
    setError(null);
    try {
      const run = await api.startStudioRun(blueprint.blueprintKey, formInputs);
      setActiveRun(run);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const advanceStep = () => {
    if (!activeRun) return;
    const next = api.stepStudioRun(activeRun);
    setActiveRun(next);
  };

  return (
    <div className="flex h-full flex-col gap-5">
      {/* View 1: Active Saga Execution Run */}
      {activeRun ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-fg">{activeRun.blueprintLabel}</h2>
                <Badge
                  tone={
                    activeRun.status === "COMPLETED"
                      ? "success"
                      : activeRun.status === "FAILED"
                      ? "danger"
                      : "accent"
                  }
                  pulse={activeRun.status === "RUNNING"}
                >
                  {activeRun.status}
                </Badge>
              </div>
              <p className="font-mono text-xs text-fg-muted mt-1">
                Saga ID: {activeRun.runId} · Mode: {snap.settings.mode.toUpperCase()}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {activeRun.status === "RUNNING" && (
                <Button size="sm" variant="primary" shape="cut" onClick={advanceStep}>
                  {t("studio.advanceStep")}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setActiveRun(null)}>
                {activeRun.status === "COMPLETED" ? t("studio.newRun") : t("common.cancel")}
              </Button>
            </div>
          </div>

          {/* Saga Stepper Timeline */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              {t("studio.pipelineTimeline")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {activeRun.timeline.map((step, idx) => (
                <div
                  key={step.stepId}
                  className={`relative rounded-xl border p-3 text-xs transition-all ${
                    step.status === "completed"
                      ? "border-success/40 bg-success/10 text-fg"
                      : step.status === "running"
                      ? "border-accent bg-accent/10 shadow-xs text-fg font-medium"
                      : "border-border-default bg-surface-2 text-fg-muted"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] uppercase">
                      {t("studio.step")} {idx + 1}
                    </span>
                    {step.status === "completed" ? (
                      <span className="text-success font-bold">✓</span>
                    ) : step.status === "running" ? (
                      <span className="animate-spin text-accent">⚙</span>
                    ) : (
                      <span>○</span>
                    )}
                  </div>
                  <div className="font-semibold truncate">{step.label}</div>
                  {step.durationMs && (
                    <div className="font-mono text-[10px] text-fg-muted mt-1">
                      {step.durationMs}ms
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Outputs and Results */}
          {activeRun.outputs.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-border-default bg-surface-2 p-5">
              <h3 className="text-sm font-semibold text-fg flex items-center gap-2">
                <span>📄</span> {t("studio.outputsTitle")}
              </h3>
              {activeRun.outputs.map((out, idx) => (
                <div key={idx} className="space-y-2">
                  <h4 className="text-xs font-semibold text-fg">{out.title}</h4>
                  <pre className="whitespace-pre-wrap rounded-xl border border-border-subtle bg-surface-1 p-3 text-xs leading-relaxed text-fg font-mono">
                    {out.content}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Live Execution Console Logs */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              {t("studio.liveLogs")}
            </h3>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-border-default bg-surface-2 p-3 font-mono text-xs text-fg-secondary leading-relaxed">
              {activeRun.logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        </div>
      ) : selectedBlueprint ? (
        /* View 2: Blueprint Configuration Form */
        <div className="max-w-2xl space-y-6">
          <div className="flex items-start justify-between border-b border-border-subtle pb-4">
            <div>
              <h2 className="text-lg font-semibold text-fg">{selectedBlueprint.label}</h2>
              <p className="text-xs text-fg-secondary mt-1">{selectedBlueprint.tagline}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelectedBlueprint(null)}>
              ← {t("studio.back")}
            </Button>
          </div>

          {error && <Alert tone="danger">{error}</Alert>}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void launchRun(selectedBlueprint);
            }}
            className="space-y-5"
          >
            {selectedBlueprint.inputsSchema.map((field) => (
              <div key={field.name} className="space-y-1.5">
                <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
                  <span>{field.label}</span>
                  {field.required && <span className="text-danger">*</span>}
                </label>

                {field.type === "select" ? (
                  <select
                    value={(formInputs[field.name] as string) ?? ""}
                    onChange={(e) =>
                      setFormInputs({ ...formInputs, [field.name]: e.target.value })
                    }
                    className="w-full h-9 rounded-lg border border-border-default bg-surface-2 px-3 text-xs text-fg focus:border-accent focus:outline-hidden"
                  >
                    <option value="">{t("studio.chooseOption")}</option>
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.type === "file" ? (
                  <select
                    value={(formInputs[field.name] as string) ?? ""}
                    onChange={(e) =>
                      setFormInputs({ ...formInputs, [field.name]: e.target.value })
                    }
                    className="w-full h-9 rounded-lg border border-border-default bg-surface-2 px-3 text-xs text-fg focus:border-accent focus:outline-hidden"
                  >
                    <option value="">
                      {availableFiles.length === 0
                        ? t("generation.noFilesGranted")
                        : t("studio.chooseGrantedFile")}
                    </option>
                    {availableFiles.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.name} ({f.kind})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={(formInputs[field.name] as string) ?? ""}
                    onChange={(e) =>
                      setFormInputs({ ...formInputs, [field.name]: e.target.value })
                    }
                    placeholder={field.placeholder}
                    className="w-full h-9 rounded-lg border border-border-default bg-surface-2 px-3 text-xs text-fg focus:border-accent focus:outline-hidden"
                  />
                )}
              </div>
            ))}

            <div className="pt-4 border-t border-border-subtle flex items-center gap-3">
              <Button type="submit" size="md" variant="primary" shape="cut">
                {t("studio.launchSaga")}
              </Button>
              <Button
                type="button"
                size="md"
                variant="secondary"
                onClick={() => setSelectedBlueprint(null)}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        </div>
      ) : (
        /* View 3: Blueprints Catalogue */
        <div className="space-y-4">
          <div className="border-b border-border-subtle pb-3">
            <h2 className="text-lg font-semibold text-fg">{t("studio.title")}</h2>
            <p className="text-xs text-fg-secondary">{t("studio.lead")}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {blueprints.map((bp) => (
              <div
                key={bp.blueprintKey}
                data-testid={`blueprint-${bp.blueprintKey}`}
                className="flex flex-col justify-between rounded-xl border border-border-default bg-surface-2 p-5 transition-all hover:border-border-strong hover:shadow-xs"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-sm text-fg">{bp.label}</h3>
                      <span className="font-mono text-[11px] text-fg-muted">
                        v{bp.latestVersion} · {bp.kind}
                      </span>
                    </div>
                    <Badge tone={bp.pricing === "PAID" ? "warning" : "accent"} size="sm">
                      {bp.pricing}
                    </Badge>
                  </div>

                  <p className="text-xs leading-relaxed text-fg-secondary">
                    {bp.tagline}
                  </p>

                  <div className="flex items-center gap-2 text-xs font-mono text-fg-muted">
                    <span>⚡ {bp.steps.length} {t("studio.pipelineSteps")}</span>
                    <span>·</span>
                    <span>📂 {bp.profession}</span>
                  </div>
                </div>

                <div className="mt-5 border-t border-border-subtle pt-3 flex items-center justify-end">
                  <Button
                    size="sm"
                    variant="primary"
                    shape="cut"
                    onClick={() => {
                      setSelectedBlueprint(bp);
                      setFormInputs({});
                    }}
                  >
                    {t("studio.configureAndRun")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
