import { useEffect, useRef, useState } from "react";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Alert } from "@krizaka/ui/alert";
import {
  api,
  formatSize,
  type ChatMessage,
  type Entry,
  type Model,
  type Snapshot,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

export function GenerationPanel({ snap }: { snap: Snapshot }) {
  const { t, format } = useI18n();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("orazaka-mac");
  const [activeTab, setActiveTab] = useState<"chat" | "image" | "video">("chat");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scoped files picker for attachments
  const [availableFiles, setAvailableFiles] = useState<Entry[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; path: string; size: number }[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.models(snap.settings.mode).then((m) => {
      setModels(m);
      if (m.length > 0 && !m.some((x) => x.id === selectedModel)) {
        setSelectedModel(m[0].id);
      }
    });
  }, [snap.settings.mode, selectedModel]);

  // Load available files from granted roots
  useEffect(() => {
    if (snap.roots.length === 0) {
      setAvailableFiles([]);
      return;
    }
    void Promise.all(
      snap.roots.map((r) =>
        api.listDir(r).then((l) => l.entries.filter((e) => !e.isDir)).catch(() => [])
      )
    ).then((results) => setAvailableFiles(results.flat()));
  }, [snap.roots]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  // Seed default welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content:
            snap.settings.mode === "local"
              ? t("generation.welcomeLocal")
              : format(t("generation.welcomeRemote"), { host: snap.settings.remoteUrl }),
          timestamp: Date.now(),
          model: selectedModel,
          reasoning: [
            "Cognitive sovereign engine standby.",
            "Loi 25 compliance guard active.",
            "No telemetry or third-party cookies.",
          ],
        },
      ]);
    }
  }, [snap.settings.mode, snap.settings.remoteUrl, selectedModel, t, format, messages.length]);

  const send = async () => {
    const q = prompt.trim();
    if (!q || isGenerating) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: q,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    const sentAttachments = [...attachments];
    setAttachments([]);
    setIsGenerating(true);

    try {
      const resp = await api.generateChat(q, selectedModel, sentAttachments, snap.settings.mode);
      setMessages((prev) => [...prev, resp]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  const currentModelObj = models.find((m) => m.id === selectedModel);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Top Controls: Modality Pills, Model Selector, Mode Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2">
          {(["chat", "image", "video"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setActiveTab(mode)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === mode
                  ? "bg-accent text-accent-contrast shadow-xs"
                  : "bg-surface-2 text-fg-secondary hover:bg-surface-3 hover:text-fg"
              }`}
            >
              {t(`generation.mode.${mode}`)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="model-select" className="text-xs font-semibold text-fg-secondary">
            {t("generation.model")}:
          </label>
          <select
            id="model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="h-8 rounded-lg border border-border-default bg-surface-2 px-2.5 text-xs font-medium text-fg focus:outline-hidden focus:ring-2 focus:ring-accent"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.category === "local" ? "Metal" : "Cloud"})
              </option>
            ))}
          </select>
          {currentModelObj && (
            <Badge tone={currentModelObj.category === "local" ? "accent" : "neutral"} size="sm">
              {currentModelObj.tags.join(" · ")}
            </Badge>
          )}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {/* Messages Thread */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto pr-2"
        role="log"
        aria-live="polite"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-2 ${
              msg.role === "user" ? "items-end" : "items-start"
            }`}
          >
            <div
              className={`max-w-2xl rounded-2xl p-4 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-accent/15 border border-accent/30 text-fg"
                  : "bg-surface-2 border border-border-default text-fg"
              }`}
            >
              {/* Attachments chip in message */}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {msg.attachments.map((att) => (
                    <span
                      key={att.path}
                      className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-secondary"
                    >
                      📎 {att.name} ({formatSize(att.size)})
                    </span>
                  ))}
                </div>
              )}

              {/* Reasoning Accordion */}
              {msg.reasoning && msg.reasoning.length > 0 && (
                <details className="group mb-3 rounded-xl border border-border-subtle bg-surface-1 p-2.5 text-xs text-fg-secondary">
                  <summary className="flex cursor-pointer items-center justify-between font-mono font-medium text-fg-muted hover:text-fg">
                    <span>🧠 {t("generation.thinking")} ({msg.reasoning.length} {t("generation.steps")})</span>
                    <span className="text-[10px] uppercase group-open:rotate-180">▼</span>
                  </summary>
                  <ul className="mt-2.5 space-y-1.5 border-t border-border-subtle pt-2 pl-4 list-disc font-mono">
                    {msg.reasoning.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Message text */}
              <div className="whitespace-pre-wrap">{msg.content}</div>

              {/* Artifacts (Image / Video preview) */}
              {msg.artifacts && msg.artifacts.length > 0 && (
                <div className="mt-3 space-y-3">
                  {msg.artifacts.map((art) => (
                    <div
                      key={art.id}
                      className="overflow-hidden rounded-xl border border-border-default bg-surface-1 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-fg">{art.title}</span>
                        <Badge size="sm" tone="accent">{art.type.toUpperCase()}</Badge>
                      </div>
                      {art.type === "image" && art.url && (
                        <div className="relative overflow-hidden rounded-lg bg-surface-3">
                          <img
                            src={art.url}
                            alt={art.title}
                            className="max-h-80 w-full object-contain"
                          />
                        </div>
                      )}
                      {art.type === "video" && (
                        <div className="relative flex aspect-video items-center justify-center rounded-lg bg-surface-3 text-fg-secondary">
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-3xl">▶</span>
                            <span className="text-xs font-mono">{art.title} (Wan 2.1 720p)</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Metrics footer */}
              {msg.metrics && (
                <div className="mt-2.5 flex items-center gap-3 border-t border-border-subtle pt-2 text-[11px] text-fg-muted font-mono">
                  <span>⏱ {msg.metrics.durationMs}ms</span>
                  {msg.metrics.tokensPerSec && (
                    <span>⚡ {msg.metrics.tokensPerSec} t/s</span>
                  )}
                  <span>🔒 {snap.settings.mode === "local" ? "Apple Silicon Metal" : "Sovereign Cloud"}</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="flex items-center gap-3 text-xs text-fg-secondary italic">
            <span className="animate-spin text-accent">⚙</span>
            {snap.settings.mode === "local"
              ? t("generation.generatingLocal")
              : t("generation.generatingRemote")}
          </div>
        )}
      </div>

      {/* Attachments preview row */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-xs text-fg-secondary">{t("generation.attached")}:</span>
          {attachments.map((att) => (
            <span
              key={att.path}
              className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface-2 px-2 py-0.5 text-xs"
            >
              <span>{att.name}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== att.path))}
                className="text-fg-secondary hover:text-danger"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Composer Area */}
      <div className="space-y-2 border-t border-border-subtle pt-3">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("generation.placeholder")}
            rows={3}
            className="w-full resize-none rounded-xl border border-border-default bg-surface-2 p-3 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-hidden focus:ring-1 focus:ring-accent"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowFilePicker(!showFilePicker)}
              aria-label={t("generation.attachFile")}
            >
              📎 {t("generation.attachFile")}
            </Button>
            <span className="text-[11px] text-fg-muted">
              {t("generation.shortcutHint")}
            </span>
          </div>

          <Button
            size="md"
            variant="primary"
            shape="cut"
            disabled={!prompt.trim() || isGenerating}
            loading={isGenerating}
            onClick={() => void send()}
          >
            {t("generation.generate")}
          </Button>
        </div>

        {/* Modal-like dropdown to pick from granted Mac files */}
        {showFilePicker && (
          <div className="rounded-xl border border-border-default bg-surface-2 p-3 text-xs shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-fg">{t("generation.pickFromGranted")}</span>
              <button
                type="button"
                onClick={() => setShowFilePicker(false)}
                className="text-fg-secondary hover:text-fg"
              >
                ✕
              </button>
            </div>
            {availableFiles.length === 0 ? (
              <p className="text-fg-secondary">{t("generation.noFilesGranted")}</p>
            ) : (
              <ul className="max-h-40 divide-y divide-border-subtle overflow-y-auto">
                {availableFiles.map((file) => (
                  <li
                    key={file.path}
                    className="flex cursor-pointer items-center justify-between py-1.5 px-2 hover:bg-surface-3 rounded-md"
                    onClick={() => {
                      if (!attachments.some((a) => a.path === file.path)) {
                        setAttachments((prev) => [
                          ...prev,
                          { name: file.name, path: file.path, size: file.size },
                        ]);
                      }
                      setShowFilePicker(false);
                    }}
                  >
                    <span className="truncate">{file.name}</span>
                    <span className="text-fg-muted">{formatSize(file.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
