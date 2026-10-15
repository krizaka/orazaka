import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Alert } from "@krizaka/ui/alert";
import { Switch } from "@krizaka/ui/switch";
import {
  api, errorMessage, formatSize, isInside, on, parentOf,
  type Dropped, type Entry, type FileAdded, type Listing, type Preview, type Snapshot,
} from "../lib/api";
import { useI18n } from "../lib/i18n";

export function FilesPanel({ snap, refresh }: { snap: Snapshot; refresh: () => Promise<void> }) {
  const { t, format } = useI18n();
  const [dir, setDir] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dropped, setDropped] = useState<Dropped>({ files: [], folders: [] });
  const [added, setAdded] = useState<FileAdded[]>([]);
  const [hover, setHover] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roots = snap.roots;
  const root = useMemo(() => roots.find((r) => dir && isInside(r, dir)) ?? null, [roots, dir]);
  const fail = (e: unknown) => setError(errorMessage(e));

  useEffect(() => {
    const offs = [
      on<Dropped>("dropped", (d) => {
        setHover(false);
        setDropped((prev) => ({
          files: [...d.files, ...prev.files.filter((f) => !d.files.some((n) => n.path === f.path))],
          folders: [...new Set([...d.folders, ...prev.folders])],
        }));
        if (d.files[0]) void select(d.files[0]);
      }),
      on<FileAdded>("file-added", (f) => setAdded((a) => [f, ...a.filter((x) => x.entry.path !== f.entry.path)].slice(0, 30))),
      on<unknown>("tauri://drag-enter", () => setHover(true)),
      on<unknown>("tauri://drag-leave", () => setHover(false)),
    ];
    return () => offs.forEach((o) => void o.then((f) => f()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dir && !root) {
      setDir(null);
      setListing(null);
    }
  }, [dir, root]);

  const open = useCallback(async (path: string) => {
    setError(null);
    try {
      setListing(await api.listDir(path));
      setDir(path);
      setSelected(null);
      setPreview(null);
    } catch (e) {
      fail(e);
    }
  }, []);

  async function select(entry: Entry) {
    setSelected(entry);
    setPreview(null);
    setMessage(null);
    try {
      setPreview(await api.preview(entry.path));
    } catch (e) {
      fail(e);
    }
  }

  async function choose() {
    setError(null);
    try {
      const path = await api.pickFolder();
      await refresh();
      if (path) await open(path);
    } catch (e) {
      fail(e);
    }
  }

  async function revoke(path: string) {
    await api.revokeFolder(path).catch(fail);
    if (dir && isInside(path, dir)) {
      setDir(null);
      setListing(null);
      setSelected(null);
      setPreview(null);
    }
    await refresh();
  }

  async function send(entry: Entry) {
    setMessage(null);
    try {
      await api.sendFile(entry.path);
      setMessage(t("files.sent"));
    } catch (e) {
      fail(e);
    }
  }

  const watched = new Set(snap.settings.watched);
  return (
    <div className={`space-y-5 rounded-2xl ${hover ? "drop-active" : ""}`}>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{t("files.title")}</h2>
          <Badge tone={roots.length ? "accent" : "neutral"} dot>{format(t("files.count"), { count: roots.length })}</Badge>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => void choose()}>{t("files.choose")}</Button>
            {roots.length > 1 && <Button size="sm" variant="danger" onClick={() => void api.revokeAll().then(refresh)}>{t("files.revokeAll")}</Button>}
          </div>
        </div>
        <p className="text-sm text-fg-secondary">{t("files.lead")}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        {roots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-default p-4 text-sm text-fg-secondary">{t("files.none")}</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface-2">
            {roots.map((r) => (
              <li key={r} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <button type="button" onClick={() => void open(r)} className="mono min-w-0 flex-1 truncate text-left text-sm hover:text-fg-accent" title={r}>{r}</button>
                <Switch
                  label={t("files.watch")}
                  checked={watched.has(r)}
                  onCheckedChange={(on) => void api.watch(r, on).then(refresh).catch(fail)}
                />
                <span className="text-xs text-fg-secondary">{watched.has(r) ? t("files.watching") : t("files.watch")}</span>
                <Button size="sm" variant="ghost" onClick={() => void revoke(r)}>{t("files.revoke")}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-dashed border-border-default bg-surface-2/50 p-4">
        <h3 className="text-sm font-semibold">{t("files.dropTitle")}</h3>
        <p className="mt-1 text-sm text-fg-secondary">{t("files.dropLead")}</p>
        {dropped.folders.map((f) => (
          <div key={f} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="mono min-w-0 flex-1 truncate">{format(t("files.droppedFolder"), { path: f })}</span>
            <Button size="sm" variant="secondary" onClick={() => void api.grantDropped(f).then(() => { setDropped((d) => ({ ...d, folders: d.folders.filter((x) => x !== f) })); return refresh(); }).catch(() => setError(t("files.forbidden")))}>
              {t("files.grantDropped")}
            </Button>
          </div>
        ))}
        {dropped.files.length > 0 && (
          <>
            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-fg-secondary">{t("files.droppedFiles")}</h4>
            <ul className="mt-1">
              {dropped.files.map((f) => (
                <li key={f.path} className="flex items-center gap-3 py-1 text-sm">
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-fg-accent" onClick={() => void select(f)}>{f.name}</button>
                  <span className="text-xs text-fg-secondary">{formatSize(f.size)}</span>
                  <Button size="sm" variant="secondary" onClick={() => void send(f)}>{t("files.send")}</Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {dir && listing && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              {root && dir !== root && <Button size="sm" variant="ghost" onClick={() => void open(parentOf(dir))}>↑ {t("files.parent")}</Button>}
              <span className="mono truncate text-xs text-fg-secondary" title={dir}>{dir}</span>
            </div>
            {listing.entries.length === 0 ? (
              <p className="text-sm text-fg-secondary">{t("files.empty")}</p>
            ) : (
              <ul className="max-h-96 divide-y divide-border-subtle overflow-auto rounded-xl border border-border-default bg-surface-2">
                {listing.entries.map((e) => (
                  <li key={e.path}>
                    <button
                      type="button"
                      onClick={() => (e.isDir ? void open(e.path) : void select(e))}
                      className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-3 ${selected?.path === e.path ? "bg-surface-3" : ""}`}
                    >
                      <span aria-hidden className="w-5 text-center text-fg-secondary">{e.isDir ? "▸" : "·"}</span>
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      {!e.isDir && <span className="text-xs text-fg-secondary">{formatSize(e.size)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {listing.truncated && <p className="mt-1 text-xs text-fg-secondary">{t("files.truncated")}</p>}
          </div>
          <PreviewPane entry={selected} preview={preview} onSend={send} message={message} />
        </section>
      )}
      {!dir && selected && (
        <PreviewPane entry={selected} preview={preview} onSend={send} message={message} />
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-secondary">{t("files.newFiles")}</h3>
        {added.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t("files.newFilesNone")}</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface-2">
            {added.map((a) => (
              <li key={a.entry.path} className="flex items-center gap-3 px-3 py-2 text-sm">
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-fg-accent" onClick={() => void select(a.entry)}>{a.entry.name}</button>
                <span className="text-xs text-fg-secondary">{formatSize(a.entry.size)}</span>
                <Button size="sm" variant="secondary" onClick={() => void send(a.entry)}>{t("files.send")}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PreviewPane({ entry, preview, onSend, message }: { entry: Entry | null; preview: Preview | null; onSend: (e: Entry) => Promise<void>; message: string | null }) {
  const { t } = useI18n();
  const pdfUrl = useMemo(() => {
    if (!preview?.data || preview.kind !== "pdf") return null;
    const bytes = Uint8Array.from(atob(preview.data), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  }, [preview]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  if (!entry) return <p className="text-sm text-fg-secondary">{t("files.select")}</p>;
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border-default bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <h4 className="min-w-0 flex-1 truncate font-medium" title={entry.name}>{entry.name}</h4>
        <Badge size="sm" tone="neutral">{entry.kind}</Badge>
        <span className="text-xs text-fg-secondary">{formatSize(entry.size)}</span>
      </div>
      <div className="h-64 overflow-auto rounded-lg bg-surface-1">
        {!preview ? null : preview.text !== null ? (
          <pre className="whitespace-pre-wrap p-3 text-xs">{preview.text}</pre>
        ) : preview.data && preview.kind === "image" ? (
          <img alt={preview.name} className="mx-auto max-h-64 object-contain" src={`data:${preview.mime};base64,${preview.data}`} />
        ) : pdfUrl ? (
          <iframe title={preview.name} src={pdfUrl} className="h-full w-full" />
        ) : (
          <p className="p-3 text-sm text-fg-secondary">{preview.size > 12 * 1024 * 1024 ? t("files.tooLarge") : t("files.binary")}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void onSend(entry)}>{t("files.send")}</Button>
        <Button size="sm" variant="ghost" onClick={() => void api.reveal(entry.path)}>{t("files.reveal")}</Button>
      </div>
      <p className="text-xs text-fg-secondary">{message ?? t("files.sendHint")}</p>
    </div>
  );
}
