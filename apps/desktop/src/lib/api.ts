import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Settings = {
  mode: "local" | "remote";
  remoteUrl: string;
  workspaceDir: string | null;
  watched: string[];
  locale: "en" | "fr";
};
export type Probe = { web: boolean; edge: boolean; state: "running" | "partial" | "stopped" };
export type Snapshot = {
  settings: Settings;
  roots: string[];
  sidecar: boolean;
  autostart: boolean;
  probe: Probe;
  appVersion: string;
};
export type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  kind: string;
};
export type Listing = { entries: Entry[]; truncated: boolean };
export type Preview = {
  name: string;
  size: number;
  mime: string;
  kind: string;
  text: string | null;
  data: string | null;
};
export type CliCall = { command: "version" | "status" | "start" | "stop" | "doctor" | "logs"; mode?: "dev" | "full"; service?: string; tail?: number };
export type CliResult = { code: number | null; ok: boolean; timedOut: boolean; lines: string[] };
export type FileAdded = { root: string; entry: Entry };
export type Dropped = { files: Entry[]; folders: string[] };
export type ServiceStatus = { name: string; port: number; status: "running" | "stopped" | "unknown"; pid: number | null; category: string };

export const api = {
  snapshot: () => invoke<Snapshot>("get_snapshot"),
  probe: () => invoke<Probe>("probe_stack"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  cli: (call: CliCall) => invoke<CliResult>("cli_run", { call }),
  pickFolder: () => invoke<string | null>("pick_folder"),
  grantDropped: (path: string) => invoke<string>("grant_dropped", { path }),
  revokeFolder: (path: string) => invoke<string[]>("revoke_folder", { path }),
  revokeAll: () => invoke<void>("revoke_all"),
  listDir: (path: string) => invoke<Listing>("list_dir", { path }),
  preview: (path: string) => invoke<Preview>("preview_file", { path }),
  reveal: (path: string) => invoke<void>("reveal_in_finder", { path }),
  watch: (path: string, enabled: boolean) => invoke<string[]>("watch_set", { path, enabled }),
  openWorkspace: () => invoke<string>("open_workspace"),
  sendFile: (path: string) => invoke<void>("workspace_send_file", { path }),
  setAutostart: (enabled: boolean) => invoke<boolean>("autostart_set", { enabled }),
};

export const on = <T,>(event: string, cb: (payload: T) => void) => listen<T>(event, (e) => cb(e.payload));

export const errorMessage = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));

/** Parses the JSON array printed by `orazaka status --json`, ignoring any log noise around it. */
export function parseServices(lines: string[]): ServiceStatus[] {
  const text = lines.join("\n");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as ServiceStatus[]) : [];
  } catch {
    return [];
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/** The stack's state from the services `orazaka status` reported: all running, none, or some. */
export function stackState(services: ServiceStatus[], fallback: Probe["state"]): Probe["state"] {
  if (services.length === 0) return fallback;
  const running = services.filter((s) => s.status === "running").length;
  if (running === 0) return "stopped";
  return running === services.length ? "running" : "partial";
}
