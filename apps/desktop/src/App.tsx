import { useCallback, useEffect, useState } from "react";
import { OrazakaLogo } from "@krizaka/ui";
import { Button } from "@krizaka/ui/button";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "@krizaka/ui/tabs";
import { ThemeToggle, useTheme } from "@krizaka/ui/theme";
import { Alert } from "@krizaka/ui/alert";
import {
  api,
  errorMessage,
  hostOf,
  on,
  type Probe,
  type Settings,
  type Snapshot,
} from "./lib/api";
import { I18nProvider, useI18n, type Locale } from "./lib/i18n";
import { GenerationPanel } from "./components/GenerationPanel";
import { PacksPanel } from "./components/PacksPanel";
import { StudioPanel } from "./components/StudioPanel";
import { FilesPanel } from "./components/FilesPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { StackPanel } from "./components/StackPanel";
import { AccountPanel } from "./components/AccountPanel";

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(
    () => api.snapshot().then(setSnap).catch((e) => setError(errorMessage(e))),
    []
  );

  useEffect(() => {
    void refresh();
    const off = on<Probe>("stack-probe", (probe) =>
      setSnap((s) => (s ? { ...s, probe } : s))
    );
    return () => {
      void off.then((f) => f());
    };
  }, [refresh]);

  const locale: Locale = snap?.settings.locale ?? "en";
  return (
    <I18nProvider locale={locale}>
      <Shell snap={snap} error={error} refresh={refresh} setSnap={setSnap} />
    </I18nProvider>
  );
}

function Shell({
  snap,
  error,
  refresh,
  setSnap,
}: {
  snap: Snapshot | null;
  error: string | null;
  refresh: () => Promise<void>;
  setSnap: (s: Snapshot) => void;
}) {
  const { t, format, locale } = useI18n();
  const { mode } = useTheme();
  const [tab, setTab] = useState("generation");
  const [remoteLatency, setRemoteLatency] = useState<number | null>(null);

  useEffect(() => {
    if (snap?.settings.mode === "remote") {
      void api.probeRemote(snap.settings.remoteUrl).then((p) => {
        if (p.reachable && p.latencyMs !== undefined) {
          setRemoteLatency(p.latencyMs);
        } else {
          setRemoteLatency(null);
        }
      });
    } else {
      setRemoteLatency(null);
    }
  }, [snap?.settings.mode, snap?.settings.remoteUrl]);

  const switchLocale = async () => {
    if (!snap) return;
    const next: Settings = {
      ...snap.settings,
      locale: locale === "en" ? "fr" : "en",
    };
    const saved = await api.saveSettings(next);
    setSnap({ ...snap, settings: saved });
  };

  const toggleMode = async () => {
    if (!snap) return;
    const nextMode = snap.settings.mode === "local" ? "remote" : "local";
    const next: Settings = { ...snap.settings, mode: nextMode };
    const saved = await api.saveSettings(next);
    setSnap({ ...snap, settings: saved });
  };

  return (
    <div className="flex h-full flex-col bg-surface-1 text-fg">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-3">
        <OrazakaLogo size={34} animated={false} title="Orazaka" />
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight">{t("app.name")}</h1>
          <p className="truncate text-xs text-fg-secondary">{t("app.tagline")}</p>
        </div>

        {snap && (
          <button
            type="button"
            data-testid="mode-switcher"
            onClick={() => void toggleMode()}
            title={format(t("mode.switchMode"), {
              target:
                snap.settings.mode === "local"
                  ? format(t("mode.remoteMode"), { host: hostOf(snap.settings.remoteUrl) })
                  : t("mode.localMode"),
            })}
            className="flex items-center gap-2 rounded-full border border-border-default bg-surface-2 px-3 py-1 text-xs font-medium hover:border-border-strong hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                snap.settings.mode === "local"
                  ? "bg-accent"
                  : "bg-emerald-500 animate-pulse"
              }`}
            />
            <span>
              {snap.settings.mode === "local"
                ? t("mode.localMode")
                : format(t("mode.remoteMode"), { host: hostOf(snap.settings.remoteUrl) })}
            </span>
            <span className="text-[10px] text-fg-muted font-mono">
              {remoteLatency !== null ? `${remoteLatency}ms` : "⇄"}
            </span>
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void switchLocale()}
            aria-label="Language"
          >
            {t("common.language")}
          </Button>
          <ThemeToggle
            variant="ghost"
            label={(m) => format(t("common.theme"), { mode: m })}
            data-mode-now={mode}
          />
          <Button
            size="sm"
            variant="primary"
            shape="cut"
            onClick={() => void api.openWorkspace().catch(() => undefined)}
          >
            {t("stack.openWorkspace")}
          </Button>
        </div>
      </header>

      {error && (
        <div className="px-5 pt-3">
          <Alert tone="danger">{format(t("common.error"), { message: error })}</Alert>
        </div>
      )}

      <TabsRoot
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="px-5 overflow-x-auto">
          <TabsTrigger value="generation">{t("tabs.generation")}</TabsTrigger>
          <TabsTrigger value="packs">{t("tabs.packs")}</TabsTrigger>
          <TabsTrigger value="studio">{t("tabs.studio")}</TabsTrigger>
          <TabsTrigger value="files">{t("tabs.files")}</TabsTrigger>
          <TabsTrigger value="stack">{t("tabs.stack")}</TabsTrigger>
          <TabsTrigger value="account">{t("tabs.account")}</TabsTrigger>
          <TabsTrigger value="settings">{t("tabs.settings")}</TabsTrigger>
        </TabsList>
        <main className="min-h-0 flex-1 overflow-auto p-5">
          {snap ? (
            <>
              <TabsContent value="generation">
                <GenerationPanel snap={snap} />
              </TabsContent>
              <TabsContent value="packs">
                <PacksPanel snap={snap} />
              </TabsContent>
              <TabsContent value="studio">
                <StudioPanel snap={snap} />
              </TabsContent>
              <TabsContent value="files">
                <FilesPanel snap={snap} refresh={refresh} />
              </TabsContent>
              <TabsContent value="stack">
                <StackPanel snap={snap} goSettings={() => setTab("settings")} />
              </TabsContent>
              <TabsContent value="account">
                <AccountPanel snap={snap} />
              </TabsContent>
              <TabsContent value="settings">
                <SettingsPanel
                  snap={snap}
                  onSaved={(s) => setSnap(s)}
                  refresh={refresh}
                />
              </TabsContent>
            </>
          ) : null}
        </main>
      </TabsRoot>
    </div>
  );
}
