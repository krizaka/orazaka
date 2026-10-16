import { useEffect, useState } from "react";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Switch } from "@krizaka/ui/switch";
import { Alert } from "@krizaka/ui/alert";
import { api, type PackCategory, type SovereignPack, type Snapshot } from "../lib/api";
import { useI18n } from "../lib/i18n";

export function PacksPanel({ snap }: { snap: Snapshot }) {
  const { t, format } = useI18n();
  const [packs, setPacks] = useState<SovereignPack[]>([]);
  const [category, setCategory] = useState<PackCategory>("all");
  const [search, setSearch] = useState("");
  const [selectedPack, setSelectedPack] = useState<SovereignPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.packs()
      .then(setPacks)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (key: string, current: boolean) => {
    try {
      const updated = await api.togglePack(key, !current);
      setPacks(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const filtered = packs.filter((p) => {
    const matchCategory = category === "all" || p.category === category;
    const matchSearch =
      search.trim() === "" ||
      p.label.toLowerCase().includes(search.toLowerCase()) ||
      p.tagline.toLowerCase().includes(search.toLowerCase()) ||
      p.key.toLowerCase().includes(search.toLowerCase());
    return matchCategory && matchSearch;
  });

  const categories: PackCategory[] = ["all", "business", "compliance", "media", "development"];

  return (
    <div className="flex h-full flex-col gap-5">
      {/* Header and Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle pb-4">
        <div>
          <h2 className="text-lg font-semibold">{t("packs.title")}</h2>
          <p className="text-xs text-fg-secondary">
            {snap.settings.mode === "local"
              ? t("packs.leadLocal")
              : format(t("packs.leadRemote"), { host: snap.settings.remoteUrl })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("packs.search")}
            className="h-8 w-48 rounded-lg border border-border-default bg-surface-2 px-3 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-hidden"
          />
          <div className="flex items-center gap-1 rounded-lg border border-border-default bg-surface-2 p-0.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  category === c
                    ? "bg-accent text-accent-contrast shadow-xs"
                    : "text-fg-secondary hover:text-fg"
                }`}
              >
                {t(`packs.category.${c}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {/* Packs Grid */}
      {loading ? (
        <div className="flex items-center justify-center p-12 text-xs text-fg-secondary">
          {t("packs.loading")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default p-8 text-center text-sm text-fg-secondary">
          {t("packs.empty")}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((pack) => (
            <div
              key={pack.key}
              data-testid={`pack-card-${pack.key}`}
              className="flex flex-col justify-between rounded-xl border border-border-default bg-surface-2 p-4 transition-all hover:border-border-strong hover:shadow-xs"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-sm text-fg">{pack.label}</h3>
                    <span className="font-mono text-[11px] text-fg-muted">v{pack.version} · {pack.key}</span>
                  </div>
                  <Badge
                    size="sm"
                    tone={
                      pack.regulatoryClass === "SENSITIVE"
                        ? "danger"
                        : pack.tier === "WORKER"
                        ? "accent"
                        : "neutral"
                    }
                  >
                    {pack.regulatoryClass === "SENSITIVE" ? "🛡 SENSITIVE" : pack.tier}
                  </Badge>
                </div>

                <p className="text-xs leading-relaxed text-fg-secondary line-clamp-2">
                  {pack.tagline}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="sm" tone={pack.pricing === "PAID" ? "warning" : "success"}>
                    {t(`packs.pricing.${pack.pricing}`)}
                  </Badge>
                  <span className="text-[11px] font-mono text-fg-muted">
                    {pack.capabilities.length} {t("packs.capabilities")}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-3">
                <div className="flex items-center gap-2">
                  <Switch
                    label={`${t("packs.installed")} ${pack.label}`}
                    checked={pack.installed}
                    onCheckedChange={() => void toggle(pack.key, pack.installed)}
                  />
                  <span className="text-xs font-medium text-fg">
                    {pack.installed ? t("packs.active") : t("packs.inactive")}
                  </span>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedPack(pack)}
                >
                  {t("packs.details")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pack Details Modal */}
      {selectedPack && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
        >
          <div className="max-w-lg w-full space-y-4 rounded-2xl border border-border-default bg-surface-1 p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-fg">{selectedPack.label}</h3>
                <p className="font-mono text-xs text-fg-muted">{selectedPack.key} · v{selectedPack.version}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPack(null)}
                className="text-fg-secondary hover:text-fg text-base"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-fg-secondary leading-relaxed">
              {selectedPack.tagline}
            </p>

            {/* Scope Guard Callout for SENSITIVE Packs */}
            {selectedPack.scopeGuard && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 space-y-2 text-xs">
                <strong className="text-warning font-semibold flex items-center gap-1.5">
                  🛡 {t("packs.scopeGuardTitle")}
                </strong>
                <p className="text-fg italic">
                  &ldquo;{selectedPack.scopeGuard.refusal}&rdquo;
                </p>
                <div className="text-[11px] text-fg-secondary">
                  <strong>{t("packs.refusedTerms")}:</strong>{" "}
                  {selectedPack.scopeGuard.refusedTerms.join(", ")}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                {t("packs.capabilitiesProvided")}
              </h4>
              <ul className="space-y-1 rounded-lg border border-border-subtle bg-surface-2 p-2.5 font-mono text-xs text-fg">
                {selectedPack.capabilities.map((cap) => (
                  <li key={cap} className="flex items-center gap-2">
                    <span className="text-accent">●</span> {cap}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-subtle">
              <Button size="sm" variant="secondary" onClick={() => setSelectedPack(null)}>
                {t("common.close")}
              </Button>
              <Button
                size="sm"
                variant={selectedPack.installed ? "danger" : "primary"}
                onClick={() => {
                  void toggle(selectedPack.key, selectedPack.installed);
                  setSelectedPack(null);
                }}
              >
                {selectedPack.installed ? t("packs.uninstall") : t("packs.install")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
